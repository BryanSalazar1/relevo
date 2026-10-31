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
  arrayRemove,
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
async function anaCreaPersona(extraMiembro = {}) {
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
    ...extraMiembro,
  });
  batch.update(doc(db, 'usuarios/ana'), { personas: arrayUnion(PERSONA_ID) });
  return batch.commit();
}

/** Agrega a `uid` a la persona con el rol indicado, saltándose las reglas. */
async function agregarComo(uid, rol) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/${uid}`), {
      uid,
      rol,
      nombre: uid.charAt(0).toUpperCase() + uid.slice(1),
      agregadoEn: serverTimestamp(),
    });
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion(uid) });
  });
}

/** Agrega a `luis` a la persona con el rol indicado, saltándose las reglas. */
function agregarLuisComo(rol) {
  return agregarComo('luis', rol);
}

// ---------------------------------------------------------------------------

test('usuarios: cada quien crea, edita y borra solo su propio perfil, con tipo de cuenta obligatorio', async () => {
  await assertFails(setDoc(doc(ana(), 'usuarios/ana'), { uid: 'ana', nombre: 'Ana' })); // sin tipo
  await assertFails(setDoc(doc(ana(), 'usuarios/ana'), { uid: 'ana', nombre: 'Ana', tipo: 'jefe' }));
  await assertSucceeds(perfil(ana(), 'ana', 'familiar'));
  await assertFails(perfil(ana(), 'luis', 'medico')); // el perfil de otro
  // El perfil (correo, tokens, equipos) lo lee solo su dueño: ni otro usuario ni una lista de todos
  await assertSucceeds(getDoc(doc(ana(), 'usuarios/ana')));
  await assertFails(getDoc(doc(luis(), 'usuarios/ana')));
  await assertFails(getDocs(collection(luis(), 'usuarios')));
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
      horaProgramada: Timestamp.now(),
    }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/t2`), {
      tomado: true,
      registradoPor: 'ana',
      horaProgramada: Timestamp.now(),
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

test('roles: nadie se hace responsable a sí mismo, ni quien dio de alta a la persona (la recuperación de versiones viejas se retiró el 13/10/2026)', async () => {
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
  await assertFails(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { rol: 'cuidador_principal' }),
  );
  const ana2 = await getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`));
  assert.equal(ana2.data().rol, 'familiar');
});

test('miembros: al crearse pueden traer sus avisos por defecto, solo con valores válidos', async () => {
  await assertSucceeds(anaCreaPersona({ avisos: 'importantes' }));
  const m = await getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`));
  assert.equal(m.data().avisos, 'importantes');
  await env.clearFirestore();
  await assertFails(anaCreaPersona({ avisos: 'raro' }));
});

test('indicaciones: solo el médico escribe y edita indicaciones médicas, y no escribe otros tipos; el responsable las borra pero no las edita', async () => {
  await anaCreaPersona();
  await agregarComo('luis', 'medico');
  await agregarComo('pedro', 'familiar');
  const entrada = (db, id) => doc(db, `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/${id}`);
  await assertSucceeds(setDoc(entrada(luis(), 'i1'), { tipo: 'indicacion', texto: 'Subir Losartán a 100 mg', autorUid: 'luis' }));
  await assertFails(setDoc(entrada(luis(), 'n1'), { tipo: 'nota', texto: 'Hola', autorUid: 'luis' }));
  await assertFails(setDoc(entrada(pedro(), 'i2'), { tipo: 'indicacion', texto: 'Yo no soy médico', autorUid: 'pedro' }));
  await assertFails(setDoc(entrada(ana(), 'i3'), { tipo: 'indicacion', texto: 'Ni la responsable', autorUid: 'ana' }));
  // Nadie convierte una nota en indicación
  await assertSucceeds(setDoc(entrada(pedro(), 'n2'), { tipo: 'nota', texto: 'Comió bien', autorUid: 'pedro' }));
  await assertFails(updateDoc(entrada(pedro(), 'n2'), { tipo: 'indicacion' }));
  // El médico edita la suya; la responsable no la edita pero sí la borra; todos la leen
  await assertSucceeds(updateDoc(entrada(luis(), 'i1'), { texto: 'Subir Losartán a 100 mg si sigue alta' }));
  await assertFails(updateDoc(entrada(ana(), 'i1'), { texto: 'Cambiada por la responsable' }));
  await assertSucceeds(getDoc(entrada(pedro(), 'i1')));
  await assertSucceeds(deleteDoc(entrada(ana(), 'i1')));
});

