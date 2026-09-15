// Pruebas de las Security Rules de Firestore contra el emulador.
// Ejecutar con:  npm run test:rules   (levanta el emulador, corre esto y lo apaga)
//
// Cubre el flujo real de la app: registro con tipo de cuenta, creación de persona + miembro en
// batch (PersonasService.crearPersona), permisos por rol (sección 8 del doc) e invitaciones.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

let env;
const PERSONA_ID = 'persona-mama';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-relevo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// Contextos de usuario
const ana = () => env.authenticatedContext('ana', { email: 'ana@test.com' }).firestore();
const luis = () => env.authenticatedContext('luis', { email: 'luis@test.com' }).firestore();
const marta = () => env.authenticatedContext('marta', { email: 'marta@test.com' }).firestore();
const pedro = () => env.authenticatedContext('pedro', { email: 'pedro@test.com' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Crea el perfil de un usuario (como él mismo), igual que AuthService.registrar(). */
async function perfil(db, uid, tipo) {
  await setDoc(doc(db, `usuarios/${uid}`), {
    uid,
    nombre: uid,
    email: `${uid}@test.com`,
    tipo,
    fcmTokens: [],
    personas: [],
    creadoEn: serverTimestamp(),
  });
}

/** Mismo batch que PersonasService.crearPersona(), ejecutado como `ana` (familiar). */
async function anaCreaPersona() {
  const db = ana();
  await perfil(db, 'ana', 'familiar');
  const personaRef = doc(db, 'personas_cuidadas', PERSONA_ID);
  const batch = writeBatch(db);
  batch.set(personaRef, {
    nombre: 'Mamá',
    alergias: [],
    condiciones: [],
    contactosEmergencia: [],
    miembrosUids: ['ana'],
    creadoPor: 'ana',
    creadoEn: serverTimestamp(),
  });
  batch.set(doc(personaRef, 'miembros', 'ana'), {
    uid: 'ana',
    rol: 'cuidador_principal',
    nombre: 'Ana',
    agregadoEn: serverTimestamp(),
  });
  batch.update(doc(db, 'usuarios/ana'), { personas: arrayUnion(PERSONA_ID) });
  return batch.commit();
}

/** Agrega a `luis` a la persona con el rol indicado, saltándose las reglas. */
async function agregarLuisComo(rol) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/luis`), {
      uid: 'luis',
      rol,
      nombre: 'Luis',
      agregadoEn: serverTimestamp(),
    });
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion('luis') });
  });
}

// ---------------------------------------------------------------------------

test('usuarios: cada quien crea, edita y borra solo su propio perfil, con tipo de cuenta obligatorio', async () => {
  await assertFails(setDoc(doc(ana(), 'usuarios/ana'), { uid: 'ana', nombre: 'Ana' })); // sin tipo
  await assertFails(setDoc(doc(ana(), 'usuarios/ana'), { uid: 'ana', nombre: 'Ana', tipo: 'jefe' }));
  await assertSucceeds(perfil(ana(), 'ana', 'familiar'));
  await assertFails(perfil(ana(), 'luis', 'medico')); // el perfil de otro
  await assertFails(setDoc(doc(anon(), 'usuarios/x'), { uid: 'x', tipo: 'familiar' }));
  // el tipo no se puede cambiar después
  await assertFails(updateDoc(doc(ana(), 'usuarios/ana'), { tipo: 'medico' }));
  await assertSucceeds(updateDoc(doc(ana(), 'usuarios/ana'), { nombre: 'Ana G.' }));
  await assertFails(deleteDoc(doc(luis(), 'usuarios/ana')));
  await assertSucceeds(deleteDoc(doc(ana(), 'usuarios/ana')));
});

test('usuarios: una cuenta antigua sin tipo puede definirlo una sola vez', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'usuarios/ana'), { uid: 'ana', nombre: 'Ana', personas: [] });
  });
  await assertSucceeds(updateDoc(doc(ana(), 'usuarios/ana'), { tipo: 'familiar' }));
  await assertFails(updateDoc(doc(ana(), 'usuarios/ana'), { tipo: 'enfermero' }));
});

test('persona: un familiar la crea en batch y queda como responsable', async () => {
  await assertSucceeds(anaCreaPersona());
  const snap = await getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`));
  assert.equal(snap.data().rol, 'cuidador_principal');
});

