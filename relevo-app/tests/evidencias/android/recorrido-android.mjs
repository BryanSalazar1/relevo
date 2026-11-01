// Recorrido de Relevo en el emulador de Android 15 (APK de prueba contra los emuladores de Firebase).
// Toques reales con adb (se ven en el video); la página se lee por el depurador del WebView.
// Requisitos y pasos en README.md de esta carpeta.
//   node tests/evidencias/android/recorrido-android.mjs <carpeta de salida>
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { _android as android } from 'playwright';

const ADB = `${process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT}/platform-tools/adb${process.platform === 'win32' ? '.exe' : ''}`;
const OUT = process.argv[2];
const PAQUETE = 'com.relevo.app';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const adbBin = (...a) => execFileSync(ADB, a, { maxBuffer: 64 * 1024 * 1024 });
let fallos = 0;
const log = [];
const ok = (m) => { log.push(`  ✔ ${m}`); console.log('  ✔', m); };
const mal = (m) => { fallos += 1; log.push(`  ✘ ${m}`); console.log('  ✘', m); };
const nota = (m) => { log.push(`      ${m}`); console.log('     ', m); };
const espera = (c, m) => { if (!c) throw new Error(m); };

function captura(nombre) {
  writeFileSync(`${OUT}/${nombre}.png`, adbBin('exec-out', 'screencap', '-p'));
}

let grabando = null;
function grabar(nombre) {
  try { adb('shell', 'rm', '-f', `/sdcard/${nombre}.mp4`); } catch {}
  grabando = { nombre, p: spawn(ADB, ['shell', 'screenrecord', '--bit-rate', '4000000', `/sdcard/${nombre}.mp4`]) };
}
async function parar() {
  if (!grabando) return;
  try { adb('shell', 'pkill', '-INT', 'screenrecord'); } catch {}
  await esperar(2500);
  adb('pull', `/sdcard/${grabando.nombre}.mp4`, `${OUT}/${grabando.nombre}.mp4`);
  grabando = null;
}

/**
 * Posición del WebView en la pantalla (px físicos), para convertir coordenadas CSS a toques: debajo
 * de la barra de estado y encima de la de navegación (medidas con `dumpsys window` en este Pixel 6).
 */
async function limitesWebView() {
  const out = adb('shell', 'dumpsys', 'window');
  const barra = (tipo) => out.match(new RegExp(String.raw`type=${tipo} frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]`));
  const est = barra('statusBars');
  const nav = barra('navigationBars');
  const y = est ? +est[4] : 0;
  return { x: 0, y, ancho: 1080, alto: (nav ? +nav[2] : 2400) - y };
}

let page;
let wv;
let dispositivo;
/** Se conecta a la página de la app dentro del WebView (API de Android de Playwright). */
async function conectar() {
  if (!dispositivo) [dispositivo] = await android.devices();
  // Al arrancar, la app puede reemplazar su primera vista: se reintenta hasta tener la app cargada
  for (let intento = 1; ; intento++) {
    try {
      const w = await dispositivo.webView({ pkg: PAQUETE }, { timeout: 60000 });
      page = await w.page();
      await page.waitForSelector('ion-app ion-router-outlet', { timeout: 30000 });
      await esperar(2000);
      if (page.isClosed()) throw new Error('vista cerrada');
      break;
    } catch (e) {
      if (intento >= 8) throw e;
      await esperar(2500);
    }
  }
  wv = await limitesWebView();
}