test('consulta: preguntas para el médico compartidas (las escribe quien escribe en la bitácora); momento de la glucosa y caída con valores válidos', async () => {
  await anaCreaPersona();
  await agregarComo('pedro', 'familiar');
  await agregarComo('luis', 'medico');
  const preguntas = (db, id = 'preguntas') => doc(db, `personas_cuidadas/${PERSONA_ID}/consulta/${id}`);
  const firmada = (uid, texto) => ({ texto, actualizadoPor: uid, actualizadoNombre: uid, actualizadoEn: serverTimestamp() });
  await assertSucceeds(setDoc(preguntas(pedro()), firmada('pedro', '¿Conviene bajar la dosis?')));
  await assertSucceeds(setDoc(preguntas(ana()), firmada('ana', 'Otra pregunta')));
  await assertFails(setDoc(preguntas(luis()), firmada('luis', 'El médico no escribe preguntas')));
  await assertFails(setDoc(preguntas(pedro()), firmada('pedro', 'x'.repeat(1001))));
  await assertFails(setDoc(preguntas(pedro()), firmada('ana', 'firma ajena')));
  await assertFails(setDoc(preguntas(pedro(), 'otro'), firmada('pedro', 'solo el documento preguntas')));
  await assertSucceeds(getDoc(preguntas(luis())));
  await assertFails(deleteDoc(preguntas(pedro())));
  await assertSucceeds(deleteDoc(preguntas(ana())));

  const signo = (db, id) => doc(db, `personas_cuidadas/${PERSONA_ID}/signos_vitales/${id}`);
  const glucosa = (extra) => ({ tipo: 'glucosa', valor: 110, valorSecundario: null, unidad: 'mg/dL', fecha: Timestamp.now(), autorUid: 'pedro', ...extra });
  await assertSucceeds(setDoc(signo(pedro(), 's1'), glucosa({ momento: 'ayunas' })));
  await assertSucceeds(setDoc(signo(pedro(), 's2'), glucosa({})));
  await assertFails(setDoc(signo(pedro(), 's3'), glucosa({ momento: 'madrugada' })));

  const entrada = (db, id) => doc(db, `personas_cuidadas/${PERSONA_ID}/entradas_bitacora/${id}`);
  await assertSucceeds(setDoc(entrada(pedro(), 'e1'), { tipo: 'incidente', texto: 'Se cayó en el baño', autorUid: 'pedro', caida: true, lesion: false }));
  await assertFails(setDoc(entrada(pedro(), 'e2'), { tipo: 'incidente', texto: 'Se cayó', autorUid: 'pedro', caida: 'sí' }));
});

test('equipo: un miembro sale por su cuenta (mismo batch que MiembrosService.salir); el responsable no, y nadie saca a otro así', async () => {
  await anaCreaPersona();
  await perfil(luis(), 'luis', 'familiar');
  await perfil(marta(), 'marta', 'enfermero');
  await agregarComo('luis', 'familiar');
  await agregarComo('marta', 'cuidador_turno');
  const salir = (db, uid) => {
    const b = writeBatch(db);
    b.delete(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/${uid}`));
    b.update(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayRemove(uid) });
    b.update(doc(db, `usuarios/${uid}`), { personas: arrayRemove(PERSONA_ID) });
    return b.commit();
  };
  await assertFails(salir(luis(), 'marta')); // a otro no
  await assertFails(salir(ana(), 'ana')); // el responsable no se va: cede el rol o elimina a la persona
  await assertSucceeds(salir(luis(), 'luis'));
  const p = await getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}`));
  assert.deepEqual(p.data().miembrosUids, ['ana', 'marta']);
  // Ya fuera, no lee nada
  await assertFails(getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}`)));
});

test('roles: el familiar coordina el calendario, escribe en la bitácora y registra tomas, pero no define medicamentos', async () => {
  await anaCreaPersona();
  await agregarLuisComo('familiar');
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/eventos_calendario/c1`), {
      tipo: 'cita',
      titulo: 'Cardiólogo',
      inicio: Timestamp.fromDate(new Date('2026-10-20T10:00:00')),
      fin: Timestamp.fromDate(new Date('2026-10-20T11:00:00')),
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
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/20260914-0800`), { tomado: true, registradoPor: 'luis', horaProgramada: Timestamp.now() }),
  );
  await assertSucceeds(
    updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { inventario: 9 }),
  );
});

test('signos vitales sueltos (sin tarea): los registra quien marca tareas, con nota corta; el médico no', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  const suelto = { tipo: 'glucosa', valor: 110, valorSecundario: null, unidad: 'mg/dL', fecha: Timestamp.now(), autorUid: 'luis', autorNombre: 'Luis', nota: 'en ayunas' };
  await assertSucceeds(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/suelto-1-glucosa`), suelto));
  await assertFails(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/suelto-2-glucosa`), { ...suelto, nota: 'x'.repeat(201) }));
  await assertFails(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/suelto-3-glucosa`), { ...suelto, autorUid: 'ana' }));
  await perfil(pedro(), 'pedro', 'medico');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { uid: 'pedro', rol: 'medico', nombre: 'Pedro' });
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion('pedro') });
  });
  await assertFails(setDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/suelto-4-glucosa`), { ...suelto, autorUid: 'pedro' }));
  await assertSucceeds(getDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/signos_vitales/suelto-1-glucosa`)));
});

