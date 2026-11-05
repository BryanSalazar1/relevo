// Registro por turno, nota de entrega, permiso del familiar y perfiles guardados, en el navegador
// contra los EMULADORES con la semilla (npm run semilla). Nunca contra producción.
//   FIRESTORE_PORT=8085 RELEVO_BASE=http://localhost:4300 node tests/evidencias/turno-registro.mjs <salida>
//
// Los turnos de Marta se ponen relativos a la hora actual escribiendo su documento de miembro con la
// credencial de administración del emulador (lo mismo que guarda Equipo → Turnos; esa pantalla la
// prueba turnos.mjs). Todo lo demás se hace desde la app.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { franjasDeTurnos } from '../../scripts/semilla-utils.mjs';

const OUT = process.argv[2] || 'capturas-turno-registro';
const BASE = process.env.RELEVO_BASE || 'http://localhost:4300';
const FIRESTORE = `http://127.0.0.1:${process.env.FIRESTORE_PORT ?? 8080}`;
const DOCS = `${FIRESTORE}/v1/projects/demo-relevo/databases/(default)/documents`;
const PERSONA = 'persona-demo';
const PASS = 'relevo123';
mkdirSync(OUT, { recursive: true });
let fallos = 0;
const log = [];
const ok = (m) => { log.push(`✔ ${m}`); console.log('✔', m); };
const mal = (m) => { fallos++; log.push(`✘ ${m}`); console.log('✘', m); };
const nota = (m) => { log.push(`   ${m}`); console.log('  ', m); };
const espera = (c, m) => { if (!c) throw new Error(m); };
const limpio = (t) => t.replace(/\s+/g, ' ').trim();
async function paso(nombre, fn) {
  try { await fn(); ok(nombre); } catch (e) { mal(`${nombre}: ${String(e).split('\n').slice(0, 3).join(' ').slice(0, 300)}`); }
}

// ---------- Emulador (preparación) ----------
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
async function miembros() {
  const r = await fetch(`${DOCS}/personas_cuidadas/${PERSONA}/miembros`, { headers: owner });
  return (await r.json()).documents ?? [];
}
async function uidDe(nombre) {
  const d = (await miembros()).find((m) => m.fields?.nombre?.stringValue === nombre);
  if (!d) throw new Error(`No está ${nombre} en el equipo`);
  return d.name.split('/').at(-1);
}
const valor = (v) =>
  Array.isArray(v)
    ? { arrayValue: { values: v.map(valor) } }
    : typeof v === 'number'
      ? { integerValue: String(v) }
      : typeof v === 'string'
        ? { stringValue: v }
        : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)])) } };
/** Turno de hoy de `desdeMin` a `hastaMin` minutos respecto a ahora (como lo guarda Equipo → Turnos). */
async function turnoRelativo(uid, desdeMin, hastaMin) {
  const hhmm = (min) => {
    const d = new Date(Date.now() + min * 60000);
    return { dia: d.getDay(), hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
  };
  const a = hhmm(desdeMin);
  const b = hhmm(hastaMin);
  const turnos = [{ dias: [a.dia], desde: a.hora, hasta: b.hora }];
  const r = await fetch(
    `${DOCS}/personas_cuidadas/${PERSONA}/miembros/${uid}?updateMask.fieldPaths=turnos&updateMask.fieldPaths=franjas`,
    { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: { turnos: valor(turnos), franjas: valor(franjasDeTurnos(turnos)) } }) },
  );
  if (!r.ok) throw new Error(`No se pudo poner el turno: ${r.status}`);
  return `${a.hora}–${b.hora}`;
}

// ---------- Navegador ----------
const b = await chromium.launch();
const errores = [];
async function contexto() {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|403|ERR_/.test(m.text()) && errores.push(m.text()));
  return { ctx, page };
}
async function entrar(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('ion-input[name="email"] input', email);
  await page.fill('ion-input[name="password"] input', PASS);
  await page.click('ion-button[type="submit"]');
  await page.waitForURL(/home/, { timeout: 60000 });
  await page.waitForSelector('app-home ion-card.persona', { timeout: 60000 });
}
const foto = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
async function abrirHoy(page) {
  await page.goto(`${BASE}/personas/${PERSONA}/hoy`);
  await page.waitForSelector('app-hoy ion-list.agenda ion-item', { timeout: 60000 });
  await page.waitForTimeout(2500);
}
/** Botones para registrar: marcar pendientes y "Registrar signos vitales" (solo a quien puede registrar ahora) */
const botonesMarcar = (page) =>
  page
    .locator('app-hoy .acciones-hoy ion-button:has-text("Registrar signos"), app-hoy ion-list.agenda ion-button:has-text("Tomada"), app-hoy ion-list.agenda ion-button:has-text("Hecha")')
    .count();
/** La fila de un miembro en Equipo (no la de los contactos de la ficha) */
const filaMiembro = (page, nombre) =>
  page.locator('app-equipo ion-item', { hasText: nombre, has: page.getByRole('button', { name: 'Opciones' }) }).first();