/** Toque real (adb input tap) en el centro del elemento. */
async function tocar(selector, opciones = {}) {
  const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
  await loc.waitFor({ state: 'visible', timeout: opciones.timeout ?? 30000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await esperar(300);
  const b = await loc.boundingBox();
  const vw = await page.evaluate(() => window.innerWidth);
  const k = wv.ancho / vw;
  const x = Math.round(wv.x + (b.x + b.width / 2) * k);
  const y = Math.round(wv.y + (b.y + b.height / 2) * k);
  adb('shell', 'input', 'tap', String(x), String(y));
  await esperar(opciones.despues ?? 900);
}

/** Toca el campo (toque real) y escribe el texto en él. */
async function escribir(selector, texto) {
  await tocar(selector);
  await page.locator(selector).first().pressSequentially(texto, { delay: 40 });
  await esperar(400);
}

/** Cierra el teclado de Android si está abierto (con Atrás; si no está abierto no hace nada). */
async function ocultarTeclado() {
  const ime = adb('shell', 'dumpsys', 'input_method');
  if (/mInputShown=true|isInputViewShown=true/.test(ime)) {
    adb('shell', 'input', 'keyevent', '4');
    await esperar(1200);
  }
}

async function entrar(email) {
  await page.waitForSelector('ion-input[name="email"] input', { timeout: 60000 });
  await escribir('ion-input[name="email"] input', email);
  await escribir('ion-input[name="password"] input', 'relevo123');
  await ocultarTeclado();
  await tocar('ion-button[type="submit"]');
  await page.waitForURL(/\/home/, { timeout: 60000 });
  await page.waitForSelector('app-home ion-card', { timeout: 60000 });
  await esperar(2500);
}

async function salir() {
  await page.goto(page.url().replace(/\/(personas|home).*$/, '/home'));
  await page.waitForSelector('app-home .boton-avatar', { timeout: 30000 });
  await esperar(1000);
  await tocar('app-home .boton-avatar');
  await tocar(page.locator('ion-action-sheet button', { hasText: 'Cerrar sesión' }));
  await page.waitForURL(/\/login/, { timeout: 30000 }).catch(() => {});
  await esperar(1500);
}

async function paso(nombre, fn) {
  try { await fn(); ok(nombre); } catch (e) { mal(`${nombre}: ${String(e).split('\n').slice(0, 3).join(' ').slice(0, 400)}`); }
}

try {
  const version = adb('shell', 'getprop', 'ro.build.version.release').trim();
  const modelo = adb('shell', 'getprop', 'ro.product.model').trim();
  const apk = adb('shell', 'dumpsys', 'package', PAQUETE).match(/versionName=([^\s]+)/)?.[1];
  nota(`Android ${version} · ${modelo} · ${PAQUETE} ${apk}`);

  // App como recién instalada: sin datos ni sesión
  adb('shell', 'am', 'force-stop', PAQUETE);
  adb('shell', 'pm', 'clear', PAQUETE);
  adb('shell', 'pm', 'grant', PAQUETE, 'android.permission.CAMERA');
  adb('shell', 'pm', 'grant', PAQUETE, 'android.permission.POST_NOTIFICATIONS');
  adb('shell', 'input', 'keyevent', '3'); // inicio del teléfono
  await esperar(1500);

  // ---------------------------------------------------------------- Ana (responsable)
  grabar('01_ana_responsable');
  adb('shell', 'monkey', '-p', PAQUETE, '-c', 'android.intent.category.LAUNCHER', '1');
  await conectar();
  await paso('La app instalada abre en Android y Ana (responsable) inicia sesión', async () => {
    await entrar('ana@relevo.test');
    espera((await page.locator('app-home').innerText()).includes('Carmen Hernández'), 'no ve a Carmen');
    captura('a1_inicio_ana');
  });
  await paso('Hoy: tomas y rutina del día con botones para marcar', async () => {
    await tocar(page.locator('app-home ion-card', { hasText: 'Carmen Hernández' }).first());
    await page.waitForSelector('app-hoy ion-card.estado', { timeout: 30000 });
    await esperar(1500);
    captura('a2_hoy');
  });
  await paso('Reporte: la hoja para la consulta se exporta en PDF y se abre el menú de compartir de Android', async () => {
    await tocar(page.locator('ion-tab-button', { hasText: 'Reporte' }));
    await page.waitForSelector('app-reporte ion-card.hoja', { timeout: 30000 });
    await esperar(1500);
    const antes = adb('shell', 'run-as', PAQUETE, 'ls', 'cache').split(/\s+/).filter((f) => f.endsWith('.pdf'));
    await tocar(page.locator('app-reporte ion-header').getByRole('button', { name: 'Exportar hoja para la consulta' }), { despues: 4000 });
    captura('a3_compartir_pdf');
    const pdfs = adb('shell', 'run-as', PAQUETE, 'ls', '-l', 'cache').split('\n').filter((l) => l.includes('.pdf'));
    const nuevo = pdfs.map((l) => l.trim().split(/\s+/).pop()).find((f) => !antes.includes(f)) ?? pdfs[0]?.trim().split(/\s+/).pop();
    espera(nuevo, 'no se generó el PDF');
    const bytes = adbBin('exec-out', 'run-as', PAQUETE, 'cat', `cache/${nuevo}`);
    espera(bytes.subarray(0, 5).toString() === '%PDF-', 'el archivo no es un PDF');
    writeFileSync(`${OUT}/hoja_generada_en_android.pdf`, bytes);
    nota(`PDF en el teléfono: cache/${nuevo} (${bytes.length} bytes)`);
    adb('shell', 'input', 'keyevent', '4'); // cerrar el menú de compartir sin elegir app
    await esperar(2500);
    const aviso = await page.locator('ion-toast').allInnerTexts().catch(() => []);
    espera(!aviso.join(' ').includes('No se pudo'), `aviso de error al cerrar el menú: ${aviso}`);
  });
  await paso('Equipo: la invitación con su QR (código, vencimiento y usos)', async () => {
    await tocar(page.locator('ion-tab-button', { hasText: 'Equipo' }));
    await page.waitForSelector('app-equipo', { timeout: 30000 });
    await esperar(1500);
    await tocar('app-equipo button.qr-wrap');
    await page.waitForSelector('app-compartir-modal img.qr', { timeout: 15000 });
    await esperar(1500);
    captura('a4_invitacion_qr');
    await tocar(page.locator('app-compartir-modal ion-header').getByRole('button', { name: 'Cerrar' }));
  });
  await parar();

  // ---------------------------------------------------------------- Pedro: escanea el QR con la cámara
  await paso('Cerrar sesión (borra la copia local)', async () => {
    await salir();
    await conectar();
  });
  grabar('02_pedro_escanea_qr');
  await paso('Pedro (familiar nuevo) escanea el QR con la cámara del teléfono y se une al equipo', async () => {
    await entrar('pedro@relevo.test');
    await tocar(page.locator('app-home ion-button', { hasText: /código o QR/ }).first());
    await page.waitForSelector('app-unirse', { timeout: 30000 });
    await esperar(1000);
    await tocar(page.locator('app-unirse ion-button', { hasText: 'Escanear código QR' }), { despues: 4000 });
    captura('p1_camara');
    await page.waitForSelector('app-unirse ion-button:has-text("Unirme")', { timeout: 60000 });
    await esperar(1500);
    const t = (await page.locator('app-unirse').innerText()).replace(/\s+/g, ' ');
    espera(t.includes('Carmen Hernández'), `no encontró la invitación: ${t.slice(0, 200)}`);
    captura('p2_qr_leido');
    await tocar(page.locator('app-unirse ion-button', { hasText: 'Unirme' }), { despues: 4000 });
    await page.waitForURL(/\/personas\/|\/home/, { timeout: 30000 });
    await esperar(2500);
    captura('p3_unido');
  });
  await parar();

  // ---------------------------------------------------------------- Dr. Luis (médico)
  await paso('Cerrar sesión de Pedro', async () => {
    await salir();
    await conectar();
  });
  grabar('03_medico');
  await paso('Dr. Luis (médico): entra a Seguimiento; no tiene Hoy ni semáforo para registrar tomas', async () => {
    await entrar('luis@relevo.test');
    espera((await page.locator('ion-button[title="Semáforo del día"]').count()) === 0, 'el médico ve el semáforo');
    captura('l1_inicio_medico');
    await tocar(page.locator('app-home ion-card', { hasText: 'Carmen Hernández' }).first());
    await page.waitForURL(/seguimiento/, { timeout: 30000 });
    await esperar(2500);
    const tabs = await page.locator('ion-tab-button').allInnerTexts();
    nota(`pestañas del médico: ${tabs.map((x) => x.trim()).join(' · ')}`);
    espera(!tabs.some((x) => /Hoy/.test(x)), 'el médico tiene Hoy');
    await page.waitForSelector('app-seguimiento ion-card', { timeout: 60000 });
    await esperar(4000);
    captura('l2_seguimiento');
  });
  await parar();
} catch (e) {
  mal(String(e).split('\n')[0]);
  await parar().catch(() => {});
} finally {
  log.push(`FALLOS: ${fallos}`);
  writeFileSync(`${OUT}/registro.txt`, log.join('\n') + '\n');
  console.log('FALLOS:', fallos);
  process.exit(0);
}
