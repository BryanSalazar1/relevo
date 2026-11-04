// Semilla de demostración con 60 días de historial: una persona cuidada (Elena, 80 años), su familiar
// responsable, dos enfermeras con turnos y su médico. La presión es normal durante semanas y sube en
// los últimos 10 días (cuando se omitió varias veces el Losartán): la hoja para la consulta lo marca.
//
//   RELEVO_DEMO_PASSWORD=... node scripts/semilla-demo.mjs          -> EMULADORES (npm run emulators)
//   RELEVO_DEMO_PASSWORD=... node scripts/semilla-demo.mjs --real   -> proyecto REAL (firebase.config.ts)
// La contraseña de las cuentas va solo en la variable de entorno: nunca en el repositorio.
//
// Escribe con el SDK cliente pasando por las Security Rules: cada dato lo firma quien estaba de guardia.
// Los registros llevan `semilla: true` para que las Cloud Functions no manden un aviso por cada uno.
// Es idempotente: ids deterministas y datos con azar de semilla fija.

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
  writeBatch,
} from 'firebase/firestore';

const REAL = process.argv.includes('--real');
const PASSWORD = process.env.RELEVO_DEMO_PASSWORD;
if (!PASSWORD || PASSWORD.length < 8) {
  console.error('Falta RELEVO_DEMO_PASSWORD (al menos 8 caracteres): la contraseña de las cuentas de demostración.');
  process.exit(1);
}
const PERSONA_ID = 'persona-elena';
const DIAS = 60;
/** Desde hace cuántos días la presión está alta */
const SUBIDA = 9;

// Alias del correo de la app: cualquier aviso llega a relevo740@gmail.com sin rebotar
const USUARIOS = [
  { clave: 'rosa', email: 'relevo740+rosa@gmail.com', nombre: 'Rosa Martínez', tipo: 'familiar', rol: 'cuidador_principal' },
  { clave: 'marta', email: 'relevo740+marta@gmail.com', nombre: 'Marta Ruiz', tipo: 'enfermero', rol: 'cuidador_turno' },
  { clave: 'laura', email: 'relevo740+laura@gmail.com', nombre: 'Laura Gómez', tipo: 'enfermero', rol: 'cuidador_turno' },
  { clave: 'doctor', email: 'relevo740+doctor@gmail.com', nombre: 'Dr. Javier Soto', tipo: 'medico', rol: 'medico' },
];
const TURNOS = {
  marta: [{ dias: [1, 2, 3, 4, 5], desde: '07:00', hasta: '15:00' }],
  laura: [
    { dias: [1, 2, 3, 4, 5], desde: '15:00', hasta: '23:00' },
    { dias: [0, 6], desde: '09:00', hasta: '21:00' },
  ],
};

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
  connectFirestoreEmulator(db, '127.0.0.1', Number(process.env.FIRESTORE_PORT ?? 8080));
}
console.log(`>>> Sembrando en ${REAL ? `el proyecto REAL ${app.options.projectId}` : 'los emuladores'}\n`);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
let semillaAzar = 20261102;
/** Aleatorio determinista: mismos datos en cada corrida */
const azar = () => {
  semillaAzar = (semillaAzar * 1103515245 + 12345) % 2147483648;
  return semillaAzar / 2147483648;
};
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const pad = (n) => String(n).padStart(2, '0');
const hoy = new Date();
hoy.setHours(0, 0, 0, 0);
const ahora = new Date();
/** Hace `dias` días a las hh:mm (hora local) */
const fecha = (dias, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(hoy);
  d.setDate(d.getDate() - dias);
  d.setHours(h, m, 0, 0);
  return d;
};
const ts = (d) => Timestamp.fromDate(d);
/** Id como lo arma la app: yyyyMMdd-HHmm de la hora programada */
const idDe = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const claveDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Quién está de guardia: Marta L-V 07-15, Laura L-V 15-23 y fines de semana 09-21, si no, Rosa */
function guardia(d) {
  const dia = d.getDay();
  const min = d.getHours() * 60 + d.getMinutes();
  const enHoras = (desde, hasta) => min >= desde * 60 && min < hasta * 60;
  if (dia >= 1 && dia <= 5 && enHoras(7, 15)) return 'marta';
  if (dia >= 1 && dia <= 5 && enHoras(15, 23)) return 'laura';
  if ((dia === 0 || dia === 6) && enHoras(9, 21)) return 'laura';
  return 'rosa';
}

const uids = {};
const nombre = (clave) => USUARIOS.find((u) => u.clave === clave).nombre;