test('persona: enfermeros y médicos NO pueden dar de alta personas', async () => {
  for (const [db, uid, tipo] of [
    [marta(), 'marta', 'enfermero'],
    [luis(), 'luis', 'medico'],
  ]) {
    await perfil(db, uid, tipo);
    const personaRef = doc(db, 'personas_cuidadas', `p-${uid}`);
    const b = writeBatch(db);
    b.set(personaRef, { nombre: 'X', miembrosUids: [uid], creadoPor: uid, creadoEn: serverTimestamp() });
    b.set(doc(personaRef, 'miembros', uid), { uid, rol: 'cuidador_principal', nombre: uid, agregadoEn: serverTimestamp() });
    await assertFails(b.commit());
  }
});

test('persona: no se puede crear sin incluirse como miembro', async () => {
  await perfil(ana(), 'ana', 'familiar');
  await assertFails(
    setDoc(doc(ana(), 'personas_cuidadas/otra'), {
      nombre: 'Otra',
      miembrosUids: ['luis'],
      creadoPor: 'ana',
    }),
  );
});

test('persona: un no-miembro ni un anónimo pueden leerla', async () => {
  await anaCreaPersona();
  await assertFails(getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}`)));
  await assertFails(getDoc(doc(anon(), `personas_cuidadas/${PERSONA_ID}`)));
});

test('persona: listar "mis personas" con array-contains funciona; listar todo no', async () => {
  await anaCreaPersona();
  const mias = await assertSucceeds(
    getDocs(query(collection(ana(), 'personas_cuidadas'), where('miembrosUids', 'array-contains', 'ana'))),
  );
  assert.equal(mias.size, 1);
  await assertFails(getDocs(collection(ana(), 'personas_cuidadas')));
});

test('roles: el médico solo lee; el enfermero (cuidador de turno) registra bitácora y signos', async () => {
  await anaCreaPersona();

  await agregarLuisComo('medico');
  await assertSucceeds(getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}`)));
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e1`), {
      tipo: 'nota',
      texto: 'hola',
      autorUid: 'luis',
    }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/s1`), {
      tipo: 'peso',
      valor: 70,
      autorUid: 'luis',
    }),
  );

  await agregarLuisComo('cuidador_turno');
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e1`), {
      tipo: 'nota',
      texto: 'hola',
      autorUid: 'luis',
    }),
  );
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/s1`), {
      tipo: 'peso',
      valor: 70,
      autorUid: 'luis',
    }),
  );
  // ...pero no puede firmar entradas a nombre de otro
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e2`), {
      tipo: 'nota',
      texto: 'falsa',
      autorUid: 'ana',
    }),
  );
});

test('roles: solo el responsable define medicamentos y administra miembros', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');

  await assertSucceeds(
    setDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), {
      nombre: 'Metformina',
      dosis: '500 mg',
      horarios: ['08:00'],
      inventario: 30,
      activo: true,
    }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m2`), { nombre: 'X' }),
  );
  // El de turno sí registra la toma (firmada por él) y solo puede ajustar el inventario
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/t1`), {
      tomado: true,
      registradoPor: 'luis',
    }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/t2`), {
      tomado: true,
      registradoPor: 'ana',
    }),
  );
  await assertSucceeds(
    updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { inventario: 29 }),
  );
  await assertFails(
    updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { dosis: '1000 mg' }),
  );
  await assertFails(deleteDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`)));
  // Luis no puede auto-ascenderse ni meter a alguien más
  await assertFails(
    updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`), { rol: 'cuidador_principal' }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/otro`), { uid: 'otro', rol: 'familiar' }),
  );
});

test('roles: el responsable puede hacer responsable a otro familiar, pero no a un enfermero o médico', async () => {
  await anaCreaPersona();
  await perfil(pedro(), 'pedro', 'familiar');
  await perfil(marta(), 'marta', 'enfermero');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { uid: 'pedro', rol: 'familiar', nombre: 'Pedro' });
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/marta`), { uid: 'marta', rol: 'cuidador_turno', nombre: 'Marta' });
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion('pedro', 'marta') });
  });

  await assertSucceeds(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { rol: 'cuidador_principal' }),
  );
  await assertSucceeds(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { rol: 'familiar' }),
  );
  await assertFails(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/marta`), { rol: 'cuidador_principal' }),
  );
  await assertFails(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/marta`), { rol: 'medico' }),
  );
  // un familiar sin ser responsable no puede cambiar roles
  await assertFails(
    updateDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { rol: 'cuidador_principal' }),
  );
});

