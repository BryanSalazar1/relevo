// Requiere: npm run emulators, npm run semilla y npx ng serve --port 4300 (FORZAR_EMULADORES = true).
// Uso: node tests/evidencias/evidencias-navegador.mjs <carpeta de salida>
// Evidencias para el documento (contra EMULADORES con semilla):
//  E1 latencia de sincronización entre dos sesiones (10 repeticiones)
//  E2 revocación con la app abierta (Ana quita a Marta)
//  E3 cerrar sesión borra la copia local de Firestore (IndexedDB)
//  y capturas para las figuras.
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const BASE = 'http://localhost:4300';
const OUT = process.argv[2];
const PASS = 'relevo123';
const log = [];
const L = (s) => { console.log(s); log.push(s); };
const errores = [];
const movil = (b) => b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'es-MX' });
function vigilar(page, n) {
  page.on('pageerror', (e) => errores.push(`${n}: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|ngsw|5001|ERR_CONNECTION_REFUSED|FirebaseError: internal|permission|insufficient/i.test(t)) errores.push(`${n}: ${t.slice(0, 160)}`); });
}
async function entrar(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('ion-input[name="email"] input', { timeout: 90000 });
  await page.fill('ion-input[name="email"] input', email);
  await page.fill('ion-input[name="password"] input', PASS);
  await page.click('ion-button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 40000 });
  await page.waitForSelector('text=Carmen Hernández', { timeout: 40000 });
}
const foto = async (page, n, ms = 1200) => { await page.waitForTimeout(ms); await page.screenshot({ path: `${OUT}/${n}.png` }); };
const bdLocales = (page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => /firestore/i.test(n)));

const browser = await chromium.launch();
try {
  const cAna = await movil(browser); const ana = await cAna.newPage(); vigilar(ana, 'ana');
  const cSofia = await movil(browser); const sofia = await cSofia.newPage(); vigilar(sofia, 'sofia');
  const cMarta = await movil(browser); const marta = await cMarta.newPage(); vigilar(marta, 'marta');
  const cLuis = await movil(browser); const luis = await cLuis.newPage(); vigilar(luis, 'luis');
  await entrar(ana, 'ana@relevo.test');
  await entrar(sofia, 'sofia@relevo.test');
  await entrar(marta, 'marta@relevo.test');
  await entrar(luis, 'luis@relevo.test');

  // Figuras: Hoy (Ana), Equipo con QR (Ana), Seguimiento (Luis), Hoja (Ana), Semáforo
  await ana.click('text=Carmen Hernández'); await ana.waitForURL(/\/hoy/); await ana.waitForSelector('app-hoy ion-list.agenda ion-item', { timeout: 30000 });
  await foto(ana, 'fig_hoy', 2000);
  await luis.click('text=Carmen Hernández'); await luis.waitForURL(/\/seguimiento/, { timeout: 30000 }); await foto(luis, 'fig_seguimiento', 4000);

  // E1: latencia. Sofía mira la bitácora; Ana escribe notas con el SDK de la página (misma ruta que la app)
  await sofia.click('text=Carmen Hernández'); await sofia.waitForURL(/\/hoy/);
  await sofia.click('ion-tab-button[tab="bitacora"]'); await sofia.waitForSelector('app-bitacora ion-item', { timeout: 30000 });
  await ana.click('ion-tab-button[tab="bitacora"]'); await ana.waitForSelector('app-bitacora ion-item', { timeout: 30000 });
  const tiempos = [];
  for (let i = 1; i <= 10; i++) {
    const marca = `Prueba de sincronización ${i} · ${Date.now()}`;
    await ana.getByRole('button', { name: 'Nuevo registro' }).click();
    await ana.waitForSelector('ion-modal ion-textarea[name="texto"] textarea', { timeout: 10000 });
    await ana.locator('ion-modal ion-chip', { hasText: /Nota/ }).first().click().catch(() => {});
    await ana.fill('ion-modal ion-textarea[name="texto"] textarea', marca);
    const espera = sofia.waitForSelector(`app-bitacora ion-item:has-text("${marca}")`, { timeout: 20000 });
    const t0 = Date.now();
    await ana.click('ion-modal ion-button:has-text("Guardar")');
    await espera;
    tiempos.push(Date.now() - t0);
    await ana.waitForTimeout(700);
  }
  tiempos.sort((a, b) => a - b);
  L(`E1 sincronización (emulador local, 10 repeticiones, del toque en Guardar en la sesión A a que el texto aparece en la sesión B sin recargar): mín ${tiempos[0]} ms, mediana ${tiempos[5]} ms, máx ${tiempos[9]} ms; ${JSON.stringify(tiempos)}`);
  await foto(sofia, 'fig_sync_sofia', 500);

  // Figura Equipo con QR
  await ana.click('ion-tab-button[tab="equipo"]'); await ana.waitForSelector('app-equipo img', { timeout: 30000 }); await foto(ana, 'fig_equipo_qr', 1500);

  // E2: revocación con la app abierta
  await marta.click('text=Carmen Hernández'); await marta.waitForURL(/\/hoy/); await marta.waitForSelector('app-hoy ion-list.agenda ion-item', { timeout: 30000 });
  await ana.locator('app-equipo ion-item', { hasText: 'Marta' }).first().getByRole('button', { name: 'Opciones', exact: true }).click();
  await ana.click('ion-action-sheet button:has-text("Quitar del equipo")');
  await ana.waitForSelector('ion-alert button:has-text("Quitar")');
  const t0 = Date.now();
  await ana.click('ion-alert button:has-text("Quitar")');
  await marta.waitForURL(/\/home/, { timeout: 20000 });
  const tRev = Date.now() - t0;
  await marta.waitForTimeout(1500);
  const sigue = await marta.locator('text=Carmen Hernández').count();
  await foto(marta, 'fig_revocacion', 200);
  L(`E2 revocación: Marta fue enviada a su inicio ${tRev} ms después de que Ana la quitó; la tarjeta de Carmen en su inicio: ${sigue ? 'sigue visible ✘' : 'ya no aparece ✔'}`);
  // Intentar volver por la URL directa
  await marta.goto(`${BASE}/personas/persona-demo/bitacora`, { waitUntil: 'domcontentloaded' });
  await marta.waitForTimeout(5000);
  const filas = await marta.locator('app-bitacora ion-item:has-text("Prueba de sincronización")').count();
  L(`E2b URL directa a la bitácora tras la revocación: ${marta.url().includes('/home') ? 'redirigida a inicio ✔' : `se queda en ${marta.url()}`}; registros visibles: ${filas}`);

  // E3: cerrar sesión borra la copia local
  const antes = await bdLocales(sofia);
  await sofia.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' }); await sofia.waitForSelector('text=Carmen Hernández', { timeout: 30000 });
  await sofia.getByRole('button', { name: 'Mi perfil' }).click();
  await sofia.click('ion-action-sheet button:has-text("Cerrar sesión")');
  await sofia.waitForURL(/\/login/, { timeout: 20000 });
  await sofia.waitForTimeout(2500);
  const despues = await bdLocales(sofia);
  L(`E3 copia local de Firestore (IndexedDB) antes de cerrar sesión: ${JSON.stringify(antes)}; después: ${JSON.stringify(despues)}`);

  // Figura: semáforo de Ana
  await ana.goto(`${BASE}/personas/persona-demo/semaforo`, { waitUntil: 'domcontentloaded' }); await foto(ana, 'fig_semaforo', 3000);
  // Figura: hoja para la consulta (tarjeta en Reporte)
  await ana.goto(`${BASE}/personas/persona-demo/reporte`, { waitUntil: 'domcontentloaded' });
  await ana.waitForSelector('app-reporte ion-card.hoja', { timeout: 60000 }); await foto(ana, 'fig_reporte', 2000);
  // PDF de la hoja
  const [descarga] = await Promise.all([
    ana.waitForEvent('download', { timeout: 30000 }),
    ana.locator('app-reporte ion-header').getByRole('button', { name: 'Exportar hoja para la consulta' }).click(),
  ]).catch(async (e) => { L('PDF: ' + String(e).split('\n')[0]); return [null]; });
  if (descarga) { await descarga.saveAs(`${OUT}/hoja_consulta.pdf`); L('PDF de la hoja guardado'); }
} finally {
  L(`errores de consola: ${errores.length ? JSON.stringify(errores) : 'ninguno'}`);
  writeFileSync(`${OUT}/evidencias_navegador.txt`, log.join('\n'), 'utf8');
  await browser.close();
}
