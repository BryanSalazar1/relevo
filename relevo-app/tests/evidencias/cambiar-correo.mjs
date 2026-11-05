// Cambiar el correo desde la verificación, en el navegador contra los EMULADORES (nunca producción).
//   FIRESTORE_PORT=8085 RELEVO_BASE=http://localhost:4300 node tests/evidencias/cambiar-correo.mjs <salida>
// Una cuenta registrada con un correo (p. ej. con "+") lo cambia por otro: el código llega al correo
// NUEVO y, al escribirlo, la cuenta queda con ese correo, verificada, y entra con él.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { codigoDeCorreo } from './emulador.mjs';

const OUT = process.argv[2] || 'capturas-cambiar-correo';
const BASE = process.env.RELEVO_BASE || 'http://localhost:4300';
const PASS = 'relevo123';
mkdirSync(OUT, { recursive: true });
let fallos = 0;
const log = [];
const ok = (m) => { log.push(`✔ ${m}`); console.log('✔', m); };
const mal = (m) => { fallos++; log.push(`✘ ${m}`); console.log('✘', m); };
const espera = (c, m) => { if (!c) throw new Error(m); };
async function paso(nombre, fn) {
  try { await fn(); ok(nombre); } catch (e) { mal(`${nombre}: ${String(e).split('\n').slice(0, 3).join(' ').slice(0, 300)}`); }
}

const sello = Date.now();
const viejo = `relevo740+prueba${sello}@relevo.test`;
const nuevo = `relevo740prueba${sello}@relevo.test`;
const b = await chromium.launch();
const errores = [];
try {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(e.message));

  await paso('registro con el correo con "+": pide el código a ese correo', async () => {
    await page.goto(`${BASE}/login`);
    await page.click('text=¿No tienes cuenta? Regístrate');
    await page.fill('ion-input[name="nombre"] input', 'Rosa Prueba');
    await page.fill('ion-input[name="email"] input', viejo);
    await page.fill('ion-input[name="password"] input', PASS);
    await page.locator('ion-checkbox[name="privacidad"]').click();
    await page.click('ion-button[type="submit"]');
    await page.waitForURL(/\/verificar-correo/, { timeout: 40000 });
    await page.waitForSelector(`text=${viejo}`, { timeout: 30000 });
  });

  await paso('"Cambiar mi correo": el código llega al correo NUEVO', async () => {
    await page.click('[data-prueba="cambiar-correo"]');
    await page.fill('ion-alert input', nuevo);
    await page.click('ion-alert button:has-text("Enviar código")');
    await page.waitForSelector(`text=${nuevo}`, { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/c01_codigo_al_correo_nuevo.png` });
  });

  await paso('al escribir el código, la cuenta queda con el correo nuevo y entra con él', async () => {
    const codigo = await codigoDeCorreo(nuevo);
    await page.fill('ion-input[name="codigo"] input', codigo);
    await page.click('ion-button[type="submit"]');
    // Firebase cierra la sesión al cambiar el correo: la entrada ya trae el correo nuevo
    await page.waitForURL(/\/login\?correo=/, { timeout: 40000 });
    await page.waitForTimeout(1500);
    espera((await page.locator('ion-input[name="email"] input').inputValue()) === nuevo, 'no trae el correo nuevo');
    await page.screenshot({ path: `${OUT}/c02_entrar_con_el_correo_nuevo.png` });
    await page.fill('ion-input[name="password"] input', PASS);
    await page.click('ion-button[type="submit"]');
    await page.waitForURL(/\/home/, { timeout: 40000 });
  });

  await paso('cerrar sesión y entrar con el correo nuevo (el viejo ya no sirve)', async () => {
    await page.goto(`${BASE}/login`).catch(() => {});
    const ctx2 = await b.newContext({ viewport: { width: 412, height: 915 } });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/login`);
    await p2.fill('ion-input[name="email"] input', viejo);
    await p2.fill('ion-input[name="password"] input', PASS);
    await p2.click('ion-button[type="submit"]');
    await p2.waitForSelector('ion-toast', { timeout: 20000 });
    espera(/\/login/.test(p2.url()), 'entró con el correo viejo');
    await p2.goto(`${BASE}/login`);
    await p2.fill('ion-input[name="email"] input', nuevo);
    await p2.fill('ion-input[name="password"] input', PASS);
    await p2.click('ion-button[type="submit"]');
    await p2.waitForURL(/\/home/, { timeout: 40000 });
    await ctx2.close();
  });
  await ctx.close();
} finally {
  log.push(`errores de consola: ${errores.length ? errores.join(' | ') : 'ninguno'}`, `FALLOS: ${fallos}`);
  console.log('FALLOS:', fallos);
  writeFileSync(`${OUT}/registro.txt`, log.join('\n') + '\n');
  await b.close();
}