test('roles: quien dio de alta a la persona (familiar) puede recuperar el rol de responsable; un invitado no', async () => {
  await anaCreaPersona();
  await perfil(pedro(), 'pedro', 'familiar');
  // Simula datos de la versión anterior: la creadora quedó como "familiar" y hay otro familiar invitado
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { rol: 'familiar' });
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { uid: 'pedro', rol: 'familiar', nombre: 'Pedro' });
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion('pedro') });
  });

  await assertFails(
    updateDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { rol: 'cuidador_principal' }),
  );
  await assertFails(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { rol: 'cuidador_principal', nombre: 'Otra' }),
  );
  await assertSucceeds(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { rol: 'cuidador_principal' }),
  );
  const ana2 = await getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`));
  assert.equal(ana2.data().rol, 'cuidador_principal');
});

test('roles: el familiar coordina el calendario, escribe en la bitácora y registra tomas, pero no define medicamentos', async () => {
  await anaCreaPersona();
  await agregarLuisComo('familiar');
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/eventos_calendario/c1`), {
      tipo: 'cita',
      titulo: 'Cardiólogo',
    }),
  );
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e1`), {
      tipo: 'nota',
      texto: 'Comió bien',
      autorUid: 'luis',
    }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m9`), { nombre: 'X', dosis: '1', horarios: [] }),
  );
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 10, activo: true });
  });
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/20260914-0800`), { tomado: true, registradoPor: 'luis' }),
  );
  await assertSucceeds(
    updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { inventario: 9 }),
  );
});

// ---------------------------------------------------------------------------
// Invitaciones (compartir por código / QR): el rol lo decide el tipo de cuenta de quien entra
// ---------------------------------------------------------------------------

const CODIGO = 'ABCDEFGH';

function enDias(dias) {
  return Timestamp.fromDate(new Date(Date.now() + dias * 24 * 3600 * 1000));
}

/** Ana (responsable) crea una invitación; mismo shape que InvitacionesService.crear(). */
async function anaCreaInvitacion(extra = {}) {
  await setDoc(doc(ana(), `invitaciones/${CODIGO}`), {
    codigo: CODIGO,
    personaId: PERSONA_ID,
    personaNombre: 'Mamá',
    creadoPor: 'ana',
    creadoEn: serverTimestamp(),
    expiraEn: enDias(7),
    activa: true,
    usos: 0,
    usosMax: 5,
    ...extra,
  });
}

/** Mismo batch que InvitacionesService.canjear() (sin el perfil en `usuarios`). */
function batchUnirse(db, uid, codigo, rol) {
  const b = writeBatch(db);
  b.update(doc(db, `invitaciones/${codigo}`), { usos: increment(1) });
  b.set(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/${uid}`), {
    uid,
    rol,
    nombre: uid,
    agregadoEn: serverTimestamp(),
    invitacionCodigo: codigo,
  });
  b.update(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion(uid) });
  return b.commit();
}

