// Completa el historial de Elena (persona-elena, proyecto REAL) desde donde terminó la semilla hasta
// la mañana de la presentación, firmado por quien estaba de guardia. No reescribe lo que ya existe
// (ids deterministas: si el documento ya está, se respeta) y todo lleva `semilla: true` para que las
// Cloud Functions no manden avisos.
//   RELEVO_DEMO_PASSWORD=... node scripts/demo-presentacion.mjs            -> solo cuenta lo que haría
//   RELEVO_DEMO_PASSWORD=... node scripts/demo-presentacion.mjs --escribir -> escribe
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  Timestamp, collection, doc, getDoc, getDocs, getFirestore, updateDoc, writeBatch,
} from 'firebase/firestore';
import { TODA_LA_SEMANA, franjasDeTurnos } from './semilla-utils.mjs';

const ESCRIBIR = process.argv.includes('--escribir');
const PASSWORD = process.env.RELEVO_DEMO_PASSWORD;
if (!PASSWORD) {
  console.error('Falta RELEVO_DEMO_PASSWORD');
  process.exit(1);
}
const src = readFileSync(new URL('../src/environments/firebase.config.ts', import.meta.url), 'utf8');
const cfg = {};
for (const m of (src.match(/firebaseConfig\s*=\s*\{([\s\S]*?)\};/)?.[1] ?? '').matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) cfg[m[1]] = m[2];
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
const P = 'personas_cuidadas/persona-elena';

const CUENTAS = {
  rosa: { email: 'relevo740rosa@gmail.com', nombre: 'Rosa Martínez' },
  marta: { email: 'relevo740marta@gmail.com', nombre: 'Marta Ruiz' },
  carlos: { email: 'relevo740carlos@gmail.com', nombre: 'Carlos Martínez' },
};
const TURNOS_MARTA = [
  { dias: [1, 2, 3, 4, 5], desde: '07:00', hasta: '15:00' },
  { dias: [6], desde: '07:00', hasta: '19:00' },
];
/** De guardia (como en Equipo): Marta L-V 07-15 y sábado 07-19; Laura (en pausa: la cubre Rosa) L-V 15-23 y domingo 07-19; Carlos las noches */
function guardia(d) {
  const dia = d.getDay();
  const h = d.getHours() + d.getMinutes() / 60;
  if (dia >= 1 && dia <= 5) {
    if (h >= 7 && h < 15) return 'marta';
    if (h >= 15 && h < 23) return 'rosa';
    return 'carlos';
  }
  if (dia === 6) return h >= 7 && h < 19 ? 'marta' : 'carlos';
  return h >= 7 && h < 19 ? 'rosa' : 'carlos';
}

// Desde el lunes 2 de noviembre a mediodía (donde terminó la semilla) hasta el jueves 5 a las 08:55
const DESDE = new Date(2026, 10, 2, 12, 0);
const HASTA = new Date(2026, 10, 5, 8, 55);
let semilla = 20261105;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = (l) => l[Math.floor(azar() * l.length)];
const pad = (n) => String(n).padStart(2, '0');
const idDe = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const claveDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ts = (d) => Timestamp.fromDate(d);
const en = (dia, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(dia);
  d.setHours(h, m, 0, 0);
  return d;
};
const dentro = (d) => d >= DESDE && d <= HASTA;
const mas = (d, min) => new Date(d.getTime() + min * 60000);

const NOTAS = {
  nota: [
    'Tejió un rato en la tarde y escuchó la radio.',
    'Tomó agua bien durante el día (unos 6 vasos), como pidió el doctor.',
    'Vino su nieta a comer; estuvo muy platicadora.',
    'Se le pusieron crema y medias de compresión en las piernas.',
  ],
  animo: ['Tranquila y de buen humor.', 'Un poco preocupada por la cita del jueves; se le explicó qué le van a revisar.'],
  sueno: ['Durmió unas 7 horas; se levantó una vez al baño.', 'Se acostó a las 21:30 y durmió de corrido.'],
};
const ENTREGAS = [
  { quien: 'carlos', cuando: new Date(2026, 10, 3, 6, 50), texto: 'Noche tranquila. Se levantó una vez al baño a las 3; la acompañé. Ya está despierta, le toca la presión en ayunas.' },
  { quien: 'carlos', cuando: new Date(2026, 10, 4, 6, 45), texto: 'Durmió bien. A las 2 dijo que le dolía un poco la cabeza; se le dio agua y se volvió a dormir. Vigilar la presión de la mañana.' },
  { quien: 'carlos', cuando: new Date(2026, 10, 5, 6, 50), texto: 'Noche tranquila, sin dolor de cabeza. Hoy a las 10 es la cita con el Dr. Soto por la presión: llevar la hoja para la consulta. La presión de anoche quedó anotada.' },
  { quien: 'marta', cuando: new Date(2026, 10, 3, 14, 40), texto: 'Comió completo. Presión de la mañana alta (ver registro). Pendiente: caminata de las 17:00.' },
  { quien: 'marta', cuando: new Date(2026, 10, 4, 14, 45), texto: 'Mañana sin novedades; tomó todos sus medicamentos. Le recordé que mañana es la cita del doctor.' },
];

const plan = { meds: [], tareas: [] };
const porQuien = { rosa: [], marta: [], carlos: [] };
const firma = (q, uids, cuando) => ({ registradoPor: uids[q], registradoNombre: CUENTAS[q].nombre, registradoEn: ts(cuando) });
const autor = (q, uids) => ({ autorUid: uids[q], autorNombre: CUENTAS[q].nombre });