test('signos vitales: los registra quien marca tareas (también el familiar), firmados y con valores válidos; el médico solo lee', async () => {
  await anaCreaPersona();
  const signo = (db, id) => doc(db, `personas_cuidadas/${PERSONA_ID}/signos_vitales/${id}`);
  const presion = { tipo: 'presion', valor: 130, valorSecundario: 85, unidad: 'mmHg', autorUid: 'luis', tareaId: 't1' };

  await agregarLuisComo('familiar');
  await assertSucceeds(setDoc(signo(luis(), 't1-20260921-0800-presion'), presion));
  // corregir el registro reescribe la misma medición
  await assertSucceeds(setDoc(signo(luis(), 't1-20260921-0800-presion'), { ...presion, valor: 128 }));
  await assertSucceeds(setDoc(signo(luis(), 't1-20260921-0800-temperatura'), { tipo: 'temperatura', valor: 36.5, valorSecundario: null, autorUid: 'luis' }));
  // no a nombre de otro, ni tipos inventados, ni valores sin sentido
  await assertFails(setDoc(signo(luis(), 's2'), { ...presion, autorUid: 'ana' }));
  await assertFails(setDoc(signo(luis(), 's3'), { ...presion, tipo: 'colesterol' }));
  await assertFails(setDoc(signo(luis(), 's4'), { ...presion, valor: 'alta' }));
  await assertFails(setDoc(signo(luis(), 's5'), { ...presion, valor: -5 }));
  await assertFails(setDoc(signo(luis(), 's6'), { ...presion, valorSecundario: 99999 }));
  // quitar el registro borra sus mediciones, existan o no (van en un mismo batch)
  await assertSucceeds(deleteDoc(signo(luis(), 't1-20260921-0800-presion')));
  await assertSucceeds(deleteDoc(signo(luis(), 't1-20260921-0800-glucosa')));

  await agregarLuisComo('medico');
  await assertSucceeds(getDoc(signo(luis(), 't1-20260921-0800-temperatura')));
  await assertFails(setDoc(signo(luis(), 's7'), presion));
  await assertFails(deleteDoc(signo(luis(), 't1-20260921-0800-temperatura')));
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

/**
 * Mismo batch que InvitacionesService.canjear() (sin el perfil en `usuarios`). `usosQueSuma`
 * distinto de 1 simula un cliente modificado que intenta entrar sin gastar un uso (o gastando dos).
 */
function batchUnirse(db, uid, codigo, rol, usosQueSuma = 1) {
  const b = writeBatch(db);
  if (usosQueSuma !== 0) b.update(doc(db, `invitaciones/${codigo}`), { usos: increment(usosQueSuma) });
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
    setDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/eventos_calendario/c1`), {
      tipo: 'cita',
      titulo: 'Dentista',
      inicio: Timestamp.fromDate(new Date('2026-10-20T10:00:00')),
      fin: Timestamp.fromDate(new Date('2026-10-20T11:00:00')),
    }),
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
  // Sumar un uso sin unirse en el mismo batch no se permite (agotaría el código de otros)...
  await assertFails(updateDoc(doc(pedro(), `invitaciones/${CODIGO}`), { usos: increment(1) }));
  // ...ni unirse sin gastar un uso, ni gastando dos (usosMax dejaría de cumplirse)
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar', 0));
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar', 2));
  const sinCambios = await getDoc(doc(ana(), `invitaciones/${CODIGO}`));
  assert.equal(sinCambios.data().usos, 0);
  await assertSucceeds(updateDoc(doc(ana(), `invitaciones/${CODIGO}`), { activa: false }));
  await assertFails(batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'));
});

test('rutina: solo el responsable define tareas; enfermeros y familiares registran (firmado); el médico solo lee', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  const tarea = { tipo: 'comida', nombre: 'Desayuno', horarios: ['08:00'], avisarMin: 15, activo: true };
  await assertSucceeds(setDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/tareas/t1`), tarea));
  await assertFails(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t2`), { ...tarea, nombre: 'Baño' }));
  await assertFails(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1`), { nombre: 'Otro' }));
  await assertFails(deleteDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1`)));
  await assertSucceeds(getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1`)));
  // El de turno registra que se hizo, firmado por él
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r1`), { hecha: true, registradoPor: 'luis' }),
  );
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r2`), { hecha: true, registradoPor: 'ana' }),
  );
  await assertSucceeds(deleteDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r1`)));
  // Quitar un registro: solo quien lo hizo o la responsable; otro miembro puede corregirlo (firmado), no borrarlo
  await agregarComo('pedro', 'familiar');
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r4`), { hecha: true, registradoPor: 'luis' }),
  );
  await assertFails(deleteDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r4`)));
  // Un registro ajeno tampoco se corrige firmándolo otro
  await assertFails(
    setDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r4`), { hecha: false, registradoPor: 'pedro' }),
  );
  await assertSucceeds(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r4`), { hecha: false, registradoPor: 'luis' }),
  );
  await assertSucceeds(deleteDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r4`)));
  // El médico solo lee
  await agregarLuisComo('medico');
  await assertSucceeds(getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1`)));
  await assertFails(
    setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/r3`), { hecha: true, registradoPor: 'luis' }),
  );
  // Los recordatorios los escriben solo las Cloud Functions: desde la app nadie los lee ni escribe
  await assertFails(getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/recordatorios/x`)));
  await assertFails(setDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/recordatorios/x`), { enviado: true }));
});

