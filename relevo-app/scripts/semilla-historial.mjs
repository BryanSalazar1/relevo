// Semilla con MUCHO historial (60 días) para demostrar Relevo.
//
//   node scripts/semilla-historial.mjs          -> EMULADORES (npm run emulators en otra terminal)
//   node scripts/semilla-historial.mjs --real   -> proyecto REAL (lee src/environments/firebase.config.ts)
//
// Crea 4 cuentas (responsable, enfermera, familiar, médico), una persona cuidada con ficha médica,
// medicamentos con tomas, rutina con registros, bitácora, signos vitales, citas y turnos.
// Escribe con el SDK cliente pasando por las Security Rules (cada dato lo firma quien lo registró).
// Es idempotente: los ids son deterministas y volver a correrla sobreescribe lo mismo.
// Los documentos llevan `semilla: true` para que las Cloud Functions no manden avisos por cada uno.

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

const REAL = process.argv.includes('--real');
const PASSWORD = 'Relevo.2026';
const PERSONA_ID = 'persona-elena';
const DIAS = 60;

// Alias del correo de la app: cualquier aviso llega a la bandeja de relevo740@gmail.com sin rebotar.
export const USUARIOS = [
  { clave: 'rosa', email: 'relevo740+rosa@gmail.com', nombre: 'Rosa Martínez', tipo: 'familiar', rol: 'cuidador_principal' },
  { clave: 'marta', email: 'relevo740+marta@gmail.com', nombre: 'Marta Ruiz', tipo: 'enfermero', rol: 'cuidador_turno' },
  { clave: 'carlos', email: 'relevo740+carlos@gmail.com', nombre: 'Carlos Martínez', tipo: 'familiar', rol: 'familiar' },
  { clave: 'doctor', email: 'relevo740+doctor@gmail.com', nombre: 'Dr. Javier Soto', tipo: 'medico', rol: 'medico' },
];

function leerConfigReal() {
  const src = readFileSync(new URL('../src/environments/firebase.config.ts', import.meta.url), 'utf8');
  const bloque = src.match(/firebaseConfig\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';
  const cfg = {};
  for (const m of bloque.matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) cfg[m[1]] = m[2];
  return cfg;
}

const app = initializeApp(REAL ? leerConfigReal() : { projectId: 'demo-relevo', apiKey: 'demo-api-key' });
const auth = getAuth(app);
const db = getFirestore(app);
if (!REAL) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
console.log(`>>> Sembrando historial en ${REAL ? `el proyecto REAL ${app.options.projectId}` : 'los emuladores'}\n`);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
let semillaAleatoria = 20260915;
/** Aleatorio determinista (misma semilla → mismos datos en cada corrida). */
const azar = () => {
  semillaAleatoria = (semillaAleatoria * 1103515245 + 12345) % 2147483648;
  return semillaAleatoria / 2147483648;
};
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const pad = (n) => String(n).padStart(2, '0');
const hoy = new Date();
hoy.setHours(0, 0, 0, 0);
/** Fecha local: hace `dias` días a las hh:mm. */
const fecha = (dias, hhmm, minExtra = 0) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(hoy);
  d.setDate(d.getDate() - dias);
  d.setHours(h, m + minExtra, 0, 0);
  return d;
};
const ts = (d) => Timestamp.fromDate(d);
const idProgramado = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const claveDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ahora = new Date();

/** Quién está de guardia a esa hora: Marta L-V 08-16, Carlos el resto (Rosa de madrugada). */
function guardia(d) {
  const dia = d.getDay();
  const h = d.getHours();
  if (dia >= 1 && dia <= 5 && h >= 8 && h < 16) return 'marta';
  if (h >= 8 && h < 22) return 'carlos';
  return 'rosa';
}

const uids = {};
const nombre = (clave) => USUARIOS.find((u) => u.clave === clave).nombre;

async function entrarComo(clave) {
  const u = USUARIOS.find((x) => x.clave === clave);
  try {
    const cred = await signInWithEmailAndPassword(auth, u.email, PASSWORD);
    return cred.user;
  } catch {
    const cred = await createUserWithEmailAndPassword(auth, u.email, PASSWORD);
    await updateProfile(cred.user, { displayName: u.nombre });
    console.log(`  + creada ${u.email}`);
    return cred.user;
  }
}

