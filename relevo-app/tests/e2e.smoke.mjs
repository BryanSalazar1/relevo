// Prueba de humo de punta a punta con un navegador real (Playwright + Chromium).
//
//   npm run test:e2e                  -> contra la app publicada (https://relevo-e5eaf.web.app)
//   npm run test:e2e -- http://localhost:8101   -> contra ionic serve
//
// Recorre el flujo principal contra el Firebase REAL: login, bitácora (crear y borrar un
// registro), invitación con código/QR, reporte + PDF, y un usuario nuevo que se une con el
// código. Al final limpia lo que creó (registro, invitación, usuario de prueba).

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { deleteUser, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { deleteDoc, doc, getDoc, getFirestore } from 'firebase/firestore';

const BASE = process.argv[2] || 'https://relevo-e5eaf.web.app';
const ANA = { email: 'ana@relevo.test', password: 'relevo123' };
const NUEVO = { email: `prueba+${Date.now()}@relevo.test`, password: 'relevo123', nombre: 'Pedro Prueba' };
const TEXTO = `Prueba automática ${new Date().toLocaleTimeString('es-MX')}`;
const PERSONA_ID = 'persona-demo';

let paso = 0;
const ok = (msg) => console.log(`  ✔ ${++paso}. ${msg}`);

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`);
  await page.fill('ion-input[name="email"] input', email);
  await page.fill('ion-input[name="password"] input', password);
  await page.click('ion-button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 20_000 });
}

async function registrar(page, { email, password, nombre }) {
  await page.goto(`${BASE}/login`);
  await page.click('text=¿No tienes cuenta? Regístrate');
  await page.fill('ion-input[name="nombre"] input', nombre);
  await page.click('ion-segment-button:has-text("Familiar")');
  await page.fill('ion-input[name="email"] input', email);
  await page.fill('ion-input[name="password"] input', password);
  await page.click('ion-button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 20_000 });
}

async function cerrarSesion(page) {
  await page.goto(`${BASE}/home`);
  await page.click('button[aria-label="Cerrar sesión"]');
  await page.waitForURL(/\/login/, { timeout: 15_000 });
}

const browser = await chromium.launch();
const contexto = await browser.newContext({ acceptDownloads: true, locale: 'es-MX' });
// App Check: en un navegador automatizado reCAPTCHA no da puntaje; se usa el token de depuración
// registrado en Firebase (tests/.appcheck-debug.json, fuera de git) para que el asistente responda.
try {
  const { debugToken } = JSON.parse(readFileSync(new URL('./.appcheck-debug.json', import.meta.url), 'utf8'));
  await contexto.addInitScript((t) => { self.FIREBASE_APPCHECK_DEBUG_TOKEN = t; }, debugToken);
} catch {
  console.log('  (sin tests/.appcheck-debug.json: el paso del asistente puede fallar por App Check)');
}
const page = await contexto.newPage();
const erroresConsola = [];
page.on('pageerror', (e) => erroresConsola.push(String(e)));
page.on('console', (m) => {
  // requestStorageAccess: lo emite el iframe de reCAPTCHA en Chromium headless; no afecta a la app
  if (m.type() === 'error' && !/favicon|ngsw|service worker|requestStorageAccess/i.test(m.text())) {
    erroresConsola.push(m.text());
  }
});

let codigo = null;
try {
  console.log(`Probando ${BASE}`);

  // ---------------------------------------------------------------- Ana
  await login(page, ANA);
  await page.waitForSelector('text=Carmen Hernández', { timeout: 20_000 });
  ok('login como Ana y lista de personas');

  await page.click('text=Carmen Hernández');
  await page.waitForURL(/\/personas\/persona-demo\/bitacora/, { timeout: 15_000 });
  await page.waitForSelector('text=Desayunó avena', { timeout: 20_000 });
  ok('bitácora de Carmen con los registros sembrados');

  await page.click('button[aria-label="Nuevo registro"]');
  await page.waitForSelector('app-entrada-modal ion-textarea textarea', { timeout: 10_000 });
  await page.click('app-entrada-modal ion-chip:has-text("Ánimo")');
  await page.fill('app-entrada-modal ion-textarea textarea', TEXTO);
  await page.click('app-entrada-modal ion-button:has-text("Guardar")');
  await page.waitForSelector(`text=${TEXTO}`, { timeout: 20_000 });
  ok('nuevo registro guardado y visible en tiempo real');

  // ---------------------------------------------------------------- medicamentos
  await page.click('ion-tab-button[tab="medicamentos"]');
  await page.waitForSelector('text=Tomas del día', { timeout: 15_000 });
  await page.click('button[aria-label="Nuevo medicamento"]');
  await page.waitForSelector('app-medicamento-modal ion-input[name="nombre"] input', { timeout: 10_000 });
  await page.fill('app-medicamento-modal ion-input[name="nombre"] input', 'Prueba Med');
  await page.fill('app-medicamento-modal ion-input[name="dosis"] input', '1 tableta');
  await page.fill('app-medicamento-modal ion-input[name="nuevaHora"] input', '08:00');
  await page.click('app-medicamento-modal ion-button:has-text("Agregar")');
  await page.waitForSelector('app-medicamento-modal ion-chip:has-text("08:00")');
  await page.fill('app-medicamento-modal ion-input[name="inventario"] input', '10');
  await page.click('app-medicamento-modal ion-button:has-text("Guardar")');
  await page.waitForSelector('ion-list.lista-medicamentos ion-item:has-text("Prueba Med")', { timeout: 20_000 });
  await page.waitForSelector('ion-list.agenda ion-item:has-text("Prueba Med") button[aria-label="Marcar tomada"]', { timeout: 20_000 });
  await page.click('ion-list.agenda ion-item:has-text("Prueba Med") button[aria-label="Marcar tomada"]');
  await page.waitForSelector('ion-list.agenda ion-item:has-text("Prueba Med"):has-text("Tomada")', { timeout: 20_000 });
  await page.waitForSelector('ion-list.lista-medicamentos ion-item:has-text("Prueba Med") ion-badge:has-text("9 rest.")', { timeout: 20_000 });
  ok('medicamento registrado, toma de las 08:00 marcada y el inventario bajó de 10 a 9');

  // La toma recién marcada aparece también en la bitácora, junto a los registros escritos.
  await page.click('ion-tab-button[tab="bitacora"]');
  await page.waitForSelector('app-bitacora ion-item.toma:has-text("Prueba Med"):has-text("Tomada")', { timeout: 20_000 });
  ok('la toma de Prueba Med se ve en la bitácora');

  await page.click('ion-tab-button[tab="equipo"]');
  await page.waitForSelector('text=Dr. Luis Pérez', { timeout: 15_000 });
  ok('pestaña Equipo con miembros (soy responsable)');

  // El QR permanente de la persona aparece solo (se genera la primera vez)
  await page.waitForSelector('ion-card.acceso .codigo.grande', { timeout: 30_000 });
  codigo = (await page.textContent('ion-card.acceso .codigo.grande')).trim();
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigo)) throw new Error(`Código inesperado: ${codigo}`);
  await page.waitForSelector('ion-card.acceso img.qr', { timeout: 15_000 });
  ok(`QR de acceso visible en Equipo con código ${codigo}`);
  await page.click('ion-card.acceso .qr-wrap');
  await page.waitForSelector('app-compartir-modal img.qr', { timeout: 15_000 });
  await page.click('app-compartir-modal button[aria-label="Cerrar"]');

  await page.click('ion-tab-button[tab="reporte"]');
  await page.waitForSelector('text=Reporte de cuidado', { timeout: 30_000 });
  await page.waitForSelector('app-reporte ion-item:has-text("Metformina")', { timeout: 20_000 });
  ok('reporte semanal generado (bitácora, signos y medicamentos)');

  const [descarga] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.click('ion-button:has-text("Exportar PDF para el médico")'),
  ]);
  const nombrePdf = descarga.suggestedFilename();
  if (!nombrePdf.endsWith('.pdf')) throw new Error(`Descarga inesperada: ${nombrePdf}`);
  ok(`PDF exportado: ${nombrePdf}`);

  // ---------------------------------------------------------------- asistente (IA)
  await page.click('ion-tab-button[tab="asistente"]');
  await page.waitForSelector('text=Pregúntame sobre Carmen', { timeout: 15_000 });
  await page.click('ion-chip:has-text("pastilla de la presión")');
  await page.waitForSelector('.burbuja.asistente:not(:has(ion-spinner))', { timeout: 90_000 });
  const respuesta = (await page.textContent('.burbuja.asistente:not(:has(ion-spinner)) .texto p')).trim();
  if (await page.$('.burbuja.asistente.error')) throw new Error(`El asistente respondió con error: ${respuesta}`);
  if (respuesta.length < 20) throw new Error(`Respuesta demasiado corta: ${respuesta}`);
  ok(`asistente respondió (${respuesta.length} caracteres): "${respuesta.slice(0, 90).replace(/\s+/g, ' ')}…"`);

  await cerrarSesion(page);

  // ---------------------------------------------------------------- médico: no da de alta
  await login(page, { email: 'luis@relevo.test', password: 'relevo123' });
  await page.waitForSelector('text=Carmen Hernández', { timeout: 20_000 });
  await page.waitForSelector('ion-badge:has-text("Médico")', { timeout: 10_000 });
  if (await page.$('button[aria-label="Nueva persona"]')) {
    throw new Error('Una cuenta de médico no debería poder dar de alta personas');
  }
  ok('cuenta de médico: ve la bitácora pero no tiene el botón de dar de alta');
  await cerrarSesion(page);

  // ---------------------------------------------------------------- usuario nuevo (familiar)
  await registrar(page, NUEVO);
  await page.waitForSelector('button[aria-label="Nueva persona"]', { timeout: 15_000 });
  ok(`usuario nuevo registrado como familiar (${NUEVO.email}); sí ve el botón de dar de alta`);

  await page.goto(`${BASE}/unirse/${codigo.replace('-', '')}`);
  await page.waitForSelector('text=Invitación válida', { timeout: 20_000 });
  await page.click('ion-button:has-text("Unirme")');
  await page.waitForURL(/\/personas\/persona-demo/, { timeout: 30_000 });
  await page.waitForSelector('text=Desayunó avena', { timeout: 20_000 });
  await page.waitForSelector('button[aria-label="Nuevo registro"]', { timeout: 15_000 });
  ok('se unió con el código como familiar y puede escribir en la bitácora');

  await cerrarSesion(page);

  // ---------------------------------------------------------------- limpieza (como Ana)
  await login(page, ANA);
  await page.goto(`${BASE}/personas/${PERSONA_ID}/bitacora`);
  await page.click(`ion-item:has-text("${TEXTO}")`);
  await page.click('ion-action-sheet button:has-text("Eliminar")');
  await page.click('ion-alert button:has-text("Eliminar")');
  await page.waitForSelector(`text=${TEXTO}`, { state: 'detached', timeout: 20_000 });
  ok('registro de prueba eliminado');

  await page.goto(`${BASE}/personas/${PERSONA_ID}/equipo`);
  await page.waitForSelector(`text=${NUEVO.nombre}`, { timeout: 20_000 });
  await page.click(`ion-item:has-text("${NUEVO.nombre}") button[aria-label="Opciones"]`);
  await page.click('ion-action-sheet button:has-text("Quitar del equipo")');
  await page.click('ion-alert button:has-text("Quitar")');
  await page.waitForSelector(`text=${NUEVO.nombre}`, { state: 'detached', timeout: 20_000 });
  ok('miembro de prueba quitado (el código de acceso permanente se conserva)');

  await page.goto(`${BASE}/personas/${PERSONA_ID}/medicamentos`);
  await page.click('ion-list.lista-medicamentos ion-item:has-text("Prueba Med")');
  await page.click('ion-action-sheet button:has-text("Eliminar")');
  await page.click('ion-alert button:has-text("Eliminar")');
  await page.waitForSelector('ion-list.lista-medicamentos ion-item:has-text("Prueba Med")', { state: 'detached', timeout: 20_000 });
  ok('medicamento de prueba eliminado');
} finally {
  await browser.close();
  if (erroresConsola.length) {
    console.log('\nErrores en consola del navegador:');
    for (const e of erroresConsola) console.log('  - ' + e.slice(0, 300));
  }
}

// Borra el usuario de prueba de Authentication (solo el propio usuario puede borrarse)
const src = readFileSync(new URL('../src/environments/firebase.config.ts', import.meta.url), 'utf8');
const cfg = Object.fromEntries([...src.matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
const app = initializeApp(cfg);
const auth = getAuth(app);
const cred = await signInWithEmailAndPassword(auth, NUEVO.email, NUEVO.password);
const perfilRef = doc(getFirestore(app), 'usuarios', cred.user.uid);
if ((await getDoc(perfilRef)).exists()) await deleteDoc(perfilRef);
await deleteUser(cred.user);
ok('usuario de prueba borrado de Authentication y de usuarios/');
console.log(`\nListo: ${paso} pasos correctos.`);
process.exit(0);