test('turnos: el responsable define los turnos de cada miembro (y los suyos); un miembro no edita los propios', async () => {
  await anaCreaPersona();
  await perfil(luis(), 'luis', 'enfermero');
  await agregarLuisComo('cuidador_turno');
  const turnos = [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' }];
  await assertSucceeds(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`), { turnos }),
  );
  await assertSucceeds(
    updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { turnos }),
  );
  await assertFails(
    updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`), { turnos: [] }),
  );
  const m = await getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`));
  assert.deepEqual(m.data().turnos, turnos);
});

test('notificaciones: cada quien elige sus avisos (valores válidos) sin tocar su rol ni sus turnos', async () => {
  await anaCreaPersona();
  await perfil(luis(), 'luis', 'enfermero');
  await agregarLuisComo('cuidador_turno');
  const ref = doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`);
  await assertSucceeds(updateDoc(ref, { avisos: 'importantes', recordatorios: false, soloEnTurno: true }));
  await assertSucceeds(updateDoc(ref, { avisos: 'ninguno' }));
  await assertSucceeds(updateDoc(ref, { nombre: 'Luis P.', avisos: 'todos' }));
  await assertFails(updateDoc(ref, { avisos: 'raro' }));
  await assertFails(updateDoc(ref, { recordatorios: 'sí' }));
  await assertFails(updateDoc(ref, { avisos: 'todos', rol: 'cuidador_principal' }));
  await assertFails(updateDoc(ref, { avisos: 'todos', turnos: [] }));
  // Las preferencias de otro no se tocan
  await assertFails(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { avisos: 'ninguno' }));
  const m = await getDoc(ref);
  assert.equal(m.data().avisos, 'todos');
  assert.equal(m.data().recordatorios, false);
  assert.equal(m.data().soloEnTurno, true);
});

test('tomas: no se registran en un medicamento suspendido (corregir una ya registrada sí) y llevan hora programada', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 10, activo: true });
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/medicamentos/m2`), { nombre: 'Omeprazol', dosis: '20 mg', horarios: ['08:00'], inventario: 10, activo: false });
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/medicamentos/m2/tomas/vieja`), { tomado: true, registradoPor: 'luis', horaProgramada: Timestamp.now() });
  });
  await assertSucceeds(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/a`), { tomado: true, registradoPor: 'luis', horaProgramada: Timestamp.now() }));
  await assertFails(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/b`), { tomado: true, registradoPor: 'luis' }));
  await assertFails(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m2/tomas/nueva`), { tomado: true, registradoPor: 'luis', horaProgramada: Timestamp.now() }));
  await assertSucceeds(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m2/tomas/vieja`), { tomado: false, registradoPor: 'luis', horaProgramada: Timestamp.now() }));
  // La responsable crea un medicamento y sus tomas en el mismo batch (como las semillas de datos)
  const dbAna = ana();
  const b = writeBatch(dbAna);
  b.set(doc(dbAna, `personas_cuidadas/${PERSONA_ID}/medicamentos/m3`), { nombre: 'Omega 3', dosis: '1 tableta', horarios: ['08:00'], inventario: 10, activo: true });
  b.set(doc(dbAna, `personas_cuidadas/${PERSONA_ID}/medicamentos/m3/tomas/t1`), { tomado: true, registradoPor: 'ana', horaProgramada: Timestamp.now() });
  await assertSucceeds(b.commit());
});

test('quitar y corregir registros: una toma o una medición la cambia quien la hizo o la responsable; otro miembro no', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  await agregarComo('pedro', 'familiar');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 10, activo: true });
  });
  const toma = (db, id) => doc(db, `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/${id}`);
  const datos = { tomado: true, registradoPor: 'luis', horaProgramada: Timestamp.now() };
  await assertSucceeds(setDoc(toma(luis(), 'a'), datos));
  await assertSucceeds(setDoc(toma(luis(), 'b'), datos));
  await assertSucceeds(setDoc(toma(luis(), 'c'), datos));
  await assertFails(deleteDoc(toma(pedro(), 'a')));
  // Tampoco la corrige firmándola él (sería quedarse con el registro ajeno); la responsable sí
  await assertFails(setDoc(toma(pedro(), 'a'), { ...datos, tomado: false, registradoPor: 'pedro' }));
  await assertSucceeds(setDoc(toma(ana(), 'a'), { ...datos, tomado: false, registradoPor: 'ana' }));
  // Quien la registró la corrige
  await assertSucceeds(setDoc(toma(luis(), 'c'), { ...datos, tomado: false }));
  await assertSucceeds(deleteDoc(toma(luis(), 'b')));
  await assertSucceeds(deleteDoc(toma(ana(), 'c')));
  // Borrar una toma que no existe no tiene autor que proteger (la app borra en lote lo que pudo haber)
  await assertSucceeds(deleteDoc(toma(pedro(), 'no-existe')));

  const signo = (db, id) => doc(db, `personas_cuidadas/${PERSONA_ID}/signos_vitales/${id}`);
  await assertSucceeds(setDoc(signo(luis(), 's1'), { tipo: 'pulso', valor: 70, autorUid: 'luis' }));
  await assertSucceeds(setDoc(signo(luis(), 's2'), { tipo: 'pulso', valor: 72, autorUid: 'luis' }));
  await assertFails(deleteDoc(signo(pedro(), 's1')));
  // Ni reescribe la medición de otro (al volver a marcar una tarea de signos ajena)
  await assertFails(setDoc(signo(pedro(), 's1'), { tipo: 'pulso', valor: 80, autorUid: 'pedro' }));
  await assertSucceeds(setDoc(signo(pedro(), 's3'), { tipo: 'pulso', valor: 80, autorUid: 'pedro' }));
  await assertSucceeds(deleteDoc(signo(ana(), 's1')));
  await assertSucceeds(deleteDoc(signo(luis(), 's2')));
});