test('invitaciones: solo el responsable las crea; se leen por código pero no se listan', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');

  await assertSucceeds(anaCreaInvitacion());
  await assertFails(
    setDoc(doc(luis(), 'invitaciones/ZZZZZZZZ'), {
      codigo: 'ZZZZZZZZ',
      personaId: PERSONA_ID,
      creadoPor: 'luis',
      expiraEn: enDias(7),
      activa: true,
      usos: 0,
      usosMax: 5,
    }),
  );

  // Cualquiera autenticado puede leer UNA invitación si conoce el código...
  await assertSucceeds(getDoc(doc(pedro(), `invitaciones/${CODIGO}`)));
  await assertFails(getDoc(doc(anon(), `invitaciones/${CODIGO}`)));
  // ...pero solo el responsable puede listar las de su persona
  await assertSucceeds(
    getDocs(query(collection(ana(), 'invitaciones'), where('personaId', '==', PERSONA_ID))),
  );
  await assertFails(getDocs(collection(pedro(), 'invitaciones')));
});

test('invitaciones: cada tipo de cuenta entra con su rol (familiar, enfermero, médico)', async () => {
  await anaCreaPersona();
  await anaCreaInvitacion();
  await perfil(pedro(), 'pedro', 'familiar');
  await perfil(marta(), 'marta', 'enfermero');
  await perfil(luis(), 'luis', 'medico');

  await assertFails(getDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}`)));
  await assertSucceeds(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'));
  await assertSucceeds(batchUnirse(marta(), 'marta', CODIGO, 'cuidador_turno'));
  await assertSucceeds(batchUnirse(luis(), 'luis', CODIGO, 'medico'));

  const persona = await getDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}`));
  assert.deepEqual(persona.data().miembrosUids, ['ana', 'pedro', 'marta', 'luis']);
  const inv = await getDoc(doc(ana(), `invitaciones/${CODIGO}`));
  assert.equal(inv.data().usos, 3);

  // Pedro (familiar) y Marta (enfermera) escriben en la bitácora; Luis (médico) no
  await assertSucceeds(
    setDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/eventos_calendario/c1`), { tipo: 'cita', titulo: 'Dentista' }),
  );
  await assertSucceeds(
    setDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e9`), { tipo: 'nota', texto: 'x', autorUid: 'pedro' }),
  );
  await assertSucceeds(
    setDoc(doc(marta(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e8`), { tipo: 'nota', texto: 'x', autorUid: 'marta' }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/e7`), { tipo: 'nota', texto: 'x', autorUid: 'luis' }),
  );
});

test('invitaciones: no se puede reclamar un rol distinto al de la cuenta ni usar una vencida, cancelada, agotada o inexistente', async () => {
  await anaCreaPersona();
  await perfil(pedro(), 'pedro', 'familiar');
  await perfil(luis(), 'luis', 'medico');

  await anaCreaInvitacion();
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'cuidador_principal'));
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'cuidador_turno'));
  await assertFails(batchUnirse(luis(), 'luis', CODIGO, 'cuidador_turno'));
  await assertFails(batchUnirse(pedro(), 'pedro', 'NOEXISTE', 'familiar'));

  await anaCreaInvitacion({ expiraEn: enDias(-1) });
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'));

  await anaCreaInvitacion({ activa: false });
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'));

  await anaCreaInvitacion({ usos: 5, usosMax: 5 });
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'));

  // Sin invitación nadie puede meterse a miembrosUids por su cuenta
  await assertFails(
    updateDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion('pedro') }),
  );
});

test('invitaciones: el responsable puede cancelarla; quien la canjea solo suma 1 a usos', async () => {
  await anaCreaPersona();
  await anaCreaInvitacion();
  await perfil(pedro(), 'pedro', 'familiar');

  await assertFails(updateDoc(doc(pedro(), `invitaciones/${CODIGO}`), { usos: increment(3) }));
  await assertFails(updateDoc(doc(pedro(), `invitaciones/${CODIGO}`), { personaId: 'otra' }));
  await assertSucceeds(updateDoc(doc(ana(), `invitaciones/${CODIGO}`), { activa: false }));
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'));
});