async function existe(ruta) {
  return (await getDoc(doc(db, ruta))).exists();
}

async function main() {
  const uids = {};
  for (const [k, c] of Object.entries(CUENTAS)) uids[k] = (await signInWithEmailAndPassword(auth, c.email, PASSWORD)).user.uid;
  await signInWithEmailAndPassword(auth, CUENTAS.rosa.email, PASSWORD);
  plan.meds = (await getDocs(collection(db, `${P}/medicamentos`))).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => m.activo && !m.segunNecesidad);
  plan.tareas = (await getDocs(collection(db, `${P}/tareas`))).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.activo !== false);

  const agregar = async (quien, ruta, datos) => {
    if (await existe(ruta)) return;
    porQuien[quien].push([ruta, datos]);
  };

  for (let dia = new Date(2026, 10, 2); dia <= HASTA; dia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1)) {
    for (const m of plan.meds) {
      for (const h of m.horarios ?? []) {
        const prog = en(dia, h);
        if (!dentro(prog)) continue;
        const real = mas(prog, entre(0, 20));
        const q = guardia(prog);
        await agregar(q, `${P}/medicamentos/${m.id}/tomas/${idDe(prog)}`, {
          horaProgramada: ts(prog), horaReal: ts(real), tomado: true, ...firma(q, uids, real), semilla: true,
        });
      }
    }
    for (const t of plan.tareas) {
      if (t.dias?.length && !t.dias.includes(dia.getDay())) continue;
      for (const h of t.horarios ?? []) {
        const prog = en(dia, h);
        if (!dentro(prog)) continue;
        const real = mas(prog, entre(0, 15));
        const q = guardia(prog);
        await agregar(q, `${P}/tareas/${t.id}/registros/${idDe(prog)}`, {
          hecha: true, horaProgramada: ts(prog), horaReal: ts(real), ...firma(q, uids, real), semilla: true,
        });
      }
    }
    // Presión alta (sigue la historia: cita con el Dr. Soto el jueves) y glucosa estable, en ayunas
    const manana = en(dia, '07:50');
    if (dentro(manana)) {
      const q = guardia(manana);
      await agregar(q, `${P}/signos_vitales/pa-${claveDia(dia)}`, {
        tipo: 'presion', valor: entre(145, 154), valorSecundario: entre(88, 94), unidad: 'mmHg', fecha: ts(manana), ...autor(q, uids), semilla: true,
      });
      await agregar(q, `${P}/signos_vitales/glu-${claveDia(dia)}`, {
        tipo: 'glucosa', valor: entre(102, 128), valorSecundario: null, unidad: 'mg/dL', momento: 'ayunas', fecha: ts(mas(manana, -5)), ...autor(q, uids), semilla: true,
      });
    }
    // Indicación del médico: también en la noche
    const noche = en(dia, '20:30');
    if (dentro(noche)) {
      const q = guardia(noche);
      await agregar(q, `${P}/signos_vitales/pa-noche-${claveDia(dia)}`, {
        tipo: 'presion', valor: entre(140, 149), valorSecundario: entre(85, 90), unidad: 'mmHg', fecha: ts(noche), ...autor(q, uids), semilla: true,
      });
    }
    for (let n = 0; n < 2; n++) {
      const cuando = en(dia, `${pad(entre(10, 19))}:${pad(entre(0, 59))}`);
      if (!dentro(cuando)) continue;
      const tipo = elegir(['nota', 'nota', 'animo', 'sueno']);
      const q = guardia(cuando);
      await agregar(q, `${P}/entradas_bitacora/pres-${claveDia(dia)}-${n}`, {
        tipo, texto: elegir(NOTAS[tipo]), ...autor(q, uids), fecha: ts(cuando), creadoEn: ts(mas(cuando, entre(1, 8))), semilla: true,
      });
    }
  }
  for (const e of ENTREGAS) {
    if (!dentro(e.cuando)) continue;
    await agregar(e.quien, `${P}/entradas_bitacora/entrega-${idDe(e.cuando)}`, {
      tipo: 'entrega', texto: e.texto, ...autor(e.quien, uids), fecha: ts(e.cuando), creadoEn: ts(e.cuando), semilla: true,
    });
  }

  for (const [q, l] of Object.entries(porQuien)) console.log(`${CUENTAS[q].nombre}: ${l.length} registros nuevos`);
  if (!ESCRIBIR) {
    console.log('\n(Solo se contó. Para escribir: --escribir)');
    return;
  }

  // Marta firma sus mañanas: mientras se escribe, su turno abarca la semana; al final, el real
  const martaRef = doc(db, `${P}/miembros/${uids.marta}`);
  await updateDoc(martaRef, { franjas: TODA_LA_SEMANA });
  try {
    for (const q of ['carlos', 'marta', 'rosa']) {
      if (!porQuien[q].length) continue;
      await signInWithEmailAndPassword(auth, CUENTAS[q].email, PASSWORD);
      for (let i = 0; i < porQuien[q].length; i += 200) {
        const b = writeBatch(db);
        for (const [ruta, datos] of porQuien[q].slice(i, i + 200)) b.set(doc(db, ruta), datos);
        await b.commit();
      }
      console.log(`  escrito: ${CUENTAS[q].nombre}`);
    }
  } finally {
    await signInWithEmailAndPassword(auth, CUENTAS.rosa.email, PASSWORD);
    await updateDoc(martaRef, { franjas: franjasDeTurnos(TURNOS_MARTA) });
    console.log('  turno real de Marta restaurado');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Falló:', e?.code ?? '', e?.message ?? e);
    process.exit(1);
  });