test('notas: quien registró edita su nota; el responsable solo la nota de otros; un tercero no', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  await perfil(pedro(), 'pedro', 'familiar');
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/miembros/pedro`), { uid: 'pedro', rol: 'familiar', nombre: 'Pedro' });
    await updateDoc(doc(db, `personas_cuidadas/${PERSONA_ID}`), { miembrosUids: arrayUnion('pedro') });
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`), { nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 10, activo: true });
    await setDoc(doc(db, `personas_cuidadas/${PERSONA_ID}/tareas/t1`), { tipo: 'comida', nombre: 'Desayuno', horarios: ['08:00'], avisarMin: 15, activo: true });
  });
  // Luis registra una toma y un registro de tarea, y edita sus propias notas
  await assertSucceeds(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/x`), { tomado: false, registradoPor: 'luis', horaProgramada: Timestamp.now() }));
  await assertSucceeds(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/x`), { nota: 'vomitó' }));
  await assertSucceeds(setDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/y`), { hecha: false, registradoPor: 'luis' }));
  await assertSucceeds(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/y`), { nota: 'no tenía hambre' }));
  // La responsable (Ana) cambia solo la nota; no puede cambiar otra cosa sin firmarla
  await assertSucceeds(updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/x`), { nota: 'vomitó a las 8' }));
  await assertSucceeds(updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/y`), { nota: 'comió poco después' }));
  await assertFails(updateDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1/tomas/x`), { tomado: true }));
  // Otro familiar no toca la nota de Luis
  await assertFails(updateDoc(doc(pedro(), `personas_cuidadas/${PERSONA_ID}/tareas/t1/registros/y`), { nota: 'x' }));
});

test('perfil: cada quien cambia solo su nombre en los equipos; no su rol ni el nombre de otro', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  await assertSucceeds(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`), { nombre: 'Luis P.' }));
  await assertFails(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`), { nombre: 'X', rol: 'cuidador_principal' }));
  await assertFails(updateDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/ana`), { nombre: 'Otra' }));
  const m = await getDoc(doc(luis(), `personas_cuidadas/${PERSONA_ID}/miembros/luis`));
  assert.equal(m.data().nombre, 'Luis P.');
});

