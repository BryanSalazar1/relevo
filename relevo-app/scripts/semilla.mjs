// Semilla de datos de prueba.
//
//   npm run semilla          -> EMULADORES (requiere `npm run emulators` en otra terminal)
//   npm run semilla:real     -> tu proyecto REAL de Firebase (lee src/environments/firebase.config.ts;
//                               requiere Auth Email/Contraseña habilitado y Firestore creado)
//
// Crea 4 usuarios (uno por rol), una persona cuidada y datos de ejemplo. Es idempotente:
// puedes correrla varias veces. Escribe con el SDK cliente y pasando por las Security Rules,
// así que además sirve como prueba del flujo real.

import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  Timestamp,
  arrayUnion,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { asegurarVerificada, franjasDeTurnos } from './semilla-utils.mjs';

const PROJECT_ID = 'demo-relevo';
const PASSWORD = 'relevo123';
const PERSONA_ID = 'persona-demo';

// tipo = tipo de cuenta (familiar | enfermero | medico); rol = rol dentro de la persona cuidada
export const USUARIOS = [
  { uid: 'ana', email: 'ana@relevo.test', nombre: 'Ana García', tipo: 'familiar', rol: 'cuidador_principal' },
  { uid: 'marta', email: 'marta@relevo.test', nombre: 'Marta López', tipo: 'enfermero', rol: 'cuidador_turno' },
  { uid: 'sofia', email: 'sofia@relevo.test', nombre: 'Sofía García', tipo: 'familiar', rol: 'familiar' },
  { uid: 'luis', email: 'luis@relevo.test', nombre: 'Dr. Luis Pérez', tipo: 'medico', rol: 'medico' },
];

const REAL = process.argv.includes('--real');

/** Lee el objeto firebaseConfig de firebase.config.ts sin compilar TypeScript. */
function leerConfigReal() {
  const src = readFileSync(new URL('../src/environments/firebase.config.ts', import.meta.url), 'utf8');
  const bloque = src.match(/firebaseConfig\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  const cfg = {};
  for (const m of bloque.matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) cfg[m[1]] = m[2];
  if (!cfg.apiKey || cfg.apiKey.startsWith('TU_')) {
    console.error('firebase.config.ts todavía tiene los placeholders "TU_...". Pega tu config real primero.');
    process.exit(1);
  }
  return cfg;
}

const app = initializeApp(REAL ? leerConfigReal() : { projectId: PROJECT_ID, apiKey: 'demo-api-key' });
const auth = getAuth(app);
const db = getFirestore(app);
if (REAL) {
  console.log(`>>> Sembrando en el proyecto REAL: ${app.options.projectId}\n`);
} else {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', Number(process.env.FIRESTORE_PORT ?? 8080));
}

const uids = {}; // email -> uid real que asigna el emulador

const hace = (dias, hora = 9, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora, min, 0, 0);
  return Timestamp.fromDate(d);
};