async function entrarComo(clave) {
  const u = USUARIOS.find((x) => x.clave === clave);
  try {
    return (await signInWithEmailAndPassword(auth, u.email, PASSWORD)).user;
  } catch {
    const cred = await createUserWithEmailAndPassword(auth, u.email, PASSWORD);
    await updateProfile(cred.user, { displayName: u.nombre });
    console.log(`  + cuenta creada: ${u.email}`);
    return cred.user;
  }
}

/** Escribe [ref, datos] en lotes con la sesión actual (LOTE: las reglas limitan lecturas por lote) */
const LOTE = Number(process.env.LOTE ?? 400);
async function escribir(docs) {
  for (let i = 0; i < docs.length; i += LOTE) {
    const b = writeBatch(db);
    for (const [ref, datos] of docs.slice(i, i + LOTE)) b.set(ref, datos);
    await b.commit();
  }
}

// ---------------------------------------------------------------------------
// Plan de cuidado
// ---------------------------------------------------------------------------
const MEDICAMENTOS = [
  { id: 'metformina', nombre: 'Metformina', dosis: '850 mg', horarios: ['08:00', '20:00'], inventario: 40, notas: 'Con alimentos' },
  { id: 'losartan', nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 16, notas: 'Para la presión; no suspender' },
  { id: 'atorvastatina', nombre: 'Atorvastatina', dosis: '20 mg', horarios: ['21:00'], inventario: 25, notas: 'Por la noche' },
  {
    id: 'paracetamol', nombre: 'Paracetamol', dosis: '500 mg', horarios: [], inventario: 22, notas: 'Para la rodilla',
    segunNecesidad: true, condicion: 'si hay dolor', maxAlDia: 3, horasEntreTomas: 8,
  },
];
const TAREAS = [
  { id: 'signos', tipo: 'signos', nombre: 'Presión y glucosa en ayunas', horarios: ['07:45'], dias: [], avisarMin: 10, signos: ['presion', 'glucosa'], notas: 'Sentada, 5 minutos de reposo antes' },
  { id: 'desayuno', tipo: 'comida', nombre: 'Desayuno', horarios: ['08:30'], dias: [], avisarMin: 15, notas: 'Avena o fruta, sin azúcar' },
  { id: 'comida', tipo: 'comida', nombre: 'Comida', horarios: ['14:00'], dias: [], avisarMin: 15, notas: 'Poca sal' },
  { id: 'caminata', tipo: 'ejercicio', nombre: 'Caminata en el patio', horarios: ['17:00'], dias: [1, 2, 3, 4, 5, 6], avisarMin: 15, duracionMin: 30, notas: 'Con andadera' },
  { id: 'cena', tipo: 'comida', nombre: 'Cena', horarios: ['19:30'], dias: [], avisarMin: 15, notas: 'Ligera' },
];
const BITACORA = {
  nota: [
    'Pasó la mañana tranquila, tejió un rato y escuchó la radio.',
    'Vino la vecina a visitarla; platicaron una hora.',
    'Se le cortaron las uñas y se le puso crema en las piernas.',
    'Tomó agua bien durante el día (unos 6 vasos).',
    'Vio fotos viejas con su nieta; reconoció a todos.',
  ],
  animo: [
    'Muy contenta, vino su nieta a comer.',
    'Tranquila y platicadora todo el día.',
    'Un poco triste por la tarde; dijo que extraña a su esposo.',
    'De buen humor, hizo bromas con la enfermera.',
  ],
  sueno: [
    'Durmió unas 7 horas; se levantó una vez al baño.',
    'Se acostó a las 21:30 y durmió de corrido.',
    'Noche inquieta: despertó a las 3 y tardó en volver a dormir.',
  ],
  comida: ['Desayunó avena con fruta, comió todo.', 'Comió poco a mediodía, dijo que no tenía hambre.', 'Cenó bien: sopa y pan tostado.'],
};
const TIPOS_DIA = ['nota', 'nota', 'animo', 'sueno', 'comida'];