/** Escribe `docs` ([ref, datos]) en lotes de 400 con la sesión actual. */
async function escribir(docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const b = writeBatch(db);
    for (const [ref, datos] of docs.slice(i, i + 400)) b.set(ref, datos, { merge: true });
    await b.commit();
  }
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
const MEDICAMENTOS = [
  { id: 'metformina', nombre: 'Metformina', dosis: '850 mg', horarios: ['08:00', '20:00'], inventario: 38, inicioHace: DIAS, notas: 'Con alimentos' },
  { id: 'losartan', nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 22, inicioHace: DIAS, notas: '' },
  { id: 'atorvastatina', nombre: 'Atorvastatina', dosis: '20 mg', horarios: ['21:00'], inventario: 15, inicioHace: DIAS, notas: 'Por la noche' },
  { id: 'amoxicilina', nombre: 'Amoxicilina', dosis: '500 mg', horarios: ['08:00', '16:00', '00:00'], inventario: 0, inicioHace: 30, duracionDias: 7, notas: 'Infección urinaria, tratamiento de 7 días' },
  { id: 'paracetamol', nombre: 'Paracetamol', dosis: '500 mg', horarios: [], segunNecesidad: true, inventario: 26, inicioHace: DIAS, notas: 'Si siente dolor; máximo 3 al día' },
];

const TAREAS = [
  { id: 'desayuno', tipo: 'comida', nombre: 'Desayuno', horarios: ['08:30'], dias: [0, 1, 2, 3, 4, 5, 6], avisarMin: 15, notas: 'Avena o fruta; medir glucosa antes' },
  { id: 'comida', tipo: 'comida', nombre: 'Comida', horarios: ['14:00'], dias: [0, 1, 2, 3, 4, 5, 6], avisarMin: 15, notas: 'Poca sal' },
  { id: 'cena', tipo: 'comida', nombre: 'Cena', horarios: ['19:30'], dias: [0, 1, 2, 3, 4, 5, 6], avisarMin: 15, notas: '' },
  { id: 'bano', tipo: 'bano', nombre: 'Baño', horarios: ['10:00'], dias: [1, 3, 5, 0], avisarMin: 30, duracionMin: 45, notas: 'Con silla de baño' },
  { id: 'caminata', tipo: 'ejercicio', nombre: 'Caminata en el patio', horarios: ['17:00'], dias: [1, 2, 3, 4, 5, 6], avisarMin: 15, duracionMin: 30, notas: 'Con andadera' },
  { id: 'fisio', tipo: 'terapia', nombre: 'Fisioterapia de rodilla', horarios: ['11:00'], dias: [2, 4], avisarMin: 60, duracionMin: 60, notas: 'Viene la fisioterapeuta a casa' },
];

const ENTRADAS = {
  nota: [
    'Pasó la mañana tranquila, tejió un rato y escuchó la radio.',
    'Vino la vecina a visitarla; platicaron una hora.',
    'Pidió hablar por teléfono con su hermana; se le vio contenta después.',
    'Se le cortaron las uñas y se le puso crema en las piernas.',
    'Preguntó dos veces qué día era; se le recordó con calma.',
    'Hoy quiso ver fotos viejas; reconoció a todos.',
    'Se cambió la sábana y se ventiló el cuarto.',
    'Tomó agua bien durante el día (unos 6 vasos).',
  ],
  animo: [
    'Muy contenta, vino su nieta a comer.',
    'Se le notó triste por la tarde; dijo que extraña a su esposo.',
    'De buen humor, hizo bromas con la enfermera.',
    'Irritable en la mañana, mejor después del desayuno.',
    'Tranquila y platicadora todo el día.',
  ],
  sueno: [
    'Durmió unas 7 horas; se levantó una vez al baño.',
    'Noche inquieta: se despertó a las 3 y tardó en volver a dormir.',
    'Se acostó a las 21:30 y durmió de corrido.',
    'Siesta de una hora después de comer.',
    'Se levantó tres veces al baño; amaneció cansada.',
  ],
  sintoma: [
    'Dolor de rodilla derecha al levantarse; mejoró con calor local.',
    'Un poco mareada al ponerse de pie; se le pidió levantarse despacio.',
    'Tos seca por la noche.',
    'Se quejó de dolor de cabeza leve por la tarde.',
    'Hinchazón ligera en los tobillos al final del día.',
    'Dijo que veía borroso un rato después de comer.',
  ],
  incidente: [
    'Se resbaló en el baño; no hubo golpe fuerte, solo susto. Se revisó y no tiene moretones.',
    'Se le olvidó que ya había comido y quería volver a desayunar.',
    'Salió al patio sin andadera; se le acompañó de regreso.',
    'Se le cayó el vaso y se cortó levemente un dedo; se limpió y curó.',
  ],
};
const PESO_ENTRADAS = ['nota', 'nota', 'nota', 'animo', 'animo', 'sueno', 'sueno', 'sintoma', 'sintoma', 'incidente'];
const NOTAS_OMITIDA = ['vomitó después de desayunar', 'se le olvidó, se dio al día siguiente', 'no quiso tomarla, dijo que le cae pesada', 'se durmió temprano'];
const NOTAS_NO_HECHA = ['no tenía hambre', 'se sentía cansada', 'no quiso bañarse, dijo que mañana', 'llovió y no salió', 'la fisioterapeuta canceló'];
const NOTAS_PRN = ['dolor de rodilla', 'dolor de cabeza', 'dolor de espalda por la tarde', 'molestia en la rodilla después de caminar'];