/** Id de toma o registro de tarea como lo arma la app: yyyyMMdd-HHmm de la hora programada */
const idDe = (ts) => {
  const d = ts.toDate();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

async function entrarComo(u) {
  let user;
  try {
    const cred = await createUserWithEmailAndPassword(auth, u.email, PASSWORD);
    await updateProfile(cred.user, { displayName: u.nombre });
    console.log(`  + creado ${u.email}`);
    user = cred.user;
  } catch (e) {
    if (e.code !== 'auth/email-already-in-use') throw e;
    user = (await signInWithEmailAndPassword(auth, u.email, PASSWORD)).user;
  }
  // Las rules exigen el correo verificado (código de 6 dígitos al registrarse)
  await asegurarVerificada(app, user, { real: REAL, projectId: PROJECT_ID });
  return user;
}

/**
 * Marta (enfermera) de turno las 24 h, para que las pruebas registren a cualquier hora; Sofía
 * (familiar) con permiso de registrar. Así están los permisos desde el 04/11/2026.
 */
const TURNOS_PRUEBA = { marta: [{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }] };
const extraMiembro = (u) =>
  u.rol === 'cuidador_turno'
    ? { turnos: TURNOS_PRUEBA[u.uid] ?? [], franjas: franjasDeTurnos(TURNOS_PRUEBA[u.uid]) }
    : u.rol === 'familiar'
      ? { puedeRegistrar: true }
      : {};

async function main() {
  console.log('1) Usuarios y perfiles');
  for (const u of USUARIOS) {
    const user = await entrarComo(u);
    uids[u.email] = user.uid;
    await setDoc(
      doc(db, 'usuarios', user.uid),
      { uid: user.uid, nombre: u.nombre, email: u.email, tipo: u.tipo, fotoUrl: null, fcmTokens: [], personas: [], creadoEn: serverTimestamp() },
      { merge: true },
    );
  }
  const ana = uids['ana@relevo.test'];
  const marta = uids['marta@relevo.test'];
  const sofia = uids['sofia@relevo.test'];
  const luis = uids['luis@relevo.test'];

  console.log('2) Persona cuidada + miembros (como Ana, cuidadora principal)');
  await signInWithEmailAndPassword(auth, 'ana@relevo.test', PASSWORD);
  const personaRef = doc(db, 'personas_cuidadas', PERSONA_ID);
  let b = writeBatch(db);
  b.set(
    personaRef,
    {
      nombre: 'Carmen Hernández',
      fechaNacimiento: '1948-05-12',
      tipoSangre: 'O+',
      alergias: ['Penicilina'],
      condiciones: ['Hipertensión', 'Diabetes tipo 2'],
      medicoTratante: 'Dr. Luis Pérez',
      contactosEmergencia: [
        { nombre: 'Sofía García', telefono: '+52 33 1234 5678', relacion: 'Hija' },
        { nombre: 'Ana García', telefono: '+52 33 8765 4321', relacion: 'Hija' },
      ],
      miembrosUids: [ana],
      creadoPor: ana,
      creadoEn: serverTimestamp(),
    },
    { merge: true },
  );
  b.set(doc(personaRef, 'miembros', ana), { uid: ana, rol: 'cuidador_principal', nombre: 'Ana García', agregadoEn: serverTimestamp() });
  b.update(doc(db, 'usuarios', ana), { personas: arrayUnion(PERSONA_ID) });
  await b.commit();

  // Ana agrega al resto del equipo
  b = writeBatch(db);
  for (const u of USUARIOS.filter((x) => x.uid !== 'ana')) {
    const uid = uids[u.email];
    b.set(doc(personaRef, 'miembros', uid), { uid, rol: u.rol, nombre: u.nombre, agregadoEn: serverTimestamp(), ...extraMiembro(u) });
  }
  b.update(personaRef, { miembrosUids: arrayUnion(marta, sofia, luis) });
  await b.commit();

  console.log('3) Medicamentos, signos vitales y bitácora (como Ana)');
  b = writeBatch(db);
  b.set(doc(personaRef, 'medicamentos', 'metformina'), { nombre: 'Metformina', dosis: '850 mg', horarios: ['08:00', '20:00'], inventario: 42, activo: true });
  // Según necesidad con indicación del médico: "si hay dolor, máximo 3 al día, cada 8 h". Hace 2 días
  // se dieron 4 (una más del máximo, y algunas con menos de 8 h): la hoja lo marca para el médico.
  // Cada toma la firma quien la dio (las reglas no dejan firmar por otro): las de Marta van con su sesión.
  b.set(doc(personaRef, 'medicamentos', 'paracetamol'), { nombre: 'Paracetamol', dosis: '500 mg', horarios: [], segunNecesidad: true, condicion: 'si hay dolor', maxAlDia: 3, horasEntreTomas: 8, inventario: 20, activo: true });
  const prn = (dias, hora, min, motivo, intensidad, quien, nombre) => {
    const ts = hace(dias, hora, min);
    b.set(doc(personaRef, 'medicamentos/paracetamol/tomas', `${idDe(ts)}00`), { horaProgramada: ts, horaReal: ts, tomado: true, aDemanda: true, registradoPor: quien, registradoNombre: nombre, registradoEn: ts, motivo, ...(intensidad !== null ? { intensidad } : {}) });
  };
  prn(2, 13, 0, 'dolor', 6, ana, 'Ana García');
  prn(2, 17, 30, 'fiebre', null, ana, 'Ana García');
  prn(1, 10, 0, 'dolor', 4, ana, 'Ana García');
  b.set(doc(personaRef, 'medicamentos', 'losartan'), { nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 28, activo: true });
  b.set(doc(personaRef, 'medicamentos/metformina/tomas', idDe(hace(0, 8))), { horaProgramada: hace(0, 8), horaReal: hace(0, 8, 10), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/metformina/tomas', idDe(hace(1, 8))), { horaProgramada: hace(1, 8), horaReal: hace(1, 8, 5), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/metformina/tomas', idDe(hace(1, 20))), { horaProgramada: hace(1, 20), horaReal: null, tomado: false, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/metformina/tomas', idDe(hace(2, 8))), { horaProgramada: hace(2, 8), horaReal: hace(2, 8, 20), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });
  // Losartán (presión): dos tomas omitidas en la semana, para que el asistente tenga qué contar
  b.set(doc(personaRef, 'medicamentos/losartan/tomas', idDe(hace(0, 8))), { horaProgramada: hace(0, 8), horaReal: hace(0, 8, 12), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/losartan/tomas', idDe(hace(1, 8))), { horaProgramada: hace(1, 8), horaReal: null, tomado: false, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/losartan/tomas', idDe(hace(2, 8))), { horaProgramada: hace(2, 8), horaReal: hace(2, 8, 30), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/losartan/tomas', idDe(hace(3, 8))), { horaProgramada: hace(3, 8), horaReal: hace(3, 8, 15), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/losartan/tomas', idDe(hace(4, 8))), { horaProgramada: hace(4, 8), horaReal: null, tomado: false, registradoPor: ana, registradoNombre: 'Ana García' });
  b.set(doc(personaRef, 'medicamentos/losartan/tomas', idDe(hace(5, 8))), { horaProgramada: hace(5, 8), horaReal: hace(5, 8, 5), tomado: true, registradoPor: ana, registradoNombre: 'Ana García' });

  // Rutina: desayuno diario, caminata entre semana y signos por la mañana (con un registro de ayer)
  b.set(doc(personaRef, 'tareas', 'desayuno'), { tipo: 'comida', nombre: 'Desayuno', horarios: ['08:30'], dias: [], duracionMin: 0, avisarMin: 15, signos: [], notas: 'Sin azúcar; avena o fruta', activo: true, creadoEn: hace(10, 9) });
  b.set(doc(personaRef, 'tareas', 'caminata'), { tipo: 'ejercicio', nombre: 'Caminata en el patio', horarios: ['17:00'], dias: [1, 2, 3, 4, 5], duracionMin: 30, avisarMin: 15, signos: [], notas: 'Con andadera', activo: true, creadoEn: hace(10, 9) });
  b.set(doc(personaRef, 'tareas', 'signos-manana'), { tipo: 'signos', nombre: 'Revisar signos vitales', horarios: ['08:00'], dias: [], duracionMin: 0, avisarMin: 10, signos: ['presion', 'glucosa'], notas: '', activo: true, creadoEn: hace(10, 9) });
  b.set(doc(personaRef, 'tareas/desayuno/registros', idDe(hace(1, 8, 30))), { hecha: true, horaProgramada: hace(1, 8, 30), horaReal: hace(1, 8, 40), registradoPor: ana, registradoNombre: 'Ana García', registradoEn: hace(1, 8, 40), nota: 'Comió todo' });
  b.set(doc(personaRef, 'signos_vitales', 'sv1'), { tipo: 'presion', valor: 130, valorSecundario: 85, unidad: 'mmHg', fecha: hace(0, 8, 30), autorUid: ana });
  b.set(doc(personaRef, 'signos_vitales', 'sv2'), { tipo: 'presion', valor: 138, valorSecundario: 90, unidad: 'mmHg', fecha: hace(1, 8, 30), autorUid: ana });
  b.set(doc(personaRef, 'signos_vitales', 'sv3'), { tipo: 'glucosa', valor: 128, valorSecundario: null, unidad: 'mg/dL', fecha: hace(0, 7, 45), autorUid: ana, momento: 'ayunas' });
  b.set(doc(personaRef, 'signos_vitales', 'sv4'), { tipo: 'glucosa', valor: 142, valorSecundario: null, unidad: 'mg/dL', fecha: hace(1, 7, 45), autorUid: ana, momento: 'ayunas' });
  b.set(doc(personaRef, 'consulta', 'preguntas'), { texto: '¿Conviene juntar la Metformina en una sola toma? Se le olvida la de la noche.\n¿Le hace falta fisioterapia para la rodilla?', actualizadoPor: ana, actualizadoNombre: 'Ana García', actualizadoEn: hace(0, 9) });
  // Presión de las semanas anteriores (alrededor de 121/78): la línea base con la que la hoja detecta
  // que 138/90 es inusual para Carmen aunque no pase de 180/110
  [118, 122, 120, 124, 119, 121, 120, 123].forEach((sis, i) => {
    b.set(doc(personaRef, 'signos_vitales', `sv-base-${i}`), { tipo: 'presion', valor: sis, valorSecundario: 76 + (i % 4), unidad: 'mmHg', fecha: hace(12 + i * 3, 8, 30), autorUid: ana });
  });
  b.set(doc(personaRef, 'signos_vitales', 'sv5'), { tipo: 'peso', valor: 68.2, valorSecundario: null, unidad: 'kg', fecha: hace(2, 9), autorUid: ana });
  b.set(doc(personaRef, 'signos_vitales', 'sv6'), { tipo: 'temperatura', valor: 36.6, valorSecundario: null, unidad: '°C', fecha: hace(0, 8, 35), autorUid: ana });

  b.set(doc(personaRef, 'entradas_bitacora', 'e1'), { tipo: 'comida', texto: 'Desayunó avena con fruta, comió todo.', autorUid: ana, autorNombre: 'Ana García', fecha: hace(0, 8, 40) });
  b.set(doc(personaRef, 'entradas_bitacora', 'e2'), { tipo: 'animo', texto: 'De buen humor, estuvo viendo fotos con Sofía.', autorUid: ana, autorNombre: 'Ana García', fecha: hace(0, 11) });
  b.set(doc(personaRef, 'entradas_bitacora', 'e3'), { tipo: 'sueno', texto: 'Durmió unas 7 horas, se levantó una vez al baño.', autorUid: ana, autorNombre: 'Ana García', fecha: hace(1, 7, 30) });
  b.set(doc(personaRef, 'eventos_calendario', 'turno-marta'), { tipo: 'turno', titulo: 'Turno de Marta', inicio: hace(-1, 20), fin: hace(-2, 8), responsableUid: marta, notas: 'Turno de noche' });
  await b.commit();

  console.log('4) Turno de Marta (cuidadora de turno)');
  await signInWithEmailAndPassword(auth, 'marta@relevo.test', PASSWORD);
  b = writeBatch(db);
  // Paracetamol según necesidad que dio Marta
  prn(4, 9, 0, 'dolor', 5, marta, 'Marta López');
  prn(2, 7, 0, 'dolor', 7, marta, 'Marta López');
  prn(2, 22, 0, 'dolor', 6, marta, 'Marta López');
  b.set(doc(personaRef, 'entradas_bitacora', 'e4'), { tipo: 'sintoma', texto: 'Se quejó de dolor en la rodilla derecha al caminar. Se aplicó compresa tibia.', autorUid: marta, autorNombre: 'Marta López', fecha: hace(1, 22, 15) });
  b.set(doc(personaRef, 'entradas_bitacora', 'e5'), { tipo: 'incidente', texto: 'Se resbaló en el baño; sin golpe. Revisar tapete antiderrapante.', autorUid: marta, autorNombre: 'Marta López', fecha: hace(2, 23, 5), caida: true, lesion: false });
  b.set(doc(personaRef, 'medicamentos/metformina/tomas', idDe(hace(2, 20))), { horaProgramada: hace(2, 20), horaReal: hace(2, 20, 5), tomado: true, registradoPor: marta, registradoNombre: 'Marta López' });
  b.update(doc(db, 'usuarios', marta), { personas: arrayUnion(PERSONA_ID) });
  await b.commit();

  console.log('5) Cita agendada por Sofía (familiar)');
  await signInWithEmailAndPassword(auth, 'sofia@relevo.test', PASSWORD);
  b = writeBatch(db);
  b.set(doc(personaRef, 'eventos_calendario', 'cita-cardio'), { tipo: 'cita', titulo: 'Cardiólogo — control de presión', inicio: hace(-6, 10), fin: hace(-6, 11), responsableUid: sofia, lugar: 'Hospital Ángeles, consultorio 12', notas: 'Llevar reporte de presión de la semana', avisarMin: 60 });
  b.set(doc(personaRef, 'eventos_calendario', 'cita-laboratorio'), { tipo: 'cita', titulo: 'Análisis de sangre', inicio: hace(-1, 7, 30), fin: hace(-1, 8), responsableUid: ana, lugar: 'Laboratorio del Centro Médico', notas: 'En ayunas desde las 22:00', avisarMin: 1440 });
  b.update(doc(db, 'usuarios', sofia), { personas: arrayUnion(PERSONA_ID) });
  await b.commit();

  console.log('6) Indicación del médico (Luis)');
  await signInWithEmailAndPassword(auth, 'luis@relevo.test', PASSWORD);
  b = writeBatch(db);
  b.set(doc(personaRef, 'entradas_bitacora', 'e6'), { tipo: 'indicacion', texto: 'Si la presión sigue arriba de 140/90 toda la semana, subir Losartán a 100 mg. Glucosa en ayunas a diario; avisarme si pasa de 180.', autorUid: luis, autorNombre: 'Dr. Luis Pérez', fecha: hace(1, 18) });
  b.update(doc(db, 'usuarios', luis), { personas: arrayUnion(PERSONA_ID) });
  await b.commit();

  console.log('\nListo. Usuarios de prueba (contraseña: ' + PASSWORD + '):');
  for (const u of USUARIOS) console.log(`  ${u.email.padEnd(20)} cuenta: ${u.tipo.padEnd(10)} rol: ${u.rol}`);
  console.log(`\nPersona cuidada: Carmen Hernández (${PERSONA_ID})`);
  console.log(
    REAL
      ? `Consola: https://console.firebase.google.com/project/${app.options.projectId}/firestore`
      : 'UI del emulador: http://localhost:4000',
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    if (!REAL && (e?.code === 'auth/network-request-failed' || /ECONNREFUSED|UNAVAILABLE/.test(String(e)))) {
      console.error('\nNo se pudo conectar con los emuladores. ¿Corriste `npm run emulators` en otra terminal?');
    } else if (e?.code === 'auth/operation-not-allowed') {
      console.error('\nFalta habilitar Correo/Contraseña: Firebase Console > Authentication > Sign-in method.');
    } else if (e?.code === 'permission-denied' || /PERMISSION_DENIED/.test(String(e))) {
      console.error('\nFirestore rechazó la escritura. ¿Ya subiste las reglas? -> npm run deploy:rules');
    } else if (/NOT_FOUND|does not exist/.test(String(e))) {
      console.error('\nFirestore no existe todavía en el proyecto: créalo en Firebase Console > Firestore Database.');
    } else {
      console.error('\nError sembrando datos:', e);
    }
    process.exit(1);
  });
