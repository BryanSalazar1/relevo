// Requiere: npm run emulators, npm run semilla y npx ng serve --port 4300 (FORZAR_EMULADORES = true).
// Uso: node tests/evidencias/recorrido-roles.mjs <carpeta de salida>
// Recorrido de la rama agenda-coherente contra los EMULADORES con semilla: cada corrección, rol por rol.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:4300';
const OUT = process.argv[3] || 'capturas-evidencias';
mkdirSync(OUT, { recursive: true });
const PASS = 'relevo123';
const P = 'persona-demo';
const errores = [];
let fallos = 0;
const ok = (m) => console.log('  ✔', m);
const mal = (m) => { fallos += 1; console.log('  ✘', m); };
const foto = async (page, n, ms = 900) => { await page.waitForTimeout(ms); await page.screenshot({ path: `${OUT}/${n}.png` }); };
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ');
let paginaActual = null;
let nFallo = 0;
const paso = async (nombre, fn) => {
  try { await fn(); ok(nombre); }
  catch (e) {
    mal(nombre + ': ' + String(e).split(String.fromCharCode(10)).slice(0, 2).join(' ').slice(0, 300));
    if (paginaActual) { nFallo += 1; await paginaActual.screenshot({ path: OUT + '/fallo' + nFallo + '.png' }).catch(() => {}); await cerrarCapas(paginaActual).catch(() => {}); }
  }
};
const espera = (c, m) => { if (!c) throw new Error(m); };
const cerrarCapas = async (page) => { await page.evaluate(() => document.querySelectorAll('ion-modal, ion-action-sheet, ion-alert, ion-popover').forEach((m) => m.dismiss?.())); await page.waitForTimeout(600); };
function vigilar(page, rol) {
  page.on('pageerror', (e) => errores.push(`${rol}: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    const t = m.text();
    // Funciones (callables) no corren en este equipo: el emulador de Functions no arranca
    if (m.type() === 'error' && !/favicon|ngsw|service worker|5001|ERR_CONNECTION_REFUSED|FirebaseError: internal/i.test(t)) errores.push(`${rol}: ${t.slice(0, 200)}`);
  });
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
const movil = (b) => b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-MX' });
const hoyLista = (page) => page.locator('app-hoy ion-list.agenda ion-item');
async function abrirHoy(page) {
  await page.click('text=Carmen Hernández');
  await page.waitForURL(/\/hoy/, { timeout: 20000 });
  await page.waitForSelector('app-hoy ion-list.agenda ion-item', { timeout: 30000 });
  await page.waitForTimeout(800);
}
async function hojaBotones(page) {
  await page.waitForSelector('ion-action-sheet button', { timeout: 5000 });
  return (await page.locator('ion-action-sheet button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}
async function tab(page, nombre) {
  await page.click(`ion-tab-button[tab="${nombre}"]`);
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch();
let codigo = '';
try {
  // ============================================================ Ana (responsable)
  console.log('— Ana (responsable)');
  let ctx = await movil(browser);
  let page = await ctx.newPage();
  paginaActual = page;
  vigilar(page, 'ana');
  await paso('entra y ve Hoy sin el icono duplicado del semáforo', async () => {
    await entrar(page, 'ana@relevo.test');
    await abrirHoy(page);
    espera((await page.locator('app-hoy ion-header ion-button[routerlink="../semaforo"]').count()) === 0, 'sigue el icono del semáforo en la cabecera');
    espera((await page.locator('app-hoy ion-card.estado').count()) === 1, 'falta la tarjeta del semáforo');
    await foto(page, 'a01_hoy');
  });
  await paso('día anterior muestra "Hoy" y vuelve', async () => {
    await page.locator('app-hoy').getByRole('button', { name: 'Día anterior' }).click();
    await page.waitForTimeout(800);
    espera(await page.locator('app-hoy ion-button.volver-hoy').isVisible(), 'no aparece el botón Hoy');
    await foto(page, 'a02_ayer');
    await page.click('app-hoy ion-button.volver-hoy');
    await page.waitForTimeout(800);
    espera((await page.locator('app-hoy ion-button.volver-hoy').count()) === 0, 'no volvió a hoy');
  });
  await paso('al volver a la pestaña Hoy desde otro día abre en hoy', async () => {
    await page.locator('app-hoy').getByRole('button', { name: 'Día anterior' }).click();
    await tab(page, 'bitacora');
    await tab(page, 'hoy');
    espera((await page.locator('app-hoy ion-button.volver-hoy').count()) === 0, 'Hoy quedó en el día anterior');
  });
  await paso('la entrega de turno conserva lo que mostraba tras ir y volver', async () => {
    const antes = await page.locator('app-hoy ion-card.entrega li').count();
    await tab(page, 'bitacora');
    await tab(page, 'hoy');
    const despues = await page.locator('app-hoy ion-card.entrega li').count();
    espera(despues === antes, `antes ${antes} novedades, después ${despues}`);
    console.log(`     (${antes} novedades en la entrega)`);
  });
  await paso('responsable: opciones de una toma ya tomada (sin repetir "tomada")', async () => {
    const fila = hoyLista(page).filter({ hasText: 'Losartán' }).filter({ hasText: 'Tomada' }).first();
    await fila.click();
    const b = await hojaBotones(page);
    console.log('     hoja:', b.join(' | '));
    espera(!b.includes('Marcar como tomada'), 'ofrece marcar tomada lo que ya está tomado');
    espera(b.includes('Marcar como no tomada') && b.includes('Quitar registro'), 'faltan opciones');
    await foto(page, 'a03_opciones_toma', 300);
    await cerrarCapas(page);
  });
  await paso('marca la dosis pendiente de Metformina 20:00', async () => {
    const fila = hoyLista(page).filter({ hasText: 'Metformina' }).filter({ hasText: 'Pendiente' }).first();
    if (!(await fila.count())) { console.log('     (sin pendiente de Metformina hoy)'); return; }
    await fila.getByRole('button', { name: 'Marcar tomada', exact: true }).click();
    await page.waitForSelector('ion-alert button:has-text("Marcar")', { timeout: 5000 });
    await page.click('ion-alert button:has-text("Marcar")');
    await page.waitForTimeout(1500);
  });
  await paso('Plan: editar solo las notas no toca el inventario', async () => {
    await tab(page, 'plan');
    await page.waitForSelector('app-plan ion-item:has-text("Losartán")', { timeout: 20000 });
    const antes = await texto(page.locator('app-plan ion-item', { hasText: 'Losartán' }).first());
    await page.locator('app-plan ion-item', { hasText: 'Losartán' }).first().click();
    const b = await hojaBotones(page);
    await page.click('ion-action-sheet button:has-text("Editar")');
    await page.waitForSelector('ion-modal ion-textarea[name="notas"] textarea', { timeout: 10000 });
    await page.fill('ion-modal ion-textarea[name="notas"] textarea', 'Tomar con agua');
    await foto(page, 'a04_editar_med', 300);
    await page.click('ion-modal ion-button:has-text("Guardar")');
    await page.waitForTimeout(2000);
    const despues = await texto(page.locator('app-plan ion-item', { hasText: 'Losartán' }).first());
    const unidades = (t) => (t.match(/Quedan (\d+)/i) || [])[1];
    console.log('     antes:', antes.slice(0, 110));
    console.log('     después:', despues.slice(0, 110));
    espera(unidades(antes) === unidades(despues), 'cambió el inventario');
    espera(b.length > 0, 'sin hoja de opciones');
  });
  await paso('Plan: un medicamento nuevo de las 00:05 no aparece atrasado hoy', async () => {
    await page.locator('app-plan ion-header').getByRole('button', { name: /Nuevo|Agregar/ }).click();
    await page.waitForSelector('ion-modal ion-input[name="nombre"] input', { timeout: 10000 });
    await page.fill('ion-modal ion-input[name="nombre"] input', 'Vitamina D');
    await page.fill('ion-modal ion-input[name="dosis"] input', '1 cápsula');
    await page.fill('ion-modal ion-input[name="nuevaHora"] input', '00:05');
    await page.locator('ion-modal ion-button:has-text("Agregar")').last().click();
    await page.waitForTimeout(300);
    await foto(page, 'a05_nuevo_med', 300);
    await page.click('ion-modal ion-button:has-text("Guardar")');
    await page.waitForTimeout(2000);
    await tab(page, 'hoy');
    const vit = await hoyLista(page).filter({ hasText: 'Vitamina D' }).count();
    espera(vit === 0, 'la dosis de las 00:05 de un medicamento recién agregado aparece en Hoy');
  });
  await paso('Bitácora: la indicación del médico solo se puede eliminar', async () => {
    await tab(page, 'bitacora');
    await page.waitForSelector('app-bitacora ion-item', { timeout: 20000 });
    const ind = page.locator('app-bitacora ion-item', { hasText: /indicaci/i }).first();
    await ind.click();
    const b = await hojaBotones(page);
    console.log('     hoja:', b.join(' | '));
    espera(b.includes('Eliminar') && !b.includes('Editar'), 'opciones incorrectas en la indicación');
    await cerrarCapas(page);
    espera((await page.locator('app-bitacora ion-header ion-button[routerlink="../semaforo"]').count()) === 0, 'sigue el semáforo en la bitácora');
  });
  await paso('Equipo: sin "Turnos" duplicado y sin opciones en la propia fila', async () => {
    await tab(page, 'equipo');
    await page.waitForSelector('app-equipo ion-item:has-text("Marta")', { timeout: 20000 });
    const propia = page.locator('app-equipo ion-item', { hasText: '(tú)' }).first();
    espera((await propia.getByRole('button', { name: 'Opciones', exact: true }).count()) === 0, 'la fila propia tiene "…" sin otro responsable');
    await page.locator('app-equipo ion-item', { hasText: 'Marta' }).first().getByRole('button', { name: 'Opciones', exact: true }).click();
    const b = await hojaBotones(page);
    console.log('     Marta:', b.join(' | '));
    espera(!b.includes('Turnos de guardia'), 'Turnos sigue duplicado en la hoja');
    await cerrarCapas(page);
    const luis = page.locator('app-equipo ion-item', { hasText: 'Luis' }).first();
    espera((await luis.locator('ion-button:has-text("Turnos")').count()) === 0, 'el médico tiene botón de turnos');
    // El código de invitación
    await page.waitForSelector('app-equipo .codigo, app-equipo h2.codigo, app-equipo [class*="codigo"]', { timeout: 20000 });
    codigo = ((await page.locator('app-equipo').innerText()).match(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/) || []).slice(1).join('');
    console.log('     código:', codigo);
    await foto(page, 'a06_equipo');
  });
  await paso('Reporte: lo escrito en preguntas no se pierde al cambiar de periodo', async () => {
    await tab(page, 'reporte');
    await page.waitForSelector('app-reporte ion-card.hoja', { timeout: 60000 });
    const caja = page.locator('app-reporte ion-textarea textarea').first();
    await caja.fill('¿Puede bajar la dosis de Metformina? (sin guardar)');
    await page.click('app-reporte ion-segment-button[value="mes"]');
    await page.waitForTimeout(2500);
    await page.waitForSelector('app-reporte ion-card.hoja', { timeout: 60000 });
    const v = await page.locator('app-reporte ion-textarea textarea').first().inputValue();
    espera(v.includes('(sin guardar)'), `se perdió el texto: "${v}"`);
    await foto(page, 'a07_reporte');
  });
  await paso('Perfil: la única responsable no puede borrar su cuenta sin ceder el rol', async () => {
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Carmen Hernández', { timeout: 30000 });
    await page.getByRole('button', { name: 'Mi perfil' }).click();
    await page.waitForSelector('ion-action-sheet button', { timeout: 5000 });
    await page.click('ion-action-sheet button:has-text("Mi perfil")');
    await page.waitForSelector('ion-modal ion-button:has-text("Eliminar cuenta")', { timeout: 10000 });
    await page.click('ion-modal ion-button:has-text("Eliminar cuenta")');
    await page.waitForSelector('ion-alert', { timeout: 10000 });
    const t = await texto(page.locator('ion-alert'));
    console.log('     ', t.slice(0, 160));
    espera(/único responsable/i.test(t), 'no bloquea el borrado');
    await foto(page, 'a08_bloqueo_cuenta', 300);
    await cerrarCapas(page);
  });
  await paso('Ficha y Semáforo desde el inicio vuelven al inicio', async () => {
    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Carmen Hernández', { timeout: 30000 });
    await page.click('ion-button[title="Ficha de emergencia"]');
    await page.waitForURL(/\/ficha/, { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Cerrar la ficha de emergencia' }).click();
    await page.waitForURL(/\/home/, { timeout: 15000 });
    await page.click('ion-button[title="Semáforo del día"]');
    await page.waitForURL(/\/semaforo/, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await foto(page, 'a09_semaforo');
    await page.getByRole('button', { name: 'Salir del semáforo' }).click();
    await page.waitForURL(/\/home/, { timeout: 15000 });
  });
  await ctx.close();

  // ============================================================ Marta (enfermera)
  console.log('— Marta (enfermera)');
  ctx = await movil(browser);
  page = await ctx.newPage();
  paginaActual = page;
  vigilar(page, 'marta');
  await paso('una toma registrada por Ana es solo informativa', async () => {
    await entrar(page, 'marta@relevo.test');
    await abrirHoy(page);
    const fila = hoyLista(page).filter({ hasText: 'Losartán' }).filter({ hasText: 'Tomada' }).first();
    await fila.click();
    await page.waitForSelector('ion-alert', { timeout: 5000 });
    const t = await texto(page.locator('ion-alert'));
    console.log('     ', t.slice(0, 160));
    espera(/registrada por/i.test(t) && (await page.locator('ion-action-sheet').count()) === 0, 'ofrece acciones sobre un registro ajeno');
    await foto(page, 'm01_ajena', 300);
    await cerrarCapas(page);
  });
  await paso('lo que ella registra sí lo puede corregir', async () => {
    const fila = hoyLista(page).filter({ hasText: 'Pendiente' }).first();
    espera(await fila.count(), 'no hay pendientes');
    await fila.getByRole('button', { name: /^Marcar no (tomada|hecha)$/ }).click();
    await page.waitForSelector('ion-alert button:has-text("Marcar")', { timeout: 5000 });
    await page.click('ion-alert button:has-text("Marcar")');
    await page.waitForTimeout(1800);
    const suya = hoyLista(page).filter({ hasText: 'Marta' }).first();
    espera(await suya.count(), 'no aparece su registro');
    await suya.click();
    const b = await hojaBotones(page);
    console.log('     hoja:', b.join(' | '));
    espera(b.includes('Quitar registro'), 'no puede quitar lo suyo');
    await page.click('ion-action-sheet button:has-text("Quitar registro")');
    await page.waitForSelector('ion-alert button:has-text("Quitar")', { timeout: 5000 });
    await page.click('ion-alert button:has-text("Quitar")');
    await page.waitForTimeout(1500);
  });
  await paso('sin insignia de resurtir en Plan (no puede resurtir)', async () => {
    espera((await page.locator('ion-tab-button[tab="plan"] ion-badge').count()) === 0, 'insignia visible');
  });
  await ctx.close();

  // ============================================================ Luis (médico)
  console.log('— Luis (médico)');
  ctx = await movil(browser);
  page = await ctx.newPage();
  paginaActual = page;
  vigilar(page, 'luis');
  await paso('sin semáforo en el inicio y entra a Seguimiento', async () => {
    await entrar(page, 'luis@relevo.test');
    espera((await page.locator('ion-button[title="Semáforo del día"]').count()) === 0, 'el médico ve el semáforo');
    await page.click('text=Carmen Hernández');
    await page.waitForURL(/\/seguimiento/, { timeout: 20000 });
    await page.waitForTimeout(2500);
    await foto(page, 'l01_seguimiento');
  });
  await paso('"Ver todas" las indicaciones filtra el historial aunque ya estuviera abierto', async () => {
    await tab(page, 'bitacora');
    await page.waitForSelector('app-bitacora ion-item', { timeout: 20000 });
    await tab(page, 'seguimiento');
    await page.locator('app-seguimiento ion-button:has-text("Ver todas")').first().click();
    await page.waitForURL(/filtro=indicacion/, { timeout: 10000 });
    await page.waitForTimeout(1200);
    const chip = await texto(page.locator('app-bitacora ion-content').first());
    espera(/indicaci/i.test(chip), 'no muestra el filtro de indicaciones');
    await foto(page, 'l02_indicaciones');
  });
  await ctx.close();

  // ============================================================ Cuenta nueva (enfermero) con el código
  console.log('— Cuenta nueva');
  ctx = await movil(browser);
  page = await ctx.newPage();
  paginaActual = page;
  vigilar(page, 'nuevo');
  await paso('registro con aviso de privacidad y unión con código', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('text=¿No tienes cuenta? Regístrate', { timeout: 60000 });
    await page.click('text=¿No tienes cuenta? Regístrate');
    await page.fill('ion-input[name="nombre"] input', 'Pedro Prueba');
    await page.click('ion-segment-button:has-text("Enfermer")');
    await page.fill('ion-input[name="email"] input', `pedro.${Date.now()}@relevo.test`);
    await page.fill('ion-input[name="password"] input', PASS);
    await page.locator('ion-checkbox').first().click();
    await page.click('ion-button[type="submit"]');
    await page.waitForURL(/\/home/, { timeout: 40000 });
    espera(codigo.length === 8, 'no hay código');
    await page.goto(`${BASE}/unirse/${codigo}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('ion-button:has-text("Unirme")', { timeout: 30000 });
    await page.click('ion-button:has-text("Unirme")');
    await page.waitForURL(/\/personas\/persona-demo\/hoy/, { timeout: 30000 });
    await page.waitForSelector('app-hoy ion-list.agenda ion-item', { timeout: 30000 });
    await foto(page, 'n01_hoy_nuevo');
  });
  await ctx.close();
} finally {
  console.log('errores de consola:', errores.length ? errores : 'ninguno');
  console.log('FALLOS:', fallos);
  await browser.close();
}
