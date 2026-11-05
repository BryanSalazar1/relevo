// Utilidades compartidas por las semillas (semilla.mjs y semilla-demo.mjs).
import { createInterface } from 'node:readline/promises';
import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * Franjas de 15 min de la semana en que un enfermero/a puede registrar: sus turnos + 30 min de
 * tolerancia. Mismo cálculo que franjasDeTurnos en src/app/core/utils/registro-turno.ts (lo que
 * revisan las rules con franjaActual()).
 */
export function franjasDeTurnos(turnos) {
  const franjas = new Set();
  const min = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  for (const t of turnos ?? []) {
    const desde = min(t.desde);
    const hasta = min(t.hasta);
    const duracion = (hasta > desde ? hasta - desde : hasta - desde + 1440) + 30;
    for (const d of new Set(t.dias)) {
      const inicio = d * 1440 + desde;
      for (let k = Math.floor(inicio / 15); k * 15 < inicio + duracion; k++) franjas.add(((k % 672) + 672) % 672);
    }
  }
  return [...franjas].sort((a, b) => a - b);
}

/** Toda la semana: para que la semilla escriba el historial firmado por cada enfermero/a. */
export const TODA_LA_SEMANA = Array.from({ length: 672 }, (_, i) => i);

/**
 * Deja verificada la cuenta con la sesión actual (las rules exigen correo verificado).
 *  - Emuladores: lo marca directo en el emulador de Auth (API de administración del emulador).
 *  - Proyecto real: pide el código de 6 dígitos (Cloud Function) y lo pregunta en la terminal; llega
 *    al correo de la cuenta. Así la semilla pasa por el mismo flujo que la app.
 */
export async function asegurarVerificada(app, user, { real, projectId, authHost = 'http://127.0.0.1:9099' }) {
  await user.reload();
  if (user.emailVerified) return;
  if (!real) {
    const r = await fetch(`${authHost}/identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: user.uid, emailVerified: true }),
    });
    if (!r.ok) throw new Error(`No se pudo verificar ${user.email} en el emulador: ${r.status}`);
  } else {
    const fns = getFunctions(app, 'us-central1');
    await httpsCallable(fns, 'enviarCodigoCorreo')().catch((e) => {
      // Si se pidió hace menos de un minuto, sirve el código anterior
      if (e?.code !== 'functions/resource-exhausted') throw e;
    });
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const codigo = (await rl.question(`  Código de 6 dígitos que llegó a ${user.email}: `)).trim();
        try {
          await httpsCallable(fns, 'verificarCodigoCorreo')({ codigo });
          break;
        } catch (e) {
          console.log(`  ${e?.message ?? e}`);
        }
      }
    } finally {
      rl.close();
    }
  }
  await user.reload();
  await user.getIdToken(true);
  console.log(`  ✓ correo verificado: ${user.email}`);
}