const textoNota = `Durmió poco; ya cenó. Falta el baño de la noche. (${Date.now() % 100000})`;
try {
  const marta = await uidDe('Marta López');
  const { ctx: cM, page: M } = await contexto();
  await entrar(M, 'marta@relevo.test');

  await paso('perfil guardado: al entrar queda Marta en este dispositivo (sin la contraseña)', async () => {
    const guardado = await M.evaluate(() => localStorage.getItem('relevo:perfiles'));
    espera(guardado && guardado.includes('marta@relevo.test'), `no se guardó: ${guardado}`);
    espera(!/relevo123/.test(guardado), 'guardó la contraseña');
  });

  await paso('a mitad del turno: registra y no le pide la nota todavía', async () => {
    nota(`turno de Marta: ${await turnoRelativo(marta, -120, 120)}`);
    await abrirHoy(M);
    espera((await M.locator('app-hoy ion-card.fin-turno').count()) === 0, 'pide la nota a mitad del turno');
    espera((await M.locator('app-hoy ion-card.sin-registro').count()) === 0, 'dice que no puede registrar');
    espera((await botonesMarcar(M)) > 0, 'no hay botones para marcar');
  });

  await paso('20 min antes del fin: "Tu turno está próximo a acabar", nota y recordatorio de cerrar sesión', async () => {
    nota(`turno de Marta: ${await turnoRelativo(marta, -240, 20)}`);
    await M.waitForSelector('app-hoy ion-card.fin-turno', { timeout: 40000 });
    const t = limpio(await M.locator('app-hoy ion-card.fin-turno').innerText());
    nota(t);
    espera(/próximo a acabar/.test(t), 'no dice que está por acabar');
    espera(/cerrar tu sesión/.test(t), 'no recuerda cerrar sesión');
    espera((await M.locator('app-hoy ion-card.fin-turno ion-button:has-text("Cerrar sesión")').count()) === 1, 'sin botón de cerrar sesión');
    espera((await botonesMarcar(M)) > 0, 'ya no puede marcar antes del fin');
    await foto(M, 't01_fin_de_turno');
  });

  await paso('deja la nota para quien sigue y el aviso ya no vuelve en este turno', async () => {
    await M.click('app-hoy ion-card.fin-turno ion-button:has-text("Dejar nota")');
    await M.waitForSelector('ion-alert textarea', { timeout: 15000 });
    await M.fill('ion-alert textarea', textoNota);
    await foto(M, 't02_nota_entrega');
    await M.click('ion-alert button:has-text("Guardar nota")');
    await M.waitForSelector('ion-toast', { timeout: 15000 });
    await M.waitForTimeout(1500);
    espera((await M.locator('app-hoy ion-card.fin-turno').count()) === 0, 'el aviso sigue');
    await abrirHoy(M);
    espera((await M.locator('app-hoy ion-card.fin-turno').count()) === 0, 'el aviso volvió al recargar');
  });

  await paso('la nota queda en la bitácora como "Entrega de turno" firmada por Marta', async () => {
    await M.goto(`${BASE}/personas/${PERSONA}/bitacora`);
    await M.waitForSelector('app-bitacora', { timeout: 30000 });
    const item = M.locator('app-bitacora ion-item', { hasText: textoNota.slice(0, 20) }).first();
    await item.waitFor({ timeout: 30000 });
    const t = limpio(await item.innerText());
    nota(t);
    espera(/Entrega de turno/.test(t) && /Marta/.test(t), `bitácora: ${t}`);
  });

  await paso('en la tolerancia (10 min después del fin) todavía registra y le dice hasta qué hora', async () => {
    nota(`turno de Marta: ${await turnoRelativo(marta, -240, -10)}`);
    await M.evaluate(() => localStorage.removeItem('relevo:nota-entrega'));
    await abrirHoy(M);
    const t = limpio(await M.locator('app-hoy ion-card.fin-turno').innerText());
    nota(t);
    espera(/Tu turno terminó a las/.test(t) && /Puedes registrar hasta las/.test(t), `aviso: ${t}`);
    espera((await botonesMarcar(M)) > 0, 'no puede registrar en la tolerancia');
  });

  await paso('fuera de turno (40 min después): solo ve, sin botones, con su próximo turno', async () => {
    nota(`turno de Marta: ${await turnoRelativo(marta, -240, -40)}`);
    await abrirHoy(M);
    const t = limpio(await M.locator('app-hoy ion-card.sin-registro').innerText());
    nota(t);
    espera(/Tu turno terminó a las/.test(t) && /solo registras durante tu turno/.test(t), `aviso: ${t}`);
    espera((await botonesMarcar(M)) === 0, 'puede marcar fuera de turno');
    await foto(M, 't03_fuera_de_turno');
    await M.goto(`${BASE}/personas/${PERSONA}/bitacora`);
    await M.waitForSelector('app-bitacora', { timeout: 30000 });
    await M.waitForTimeout(2000);
    espera((await M.locator('app-bitacora').getByRole('button', { name: 'Nuevo registro' }).count()) === 0, 'puede escribir en la bitácora');
  });

  await paso('Equipo (como lo ve Marta): su línea dice que registra solo en su turno', async () => {
    await M.goto(`${BASE}/personas/${PERSONA}/equipo`);
    const fila = M.locator('app-equipo ion-item', { hasText: '(tú)' }).first();
    await fila.waitFor({ timeout: 30000 });
    espera(/Registra solo en su turno/.test(limpio(await fila.innerText())), limpio(await fila.innerText()));
  });

  await paso('"Cerrar sesión" del aviso de fin de turno y vuelta con el perfil guardado', async () => {
    nota(`turno de Marta: ${await turnoRelativo(marta, -240, 15)}`);
    await M.evaluate(() => localStorage.removeItem('relevo:nota-entrega'));
    await abrirHoy(M);
    await M.click('app-hoy ion-card.fin-turno ion-button:has-text("Cerrar sesión")');
    await M.click('ion-alert button:has-text("Cerrar sesión")');
    await M.waitForURL(/\/login/, { timeout: 30000 });
    await M.waitForSelector('[data-prueba="perfiles"]', { timeout: 30000 });
    const t = limpio(await M.locator('[data-prueba="perfiles"]').innerText());
    nota(t);
    espera(/Marta López/.test(t) && /marta@relevo.test/.test(t), `perfiles: ${t}`);
    await M.waitForTimeout(2000);
    await foto(M, 't04_perfiles_guardados');
    await M.locator('[data-prueba="perfiles"] .perfil', { hasText: 'Marta' }).click();
    await M.waitForSelector('[data-prueba="perfil-elegido"]');
    espera((await M.locator('ion-input[name="email"]').count()) === 0, 'sigue pidiendo el correo');
    await M.fill('ion-input[name="password"] input', PASS);
    await foto(M, 't05_perfil_elegido');
    await M.click('ion-button[type="submit"]');
    await M.waitForURL(/home/, { timeout: 60000 });
  });
  await cM.close();

  // Ana (responsable): ve la nota en su entrega de turno y administra el permiso de Sofía
  const { ctx: cA, page: A } = await contexto();
  await entrar(A, 'ana@relevo.test');
  await paso('la siguiente persona ve la nota en "Desde tu último turno", firmada por Marta', async () => {
    await abrirHoy(A);
    const t = limpio(await A.locator('app-hoy ion-card.entrega').innerText());
    nota(t.slice(0, 300));
    espera(t.includes('Nota de entrega:') && t.includes(textoNota.slice(0, 30)) && /Marta/.test(t), 'no aparece la nota de entrega');
    await foto(A, 't06_entrega_con_nota');
  });

  await paso('el responsable le quita a Sofía (familiar) el permiso de registrar', async () => {
    await A.goto(`${BASE}/personas/${PERSONA}/equipo`);
    const fila = filaMiembro(A, 'Sofía');
    await fila.waitFor({ timeout: 30000 });
    espera(/Puede registrar/.test(limpio(await fila.innerText())), limpio(await fila.innerText()));
    await fila.getByRole('button', { name: 'Opciones', exact: true }).last().click();
    await A.click('ion-action-sheet button:has-text("Quitar permiso de registrar")');
    await A.waitForTimeout(2000);
    espera(/requiere tu permiso/.test(limpio(await fila.innerText())), limpio(await fila.innerText()));
  });

  const { ctx: cS, page: S } = await contexto();
  await entrar(S, 'sofia@relevo.test');
  await paso('Sofía sin permiso: ve todo, sin botones, y el aviso dice que el responsable da el permiso', async () => {
    await abrirHoy(S);
    const t = limpio(await S.locator('app-hoy ion-card.sin-registro').innerText());
    nota(t);
    espera(/darte permiso/.test(t), t);
    espera((await botonesMarcar(S)) === 0, 'puede marcar sin permiso');
    await foto(S, 't07_familiar_sin_permiso');
  });

  await paso('al devolverle el permiso, a Sofía le aparecen los botones sin recargar', async () => {
    await filaMiembro(A, 'Sofía').getByRole('button', { name: 'Opciones', exact: true }).last().click();
    await A.click('ion-action-sheet button:has-text("Permitir registrar")');
    await S.waitForSelector('app-hoy ion-card.sin-registro', { state: 'detached', timeout: 20000 });
    espera((await botonesMarcar(S)) > 0, 'sigue sin botones');
  });
  await cA.close();
  await cS.close();

  // Marta queda otra vez de turno las 24 h, como en la semilla (para las demás pruebas)
  await fetch(
    `${DOCS}/personas_cuidadas/${PERSONA}/miembros/${marta}?updateMask.fieldPaths=turnos&updateMask.fieldPaths=franjas`,
    {
      method: 'PATCH',
      headers: owner,
      body: JSON.stringify({
        fields: {
          turnos: valor([{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }]),
          franjas: valor(franjasDeTurnos([{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }])),
        },
      }),
    },
  );
} finally {
  log.push(`errores de consola: ${errores.length ? errores.join(' | ') : 'ninguno'}`);
  log.push(`FALLOS: ${fallos}`);
  console.log('errores de consola:', errores.length ? errores : 'ninguno');
  console.log('FALLOS:', fallos);
  writeFileSync(`${OUT}/registro.txt`, log.join('\n') + '\n');
  await b.close();
}