test('medicamentos: el inventario nunca queda negativo y los datos del medicamento se validan', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  const med = (db, id = 'm1') => doc(db, `personas_cuidadas/${PERSONA_ID}/medicamentos/${id}`);
  const base = { nombre: 'Omega 3', dosis: '1 tableta', horarios: [], segunNecesidad: true, inventario: 1, activo: true };

  // La responsable no puede dar de alta datos inválidos
  await assertFails(setDoc(med(ana(), 'x1'), { ...base, inventario: -1 }));
  await assertFails(setDoc(med(ana(), 'x2'), { ...base, inventario: 2.5 }));
  await assertFails(setDoc(med(ana(), 'x3'), { ...base, nombre: '' }));
  await assertFails(setDoc(med(ana(), 'x4'), { ...base, dosis: 'x'.repeat(41) }));
  await assertFails(setDoc(med(ana(), 'x5'), { ...base, duracionDias: 0 }));
  await assertFails(setDoc(med(ana(), 'x6'), { ...base, duracionDias: 366 }));
  await assertFails(setDoc(med(ana(), 'x7'), { ...base, horarios: Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, '0')}:00`) }));
  await assertSucceeds(setDoc(med(ana()), base));
  await assertSucceeds(setDoc(med(ana(), 'm2'), { ...base, inventario: null, duracionDias: null, notas: '' }));

  // Mismo batch que MedicamentosService.registrarToma(): la toma + increment(-1)
  const tomar = (db, tomaId, uid) => {
    const b = writeBatch(db);
    b.set(doc(med(db), 'tomas', tomaId), { tomado: true, registradoPor: uid, horaProgramada: Timestamp.now() });
    b.update(med(db), { inventario: increment(-1) });
    return b.commit();
  };
  await assertSucceeds(tomar(luis(), 't1', 'luis')); // 1 -> 0
  await assertFails(tomar(luis(), 't2', 'luis')); // 0 -> -1: se rechaza el batch completo
  await assertFails(tomar(ana(), 't3', 'ana')); // tampoco la responsable
  assert.equal((await getDoc(med(ana()))).data().inventario, 0);
  // Con 0 unidades la app registra la toma sin tocar el inventario
  await assertSucceeds(setDoc(doc(med(luis()), 'tomas', 't2'), { tomado: true, registradoPor: 'luis', sinDescuento: true, horaProgramada: Timestamp.now() }));

  // Quien registra tomas mueve el inventario de uno en uno; la responsable lo fija al resurtir
  await assertFails(updateDoc(med(luis()), { inventario: 50 }));
  await assertSucceeds(updateDoc(med(ana()), { inventario: 50 }));
  await assertFails(updateDoc(med(ana()), { inventario: -5 }));
  await assertSucceeds(updateDoc(med(luis()), { inventario: increment(1) }));

  // Mismo update que MedicamentosService.resurtir(): solo la responsable, y con un resurtido válido
  await assertSucceeds(updateDoc(med(ana()), { inventario: increment(30), ultimoResurtido: 30 }));
  await assertFails(updateDoc(med(luis()), { inventario: increment(30), ultimoResurtido: 30 }));
  await assertFails(updateDoc(med(ana()), { inventario: increment(30), ultimoResurtido: 0 }));
  assert.equal((await getDoc(med(ana()))).data().inventario, 81);

  // Un negativo que venga de versiones anteriores no bloquea: se puede suspender y reparar a 0
  await env.withSecurityRulesDisabled((ctx) => updateDoc(med(ctx.firestore()), { inventario: -1 }));
  await assertSucceeds(updateDoc(med(ana()), { activo: false }));
  await assertFails(updateDoc(med(luis()), { inventario: increment(-1) }));
  await assertSucceeds(updateDoc(med(luis()), { inventario: 0 }));

  // Tomas: `tomado` es booleano, la nota tiene tope y llevan hora programada (se prueba con el medicamento activo)
  await assertSucceeds(updateDoc(med(ana()), { activo: true }));
  await assertFails(setDoc(doc(med(luis()), 'tomas', 't8'), { tomado: 'si', registradoPor: 'luis', horaProgramada: Timestamp.now() }));
  await assertFails(setDoc(doc(med(luis()), 'tomas', 't9'), { tomado: true, registradoPor: 'luis', nota: 'x'.repeat(201), horaProgramada: Timestamp.now() }));
  await assertFails(setDoc(doc(med(luis()), 'tomas', 't10'), { tomado: true, registradoPor: 'luis' }));
});

test('citas: el responsable y los familiares agendan, editan y borran citas válidas; enfermeros y médicos solo las ven', async () => {
  await anaCreaPersona();
  await agregarComo('pedro', 'familiar');
  await agregarComo('marta', 'cuidador_turno');
  await agregarComo('luis', 'medico');
  const cita = (db, id = 'c1') => doc(db, `personas_cuidadas/${PERSONA_ID}/eventos_calendario/${id}`);
  const inicio = Timestamp.fromDate(new Date('2026-10-20T10:00:00'));
  const fin = Timestamp.fromDate(new Date('2026-10-20T11:00:00'));
  const valida = { tipo: 'cita', titulo: 'Cardiólogo', inicio, fin, lugar: 'Hospital', notas: '', responsableUid: 'pedro', avisarMin: 60 };

  await assertSucceeds(setDoc(cita(ana()), valida));
  await assertSucceeds(updateDoc(cita(pedro()), { titulo: 'Cardiólogo — control', avisarMin: 1440 }));
  await assertFails(setDoc(cita(marta(), 'c2'), valida));
  await assertFails(setDoc(cita(luis(), 'c3'), valida));
  await assertSucceeds(getDoc(cita(marta())));
  await assertSucceeds(getDoc(cita(luis())));

  // Datos inválidos: termina antes de empezar, sin título, tipo desconocido, aviso negativo, notas largas, fecha como texto
  await assertFails(setDoc(cita(ana(), 'c4'), { ...valida, fin: Timestamp.fromDate(new Date('2026-10-20T09:00:00')) }));
  await assertFails(setDoc(cita(ana(), 'c5'), { ...valida, titulo: '' }));
  await assertFails(setDoc(cita(ana(), 'c6'), { ...valida, tipo: 'fiesta' }));
  await assertFails(setDoc(cita(ana(), 'c7'), { ...valida, avisarMin: -5 }));
  await assertFails(setDoc(cita(ana(), 'c8'), { ...valida, notas: 'x'.repeat(301) }));
  await assertFails(setDoc(cita(ana(), 'c9'), { ...valida, inicio: '2026-10-20' }));

  await assertFails(deleteDoc(cita(marta())));
  await assertSucceeds(deleteDoc(cita(pedro())));
});

// ---------------------------------------------------------------------------
// Evidencias pedidas en la preevaluación (28/10/2026): aislamiento, revocación y canjes simultáneos

test('aislamiento: el miembro de una persona no lee ni escribe nada de otra persona cuidada', async () => {
  await anaCreaPersona();
  await agregarComo('marta', 'cuidador_turno');
  // Otra persona cuidada, de otro equipo (Pedro es su responsable)
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'personas_cuidadas/otra'), { nombre: 'Don José', miembrosUids: ['pedro'] });
    await setDoc(doc(db, 'personas_cuidadas/otra/miembros/pedro'), { uid: 'pedro', rol: 'cuidador_principal' });
    await setDoc(doc(db, 'personas_cuidadas/otra/entradas_bitacora/e1'), { tipo: 'sintoma', texto: 'Mareo', autorUid: 'pedro' });
    await setDoc(doc(db, 'personas_cuidadas/otra/signos_vitales/s1'), { tipo: 'pulso', valor: 80, autorUid: 'pedro' });
    await setDoc(doc(db, 'personas_cuidadas/otra/medicamentos/m1'), { nombre: 'X', dosis: '1', horarios: [], inventario: null, activo: true });
  });
  const otra = 'personas_cuidadas/otra';
  for (const db of [marta(), ana()]) {
    await assertFails(getDoc(doc(db, otra)));
    await assertFails(getDocs(collection(db, `${otra}/entradas_bitacora`)));
    await assertFails(getDocs(collection(db, `${otra}/signos_vitales`)));
    await assertFails(getDocs(collection(db, `${otra}/medicamentos`)));
    await assertFails(getDocs(collection(db, `${otra}/miembros`)));
    await assertFails(setDoc(doc(db, `${otra}/entradas_bitacora/x`), { tipo: 'nota', texto: 'x', autorUid: 'marta' }));
  }
  // Tampoco se puede listar todas las personas, solo las propias
  await assertFails(getDocs(collection(marta(), 'personas_cuidadas')));
  const mias = await getDocs(query(collection(marta(), 'personas_cuidadas'), where('miembrosUids', 'array-contains', 'marta')));
  assert.deepEqual(mias.docs.map((d) => d.id), [PERSONA_ID]);
});

test('revocación: al quitar a un miembro pierde de inmediato la lectura y la escritura', async () => {
  await anaCreaPersona();
  await agregarComo('marta', 'cuidador_turno');
  const p = `personas_cuidadas/${PERSONA_ID}`;
  await assertSucceeds(getDoc(doc(marta(), p)));
  await assertSucceeds(setDoc(doc(marta(), `${p}/entradas_bitacora/antes`), { tipo: 'nota', texto: 'ok', autorUid: 'marta' }));
  // Mismo batch que MiembrosService.quitar(): borra su miembro y lo saca de miembrosUids
  const dbAna = ana();
  const b = writeBatch(dbAna);
  b.delete(doc(dbAna, `${p}/miembros/marta`));
  b.update(doc(dbAna, p), { miembrosUids: arrayRemove('marta') });
  await assertSucceeds(b.commit());
  await assertFails(getDoc(doc(marta(), p)));
  await assertFails(getDocs(collection(marta(), `${p}/entradas_bitacora`)));
  await assertFails(getDoc(doc(marta(), `${p}/entradas_bitacora/antes`)));
  await assertFails(setDoc(doc(marta(), `${p}/entradas_bitacora/despues`), { tipo: 'nota', texto: 'x', autorUid: 'marta' }));
  // Y no puede volver a agregarse sola sin una invitación válida
  await assertFails(
    setDoc(doc(marta(), `${p}/miembros/marta`), { uid: 'marta', rol: 'cuidador_turno', nombre: 'Marta' }),
  );
});

test('invitaciones: dos canjes simultáneos del último uso → entra uno solo y usos no pasa del máximo', async () => {
  await anaCreaPersona();
  await anaCreaInvitacion();
  // Ya se gastaron 4 de 5 usos
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `invitaciones/${CODIGO}`), { usos: 4 });
  });
  await perfil(pedro(), 'pedro', 'familiar');
  await perfil(marta(), 'marta', 'enfermero');
  const r = await Promise.allSettled([
    batchUnirse(pedro(), 'pedro', CODIGO, 'familiar'),
    batchUnirse(marta(), 'marta', CODIGO, 'cuidador_turno'),
  ]);
  const ok = r.filter((x) => x.status === 'fulfilled').length;
  const inv = await getDoc(doc(ana(), `invitaciones/${CODIGO}`));
  const persona = await getDoc(doc(ana(), `personas_cuidadas/${PERSONA_ID}`));
  assert.ok(ok <= 1, `entraron ${ok} con un solo uso disponible`);
  assert.ok(inv.data().usos <= 5, `usos quedó en ${inv.data().usos}`);
  assert.equal(persona.data().miembrosUids.length, 1 + ok);
});

test('uso de la IA: el contador diario solo lo escriben las funciones; nadie lo lee ni lo cambia desde la app', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'uso_ia/ana'), { fecha: '2026-10-31', usados: 30 });
  });
  await assertFails(getDoc(doc(ana(), 'uso_ia/ana')));
  await assertFails(setDoc(doc(ana(), 'uso_ia/ana'), { fecha: '2026-10-31', usados: 0 }));
  await assertFails(deleteDoc(doc(ana(), 'uso_ia/ana')));
  await assertFails(getDoc(doc(luis(), 'uso_ia/ana')));
});

test('medicamentos: la fecha de cambio de tratamiento la guarda el responsable y debe ser una fecha', async () => {
  await anaCreaPersona();
  const ref = doc(ana(), `personas_cuidadas/${PERSONA_ID}/medicamentos/m1`);
  await assertSucceeds(setDoc(ref, { nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 10, activo: true }));
  await assertSucceeds(updateDoc(ref, { dosis: '100 mg', tratamientoCambiadoEn: serverTimestamp() }));
  await assertFails(updateDoc(ref, { dosis: '50 mg', tratamientoCambiadoEn: 'ayer' }));
});

test('según necesidad: indicación del médico en el medicamento y motivo de la toma, con valores válidos', async () => {
  await anaCreaPersona();
  await agregarLuisComo('cuidador_turno');
  const med = doc(ana(), `personas_cuidadas/${PERSONA_ID}/medicamentos/prn`);
  const base = { nombre: 'Paracetamol', dosis: '500 mg', horarios: [], segunNecesidad: true, inventario: 20, activo: true };
  await assertSucceeds(setDoc(med, { ...base, condicion: 'si hay dolor', maxAlDia: 3, horasEntreTomas: 8 }));
  await assertSucceeds(updateDoc(med, { maxAlDia: null, horasEntreTomas: null, condicion: '' }));
  await assertFails(updateDoc(med, { maxAlDia: 0 }));
  await assertFails(updateDoc(med, { maxAlDia: 30 }));
  await assertFails(updateDoc(med, { horasEntreTomas: 2.5 }));
  await assertFails(updateDoc(med, { condicion: 'x'.repeat(81) }));
  // El cuidador de turno registra la toma con motivo e intensidad
  const toma = (id) => doc(luis(), `personas_cuidadas/${PERSONA_ID}/medicamentos/prn/tomas/${id}`);
  const datos = { tomado: true, horaProgramada: Timestamp.now(), registradoPor: 'luis', aDemanda: true };
  await assertSucceeds(setDoc(toma('t1'), { ...datos, motivo: 'dolor', intensidad: 7 }));
  await assertSucceeds(setDoc(toma('t2'), { ...datos, motivo: 'fiebre' }));
  await assertFails(setDoc(toma('t3'), { ...datos, motivo: 'aburrimiento' }));
  await assertFails(setDoc(toma('t4'), { ...datos, motivo: 'dolor', intensidad: 11 }));
  await assertFails(setDoc(toma('t5'), { ...datos, motivo: 'dolor', intensidad: 5.5 }));
});

test('semáforo compartido: solo el responsable crea o cambia el enlace; nadie lee los tokens desde la app', async () => {
  await anaCreaPersona();
  await agregarComo('marta', 'cuidador_turno');
  const T1 = 'a'.repeat(20) + 'B_-'.repeat(4); // 32 caracteres
  const T2 = 'z9'.repeat(18);
  const persona = (db) => doc(db, `personas_cuidadas/${PERSONA_ID}`);
  const enlace = (db, t) => doc(db, `semaforos_compartidos/${t}`);
  const crear = (db, uid, nuevo, viejo) => {
    const b = writeBatch(db);
    b.update(persona(db), { enlaceSemaforo: nuevo });
    b.set(enlace(db, nuevo), { personaId: PERSONA_ID, creadoPor: uid, creadoEn: serverTimestamp() });
    if (viejo) b.delete(enlace(db, viejo));
    return b.commit();
  };

  // La enfermera no puede crear el enlace
  await assertFails(crear(marta(), 'marta', T1));
  // El responsable sí, en un solo batch
  await assertSucceeds(crear(ana(), 'ana', T1));
  // Los miembros ven el token en la persona (para copiarlo o mostrar el QR)...
  const p = await assertSucceeds(getDoc(persona(marta())));
  assert.equal(p.data().enlaceSemaforo, T1);
  // ...pero nadie lee ni lista la colección de enlaces desde la app (solo la Cloud Function)
  await assertFails(getDoc(enlace(ana(), T1)));
  await assertFails(getDoc(enlace(anon(), T1)));
  await assertFails(getDocs(collection(ana(), 'semaforos_compartidos')));
  // Un token vigente no se puede borrar suelto (dejaría la persona apuntando a nada)
  await assertFails(deleteDoc(enlace(ana(), T1)));
  // Apuntar la persona a un token que no se creó para ella, o con formato inválido
  await assertFails(updateDoc(persona(ana()), { enlaceSemaforo: T2 }));
  await assertFails(crear(ana(), 'ana', 'corto'));
  // Crear el documento de un token que no es el que queda en la persona
  await assertFails(
    setDoc(enlace(ana(), T2), { personaId: PERSONA_ID, creadoPor: 'ana', creadoEn: serverTimestamp() }),
  );
  // Campos extra o a nombre de otro
  const dbAna = ana();
  const b = writeBatch(dbAna);
  b.update(persona(dbAna), { enlaceSemaforo: T2 });
  b.set(enlace(dbAna, T2), { personaId: PERSONA_ID, creadoPor: 'marta', creadoEn: serverTimestamp() });
  await assertFails(b.commit());
  // Cambiar el enlace: el nuevo queda y el anterior se borra en el mismo batch
  await assertSucceeds(crear(ana(), 'ana', T2, T1));
  await env.withSecurityRulesDisabled(async (ctx) => {
    assert.equal((await getDoc(enlace(ctx.firestore(), T1))).exists(), false);
    assert.equal((await getDoc(enlace(ctx.firestore(), T2))).data().personaId, PERSONA_ID);
  });
  // Editar otros datos de la persona sigue funcionando igual
  await assertSucceeds(updateDoc(persona(ana()), { descripcion: 'Le gusta caminar' }));
});