async function main() {
  console.log('1) Cuentas y perfiles');
  for (const u of USUARIOS) {
    const user = await entrarComo(u.clave);
    uids[u.clave] = user.uid;
    await setDoc(doc(db, 'usuarios', user.uid), {
      uid: user.uid, nombre: u.nombre, email: u.email, tipo: u.tipo, fotoUrl: null, fcmTokens: [], personas: [], creadoEn: serverTimestamp(),
    }, { merge: true });
  }

  console.log('2) Persona cuidada y equipo (como Rosa, responsable)');
  await entrarComo('rosa');
  const persona = doc(db, 'personas_cuidadas', PERSONA_ID);
  let b = writeBatch(db);
  b.set(persona, {
    nombre: 'Elena Ramírez',
    fechaNacimiento: '1946-03-08',
    tipoSangre: 'O+',
    condiciones: ['Hipertensión arterial', 'Diabetes tipo 2', 'Artrosis de rodilla'],
    alergias: ['Penicilina'],
    medicoTratante: 'Dr. Javier Soto',
    contactosEmergencia: [{ nombre: 'Rosa Martínez', telefono: '+52 33 2222 3333', relacion: 'Hija' }],
    miembrosUids: [uids.rosa],
    creadoPor: uids.rosa,
    creadoEn: ts(fecha(DIAS, '09:00')),
  });
  b.set(doc(persona, 'miembros', uids.rosa), { uid: uids.rosa, rol: 'cuidador_principal', nombre: nombre('rosa'), agregadoEn: serverTimestamp() });
  b.set(doc(db, 'usuarios', uids.rosa), { personas: arrayUnion(PERSONA_ID) }, { merge: true });
  await b.commit();
  b = writeBatch(db);
  for (const clave of ['marta', 'laura', 'doctor']) {
    const u = USUARIOS.find((x) => x.clave === clave);
    b.set(doc(persona, 'miembros', uids[clave]), {
      uid: uids[clave], rol: u.rol, nombre: u.nombre, agregadoEn: serverTimestamp(), ...(TURNOS[clave] ? { turnos: TURNOS[clave] } : {}),
    });
  }
  b.update(persona, { miembrosUids: arrayUnion(uids.marta, uids.laura, uids.doctor) });
  await b.commit();
  for (const clave of ['marta', 'laura', 'doctor']) {
    await entrarComo(clave);
    await setDoc(doc(db, 'usuarios', uids[clave]), { personas: arrayUnion(PERSONA_ID) }, { merge: true });
  }

  console.log('3) Medicamentos, rutina, citas y preguntas (como Rosa)');
  await entrarComo('rosa');
  const deRosa = [];
  const inicio = claveDia(fecha(DIAS, '00:00'));
  for (const m of MEDICAMENTOS) {
    const { id, ...datos } = m;
    deRosa.push([doc(persona, 'medicamentos', id), { ...datos, segunNecesidad: m.segunNecesidad === true, inicio, activo: true, creadoEn: ts(fecha(DIAS, '09:00')) }]);
  }
  for (const t of TAREAS) {
    const { id, ...datos } = t;
    deRosa.push([doc(persona, 'tareas', id), { duracionMin: 0, signos: [], ...datos, activo: true, creadoEn: ts(fecha(DIAS, '09:00')) }]);
  }
  const citas = [
    { id: 'geriatra', tipo: 'cita', titulo: 'Control con el Dr. Soto', dias: 35, desde: '10:00', hasta: '11:00', lugar: 'Consultorio 204', notas: 'Todo estable; seguir igual' },
    { id: 'control-presion', tipo: 'cita', titulo: 'Dr. Soto: revisión de la presión', dias: -3, desde: '10:00', hasta: '11:00', lugar: 'Consultorio 204', notas: 'Llevar la hoja para la consulta', avisarMin: 1440 },
    { id: 'laboratorio', tipo: 'cita', titulo: 'Análisis de sangre (en ayunas)', dias: -10, desde: '07:30', hasta: '08:00', lugar: 'Laboratorio del Centro Médico', notas: 'Sin desayunar', avisarMin: 1440 },
  ];
  for (const c of citas) {
    deRosa.push([doc(persona, 'eventos_calendario', c.id), {
      tipo: c.tipo, titulo: c.titulo, inicio: ts(fecha(c.dias, c.desde)), fin: ts(fecha(c.dias, c.hasta)), responsableUid: uids.rosa,
      lugar: c.lugar, notas: c.notas, ...(c.avisarMin ? { avisarMin: c.avisarMin } : {}),
    }]);
  }
  deRosa.push([doc(persona, 'consulta', 'preguntas'), {
    texto: '¿Por qué subió la presión si sigue con el mismo Losartán?\n¿Conviene tomarlo en la noche para que no se le olvide?\n¿El mareo al levantarse tiene que ver con la presión?',
    actualizadoPor: uids.rosa, actualizadoNombre: nombre('rosa'), actualizadoEn: ts(fecha(1, '20:00')),
  }]);
  await escribir(deRosa);

  console.log(`4) ${DIAS} días de historial, cada dato firmado por quien estaba de guardia`);
  const porAutor = { rosa: [], marta: [], laura: [] };
  const firma = (quien, cuando) => ({ registradoPor: uids[quien], registradoNombre: nombre(quien), registradoEn: ts(cuando) });
  const autor = (quien) => ({ autorUid: uids[quien], autorNombre: nombre(quien) });
  // Mañanas en que se omitió el Losartán, ya con la presión alta (el resto del tiempo, casi siempre se dio)
  const LOSARTAN_OMITIDO = {
    8: 'Se acabó la caja; se compró en la tarde',
    7: 'Se acabó la caja; se compró en la tarde',
    5: 'No quiso tomarla, dijo que le daba mareo',
    2: 'Se le olvidó; se notó hasta la noche',
  };

  for (let d = DIAS; d >= 0; d--) {
    const dia = fecha(d, '00:00');
    const alta = d <= SUBIDA;

    for (const m of MEDICAMENTOS) {
      if (m.segunNecesidad) continue;
      for (const h of m.horarios) {
        const prog = fecha(d, h);
        if (prog > ahora) continue;
        const omitida = m.id === 'losartan' ? d in LOSARTAN_OMITIDO : azar() < 0.04;
        const real = new Date(prog.getTime() + entre(0, 35) * 60000);
        const quien = guardia(prog);
        porAutor[quien].push([doc(persona, `medicamentos/${m.id}/tomas`, idDe(prog)), {
          horaProgramada: ts(prog), horaReal: omitida ? null : ts(real), tomado: !omitida, ...firma(quien, omitida ? prog : real),
          ...(omitida ? { nota: m.id === 'losartan' ? LOSARTAN_OMITIDO[d] : 'Se durmió temprano' } : {}), semilla: true,
        }]);
      }
    }

    for (const t of TAREAS) {
      if (t.dias.length && !t.dias.includes(dia.getDay())) continue;
      for (const h of t.horarios) {
        const prog = fecha(d, h);
        if (prog > ahora) continue;
        const noHecha = t.tipo !== 'signos' && azar() < 0.07;
        const real = new Date(prog.getTime() + entre(0, 25) * 60000);
        const quien = guardia(prog);
        porAutor[quien].push([doc(persona, `tareas/${t.id}/registros`, idDe(prog)), {
          hecha: !noHecha, horaProgramada: ts(prog), horaReal: noHecha ? null : ts(real), ...firma(quien, noHecha ? prog : real),
          ...(noHecha ? { nota: elegir(['No tenía hambre', 'Se sentía cansada', 'Llovió y no salió']) } : {}), semilla: true,
        }]);
      }
    }

    // Signos de la mañana: presión normal (~121/77) y, desde hace 9 días, alta (~150/91)
    const manana = fecha(d, '07:50');
    if (manana <= ahora) {
      const quien = guardia(manana);
      const [sis, dia2] = alta ? [entre(144, 157), entre(87, 95)] : [entre(115, 127), entre(72, 81)];
      porAutor[quien].push([doc(persona, 'signos_vitales', `pa-${claveDia(dia)}`), {
        tipo: 'presion', valor: sis, valorSecundario: dia2, unidad: 'mmHg', fecha: ts(manana), ...autor(quien), semilla: true,
      }]);
      porAutor[quien].push([doc(persona, 'signos_vitales', `glu-${claveDia(dia)}`), {
        // Algún pico ocasional semanas atrás; la última semana, estable (la historia es la presión)
        tipo: 'glucosa', valor: d > 7 && azar() < 0.1 ? entre(150, 168) : entre(96, 132), valorSecundario: null, unidad: 'mg/dL',
        fecha: ts(new Date(manana.getTime() - 5 * 60000)), momento: 'ayunas', ...autor(quien), semilla: true,
      }]);
    }
    // Desde la indicación del médico (hace 3 días) también se mide en la noche
    const noche = fecha(d, '20:30');
    if (d <= 3 && noche <= ahora) {
      const quien = guardia(noche);
      porAutor[quien].push([doc(persona, 'signos_vitales', `pa-noche-${claveDia(dia)}`), {
        tipo: 'presion', valor: entre(140, 150), valorSecundario: entre(85, 91), unidad: 'mmHg', fecha: ts(noche), ...autor(quien), semilla: true,
      }]);
    }
    if (d % 7 === 0 && fecha(d, '09:00') <= ahora) {
      const quien = guardia(fecha(d, '09:00'));
      porAutor[quien].push([doc(persona, 'signos_vitales', `peso-${claveDia(dia)}`), {
        tipo: 'peso', valor: Math.round((67.9 - (DIAS - d) * 0.01) * 10) / 10, valorSecundario: null, unidad: 'kg',
        fecha: ts(fecha(d, '09:00')), ...autor(quien), semilla: true,
      }]);
    }

    // Bitácora: una o dos entradas al día
    for (let n = 0; n < entre(1, 2); n++) {
      const cuando = fecha(d, `${pad(entre(9, 20))}:${pad(entre(0, 59))}`);
      if (cuando > ahora) continue;
      const quien = guardia(cuando);
      const tipo = elegir(TIPOS_DIA);
      porAutor[quien].push([doc(persona, 'entradas_bitacora', `sem-${claveDia(dia)}-${n}`), {
        tipo, texto: elegir(BITACORA[tipo]), autorUid: uids[quien], autorNombre: nombre(quien), fecha: ts(cuando),
        creadoEn: ts(new Date(cuando.getTime() + entre(1, 10) * 60000)), semilla: true,
      }]);
    }
  }

  // Lo que pasó con la subida de presión
  const hechos = [
    { id: 'sintoma-cabeza', tipo: 'sintoma', d: 6, h: '10:20', texto: 'Dolor de cabeza en la nuca al despertar; se le pasó a media mañana.' },
    { id: 'sintoma-mareo', tipo: 'sintoma', d: 4, h: '16:40', texto: 'Se mareó al levantarse de la silla; se sentó y se le pasó en un minuto.' },
    { id: 'incidente-tropiezo', tipo: 'incidente', d: 24, h: '18:10', texto: 'Se tropezó con el tapete del pasillo; no cayó al piso. Se quitó el tapete.', caida: false },
    { id: 'nota-caja', tipo: 'nota', d: 7, h: '18:30', texto: 'Ya se compró otra caja de Losartán; quedan 30 pastillas.' },
  ];
  for (const e of hechos) {
    const cuando = fecha(e.d, e.h);
    const quien = guardia(cuando);
    porAutor[quien].push([doc(persona, 'entradas_bitacora', e.id), {
      tipo: e.tipo, texto: e.texto, autorUid: uids[quien], autorNombre: nombre(quien), fecha: ts(cuando),
      creadoEn: ts(new Date(cuando.getTime() + 5 * 60000)), ...('caida' in e ? { caida: e.caida } : {}), semilla: true,
    }]);
  }
  // Paracetamol según necesidad por dolor de rodilla (una vez, dos tomas con menos de 8 h)
  const prn = [[40, '11:00', 5], [31, '17:30', 4], [22, '10:00', 6], [15, '12:15', 5], [12, '09:30', 6], [12, '15:00', 7], [3, '18:00', 4]];
  for (const [d, h, intensidad] of prn) {
    const cuando = fecha(d, h);
    const quien = guardia(cuando);
    porAutor[quien].push([doc(persona, 'medicamentos/paracetamol/tomas', `${idDe(cuando)}00`), {
      horaProgramada: ts(cuando), horaReal: ts(cuando), tomado: true, aDemanda: true, motivo: 'dolor', intensidad, ...firma(quien, cuando), semilla: true,
    }]);
  }

  for (const clave of ['rosa', 'marta', 'laura']) {
    await entrarComo(clave);
    await escribir(porAutor[clave]);
    console.log(`  · ${nombre(clave)}: ${porAutor[clave].length} registros`);
  }

  console.log('5) Indicaciones del médico');
  await entrarComo('doctor');
  await escribir([
    [doc(persona, 'entradas_bitacora', 'indicacion-estable'), {
      tipo: 'indicacion', texto: 'Presión y glucosa en meta. Continuar el mismo tratamiento; glucosa en ayunas a diario.',
      autorUid: uids.doctor, autorNombre: nombre('doctor'), fecha: ts(fecha(35, '11:00')), creadoEn: ts(fecha(35, '11:05')), semilla: true,
    }],
    [doc(persona, 'entradas_bitacora', 'indicacion-presion'), {
      tipo: 'indicacion',
      texto: 'La presión está más alta de lo habitual desde hace una semana. Medirla mañana y noche, sentada y tras 5 minutos de reposo, y no omitir el Losartán. Si pasa de 180/110 o hay dolor de pecho, ir a urgencias. La reviso en la cita.',
      autorUid: uids.doctor, autorNombre: nombre('doctor'), fecha: ts(fecha(3, '19:00')), creadoEn: ts(fecha(3, '19:02')), semilla: true,
    }],
  ]);

  console.log(`\nListo: Elena Ramírez (${PERSONA_ID}) con ${DIAS} días de historial.`);
  console.log('Cuentas (contraseña: la de RELEVO_DEMO_PASSWORD):');
  for (const u of USUARIOS) console.log(`  ${u.nombre.padEnd(16)} ${u.email.padEnd(28)} ${u.rol}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFalló la semilla:', e?.code ?? '', e?.message ?? e);
    process.exit(1);
  });