async function main() {
  console.log('1) Cuentas y perfiles');
  for (const u of USUARIOS) {
    const user = await entrarComo(u.clave);
    uids[u.clave] = user.uid;
    await setDoc(
      doc(db, 'usuarios', user.uid),
      { uid: user.uid, nombre: u.nombre, email: u.email, tipo: u.tipo, fotoUrl: null, fcmTokens: [], personas: [], creadoEn: serverTimestamp() },
      { merge: true },
    );
  }

  console.log('2) Persona cuidada, ficha médica y equipo (como Rosa, responsable)');
  await entrarComo('rosa');
  const personaRef = doc(db, 'personas_cuidadas', PERSONA_ID);
  let b = writeBatch(db);
  b.set(
    personaRef,
    {
      nombre: 'Elena Ramírez',
      fechaNacimiento: '1946-03-08',
      descripcion: 'Mi mamá. Vive con Rosa. Muy sociable: le gusta la radio, tejer y que la visiten. Por las noches se desorienta un poco.',
      tipoSangre: 'O+',
      condiciones: ['Diabetes tipo 2', 'Hipertensión arterial', 'Artrosis de rodilla', 'Insuficiencia cardiaca leve'],
      alergias: ['Penicilina', 'Mariscos'],
      medicoTratante: 'Dra. Ana López, geriatra',
      telefonoMedico: '33 1234 5678',
      seguro: 'IMSS · NSS 12-34-56-7890-1',
      hospital: 'Hospital Civil de Guadalajara (urgencias)',
      notasMedicas: 'Usa andadera. Dieta baja en sal y azúcar. No tomar ibuprofeno. Prótesis de cadera derecha (2021). Se marea al levantarse rápido.',
      contactosEmergencia: [
        { nombre: 'Rosa Martínez', telefono: '33 2222 3333', relacion: 'Hija' },
        { nombre: 'Carlos Martínez', telefono: '33 4444 5555', relacion: 'Hijo' },
      ],
      miembrosUids: [uids.rosa],
      creadoPor: uids.rosa,
      creadoEn: serverTimestamp(),
    },
    { merge: true },
  );
  b.set(doc(personaRef, 'miembros', uids.rosa), { uid: uids.rosa, rol: 'cuidador_principal', nombre: nombre('rosa'), agregadoEn: serverTimestamp(), alertas: true }, { merge: true });
  b.update(doc(db, 'usuarios', uids.rosa), { personas: arrayUnion(PERSONA_ID) });
  await b.commit();

  b = writeBatch(db);
  b.set(doc(personaRef, 'miembros', uids.marta), { uid: uids.marta, rol: 'cuidador_turno', nombre: nombre('marta'), agregadoEn: serverTimestamp(), turnos: [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' }], alertas: true }, { merge: true });
  b.set(doc(personaRef, 'miembros', uids.carlos), { uid: uids.carlos, rol: 'familiar', nombre: nombre('carlos'), agregadoEn: serverTimestamp(), turnos: [{ dias: [1, 2, 3, 4, 5], desde: '16:00', hasta: '22:00' }, { dias: [6, 0], desde: '08:00', hasta: '22:00' }], alertas: true }, { merge: true });
  b.set(doc(personaRef, 'miembros', uids.doctor), { uid: uids.doctor, rol: 'medico', nombre: nombre('doctor'), agregadoEn: serverTimestamp() }, { merge: true });
  b.update(personaRef, { miembrosUids: arrayUnion(uids.marta, uids.carlos, uids.doctor) });
  await b.commit();
  for (const clave of ['marta', 'carlos', 'doctor']) {
    await entrarComo(clave);
    await updateDoc(doc(db, 'usuarios', uids[clave]), { personas: arrayUnion(PERSONA_ID) });
  }

  console.log('3) Medicamentos, tareas y citas (como Rosa)');
  await entrarComo('rosa');
  const docsRosa = [];
  for (const m of MEDICAMENTOS) {
    docsRosa.push([
      doc(personaRef, 'medicamentos', m.id),
      {
        nombre: m.nombre,
        dosis: m.dosis,
        horarios: m.horarios,
        segunNecesidad: m.segunNecesidad === true,
        inicio: claveDia(fecha(m.inicioHace, '00:00')),
        duracionDias: m.duracionDias ?? null,
        inventario: m.inventario,
        notas: m.notas,
        activo: true,
        creadoEn: ts(fecha(m.inicioHace, '09:00')),
      },
    ]);
  }
  for (const t of TAREAS) {
    docsRosa.push([
      doc(personaRef, 'tareas', t.id),
      { tipo: t.tipo, nombre: t.nombre, horarios: t.horarios, dias: t.dias, avisarMin: t.avisarMin, duracionMin: t.duracionMin ?? 0, notas: t.notas, activo: true, creadoEn: ts(fecha(DIAS, '09:00')) },
    ]);
  }
  const eventos = [
    { id: 'geriatra-pasado', tipo: 'cita', titulo: 'Control con la geriatra', dias: 12, desde: '10:00', hasta: '11:00', notas: 'Ajustó la dosis de Losartán' },
    { id: 'fisio-pasada', tipo: 'terapia', titulo: 'Valoración de fisioterapia', dias: 25, desde: '11:00', hasta: '12:00', notas: '' },
    { id: 'cardiologo', tipo: 'cita', titulo: 'Cardiólogo (revisión anual)', dias: -4, desde: '09:30', hasta: '10:30', notas: 'Llevar electrocardiograma anterior' },
    { id: 'laboratorio', tipo: 'cita', titulo: 'Análisis de sangre (en ayunas)', dias: -9, desde: '07:00', hasta: '07:30', notas: 'No desayunar' },
    { id: 'oftalmologo', tipo: 'cita', titulo: 'Oftalmólogo', dias: -20, desde: '12:00', hasta: '13:00', notas: 'Revisión por visión borrosa' },
  ];
  for (const ev of eventos) {
    docsRosa.push([
      doc(personaRef, 'eventos_calendario', ev.id),
      { tipo: ev.tipo, titulo: ev.titulo, inicio: ts(fecha(ev.dias, ev.desde)), fin: ts(fecha(ev.dias, ev.hasta)), responsableUid: uids.rosa, notas: ev.notas },
    ]);
  }
  await escribir(docsRosa);

  console.log(`4) ${DIAS} días de historial (cada dato firmado por quien estaba de guardia)`);
  const porAutor = { rosa: [], marta: [], carlos: [] };
  const firma = (clave, cuando) => ({ registradoPor: uids[clave], registradoNombre: nombre(clave), registradoEn: ts(cuando) });

  for (let d = DIAS; d >= 0; d--) {
    const diaFecha = fecha(d, '00:00');
    const diaSemana = diaFecha.getDay();
    const cd = claveDia(diaFecha);

    // Tomas programadas
    for (const m of MEDICAMENTOS) {
      if (m.segunNecesidad) continue;
      const inicio = claveDia(fecha(m.inicioHace, '00:00'));
      if (cd < inicio) continue;
      if (m.duracionDias && cd >= claveDia(fecha(m.inicioHace - m.duracionDias, '00:00'))) continue;
      for (const h of m.horarios) {
        const programada = fecha(d, h);
        if (programada > ahora) continue;
        const omitida = azar() < 0.08;
        const real = new Date(programada.getTime() + entre(0, 45) * 60000);
        const quien = guardia(programada);
        porAutor[quien].push([
          doc(personaRef, `medicamentos/${m.id}/tomas`, idProgramado(programada)),
          { horaProgramada: ts(programada), horaReal: omitida ? null : ts(real), tomado: !omitida, ...firma(quien, omitida ? programada : real), ...(omitida ? { nota: elegir(NOTAS_OMITIDA) } : {}), semilla: true },
        ]);
      }
    }
    // Registros de tareas
    for (const t of TAREAS) {
      if (!t.dias.includes(diaSemana)) continue;
      for (const h of t.horarios) {
        const programada = fecha(d, h);
        if (programada > ahora) continue;
        const noHecha = azar() < 0.1;
        const real = new Date(programada.getTime() + entre(0, 30) * 60000);
        const quien = guardia(programada);
        porAutor[quien].push([
          doc(personaRef, `tareas/${t.id}/registros`, idProgramado(programada)),
          { horaProgramada: ts(programada), horaReal: noHecha ? null : ts(real), hecha: !noHecha, ...firma(quien, noHecha ? programada : real), ...(noHecha ? { nota: elegir(NOTAS_NO_HECHA) } : azar() < 0.25 ? { nota: elegir(['comió todo', 'comió poco', 'muy contenta', 'le costó trabajo levantarse']) } : {}), semilla: true },
        ]);
      }
    }
    // Bitácora: 1 a 3 entradas por día
    const cuantas = entre(1, 3);
    for (let n = 0; n < cuantas; n++) {
      const tipo = elegir(PESO_ENTRADAS);
      const cuando = fecha(d, `${pad(entre(7, 21))}:${pad(entre(0, 59))}`);
      if (cuando > ahora) continue;
      const quien = guardia(cuando);
      porAutor[quien].push([
        doc(personaRef, 'entradas_bitacora', `sem-${cd}-${n}`),
        { tipo, texto: elegir(ENTRADAS[tipo]), autorUid: uids[quien], autorNombre: nombre(quien), fecha: ts(cuando), creadoEn: ts(new Date(cuando.getTime() + entre(1, 15) * 60000)), semilla: true },
      ]);
    }
    // Signos vitales (solo responsable y enfermera pueden registrarlos)
    const glucosaHora = fecha(d, '07:45');
    if (glucosaHora <= ahora) {
      const quien = guardia(glucosaHora) === 'marta' ? 'marta' : 'rosa';
      const alta = azar() < 0.12;
      porAutor[quien].push([doc(personaRef, 'signos_vitales', `glu-${cd}`), { tipo: 'glucosa', valor: alta ? entre(185, 240) : entre(95, 165), valorSecundario: null, unidad: 'mg/dL', fecha: ts(glucosaHora), autorUid: uids[quien], semilla: true }]);
    }
    const presionHora = fecha(d, '08:10');
    if (presionHora <= ahora) {
      const quien = guardia(presionHora) === 'marta' ? 'marta' : 'rosa';
      porAutor[quien].push([doc(personaRef, 'signos_vitales', `pa-${cd}`), { tipo: 'presion', valor: entre(118, 152), valorSecundario: entre(72, 94), unidad: 'mmHg', fecha: ts(presionHora), autorUid: uids[quien], semilla: true }]);
    }
    if (d % 7 === 0 && fecha(d, '09:00') <= ahora) {
      porAutor.rosa.push([doc(personaRef, 'signos_vitales', `peso-${cd}`), { tipo: 'peso', valor: Math.round((68.4 - (DIAS - d) * 0.03) * 10) / 10, valorSecundario: null, unidad: 'kg', fecha: ts(fecha(d, '09:00')), autorUid: uids.rosa, semilla: true }]);
    }
    if (azar() < 0.12 && fecha(d, '18:00') <= ahora) {
      porAutor.rosa.push([doc(personaRef, 'signos_vitales', `temp-${cd}`), { tipo: 'temperatura', valor: Math.round((36.2 + azar() * 1.4) * 10) / 10, valorSecundario: null, unidad: '°C', fecha: ts(fecha(d, '18:00')), autorUid: uids.rosa, semilla: true }]);
    }
  }
  // Paracetamol según necesidad: unas 10 tomas sueltas con nota
  for (let n = 0; n < 10; n++) {
    const cuando = fecha(entre(1, DIAS - 1), `${pad(entre(9, 21))}:${pad(entre(0, 59))}`);
    const quien = guardia(cuando);
    const id = `${idProgramado(cuando)}${pad(entre(0, 59))}`;
    porAutor[quien].push([
      doc(personaRef, 'medicamentos/paracetamol/tomas', id),
      { horaProgramada: ts(cuando), horaReal: ts(cuando), tomado: true, aDemanda: true, nota: elegir(NOTAS_PRN), ...firma(quien, cuando), semilla: true },
    ]);
  }

  let total = 0;
  for (const clave of ['rosa', 'marta', 'carlos']) {
    await entrarComo(clave);
    await escribir(porAutor[clave]);
    total += porAutor[clave].length;
    console.log(`  · ${nombre(clave)}: ${porAutor[clave].length} registros`);
  }

  console.log(`\nListo: ${total} registros de historial en ${DIAS} días para Elena Ramírez (${PERSONA_ID}).`);
  console.log('Accesos (contraseña para todos: ' + PASSWORD + '):');
  for (const u of USUARIOS) console.log(`  - ${u.nombre.padEnd(18)} ${u.email.padEnd(32)} ${u.rol}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFalló la semilla:', e?.message ?? e);
    process.exit(1);
  });
