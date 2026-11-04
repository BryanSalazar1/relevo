// Roles por persona cuidada (multipaciente), en el navegador contra los EMULADORES con la semilla.
// Requiere: npm run emulators, npm run semilla y npx ng serve --port 4300 (FORZAR_EMULADORES = true).
//   node tests/evidencias/multipaciente.mjs <carpeta de salida>
//
// Marta tiene cuenta de enfermera y es enfermera de Carmen; da de alta a su mamá y ahí es responsable.
// Invita al Dr. Luis (cuenta de médico, médico de Carmen) como familiar de su mamá: cada persona le
// muestra lo de su rol con ella. Después Marta le cambia el rol sin tocar su rol con Carmen.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'capturas-multipaciente';
const BASE = 'http://localhost:4300';
const PASS = 'relevo123';
mkdirSync(OUT, { recursive: true });
let fallos = 0;
const log = [];
const ok = (m) => { log.push(`✔ ${m}`); console.log('✔', m); };
const mal = (m) => { fallos++; log.push(`✘ ${m}`); console.log('✘', m); };
const espera = (c, m) => { if (!c) throw new Error(m); };
const limpio = (t) => t.replace(/\s+/g, ' ').trim();
async function paso(nombre, fn) {
  try { await fn(); ok(nombre); } catch (e) { mal(`${nombre}: ${String(e).split('\n').slice(0, 3).join(' ').slice(0, 300)}`); }
}

const b = await chromium.launch();
const errores = [];
async function sesion(email) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('ion-input[name="email"] input', email);
  await page.fill('ion-input[name="password"] input', PASS);
  await page.click('ion-button[type="submit"]');
  await page.waitForURL(/home/);
  await page.waitForSelector('app-home ion-card.persona', { timeout: 60000 });
  await page.waitForTimeout(2000);
  return { ctx, page };
}
const tarjeta = (page, nombre) => page.locator('app-home ion-card.persona', { hasText: nombre }).first();
const rolEnTarjeta = async (page, nombre) => limpio(await tarjeta(page, nombre).locator('ion-badge.rol').innerText());
const pestanas = async (page) => (await page.locator('ion-tab-button').allInnerTexts()).map(limpio).filter(Boolean);
const foto = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });

let mamaId = '';
let codigo = '';
try {
  const marta = await sesion('marta@relevo.test');
  const M = marta.page;

  await paso('Marta (cuenta de enfermera): con Carmen su rol es Enfermero/a', async () => {
    espera((await rolEnTarjeta(M, 'Carmen')) === 'Enfermero/a', `rol: ${await rolEnTarjeta(M, 'Carmen')}`);
  });

  await paso('Marta da de alta a su mamá (antes solo podía una cuenta de familiar)', async () => {
    await M.locator('app-home ion-fab ion-button', { hasText: 'Nueva persona' }).click();
    await M.waitForSelector('ion-modal ion-input[name="nombre"] input');
    await M.fill('ion-modal ion-input[name="nombre"] input', 'Rosa López');
    await M.waitForTimeout(400);
    await M.locator('ion-modal ion-header ion-button', { hasText: 'Crear' }).click();
    await M.waitForURL(/\/personas\/[^/]+/, { timeout: 30000 });
    mamaId = M.url().match(/\/personas\/([^/]+)/)[1];
    await M.waitForSelector('app-hoy', { timeout: 30000 });
    await M.waitForTimeout(2000);
  });

  await paso('Con su mamá es Responsable: ve Hoy y Plan, y puede agregar medicamentos', async () => {
    const tabs = await pestanas(M);
    espera(tabs.some((t) => /Hoy/.test(t)) && tabs.some((t) => /Plan/.test(t)), `pestañas: ${tabs}`);
    await M.goto(`${BASE}/personas/${mamaId}/plan`);
    await M.waitForSelector('app-plan', { timeout: 30000 });
    await M.waitForTimeout(1500);
    espera((await M.locator('app-plan ion-header ion-button:has(ion-icon[name="add"])').count()) > 0, 'no puede agregar en Plan');
  });

  await paso('En su mamá, Equipo la muestra como Responsable y le deja invitar por rol', async () => {
    await M.goto(`${BASE}/personas/${mamaId}/equipo`);
    await M.waitForSelector('app-equipo ion-card.acceso', { timeout: 30000 });
    const fila = limpio(await M.locator('app-equipo ion-item', { hasText: '(tú)' }).first().innerText());
    espera(/Responsable/.test(fila), `fila propia: ${fila}`);
    await M.locator('app-equipo ion-segment.rol-invitar ion-segment-button', { hasText: 'Familiar' }).click();
    await M.waitForSelector('app-equipo .codigo.grande', { timeout: 30000 });
    await M.waitForTimeout(1500);
    const texto = limpio(await M.locator('app-equipo ion-card.acceso').innerText());
    espera(/entra como familiar/i.test(texto), `texto: ${texto.slice(0, 200)}`);
    codigo = limpio(await M.locator('app-equipo .codigo.grande').innerText()).replace('-', '');
    await foto(M, 'm1_equipo_mama_invitar_familiar');
  });

  await paso('Inicio de Marta: dos personas, con rol distinto en cada una', async () => {
    await M.goto(`${BASE}/home`);
    await M.waitForSelector('app-home ion-card.persona:has-text("Rosa López")', { timeout: 30000 });
    await M.waitForTimeout(2000);
    espera((await rolEnTarjeta(M, 'Rosa López')) === 'Responsable', 'mamá no dice Responsable');
    espera((await rolEnTarjeta(M, 'Carmen')) === 'Enfermero/a', 'Carmen no dice Enfermero/a');
    await foto(M, 'm2_inicio_marta_dos_roles');
  });

  await paso('Con Carmen sigue siendo enfermera: no edita el plan ni comparte el código', async () => {
    await M.goto(`${BASE}/personas/persona-demo/plan`);
    await M.waitForSelector('app-plan', { timeout: 30000 });
    await M.waitForTimeout(2000);
    espera((await M.locator('app-plan ion-header ion-button:has(ion-icon[name="add"])').count()) === 0, 'la enfermera puede agregar al plan de Carmen');
    await M.goto(`${BASE}/personas/persona-demo/equipo`);
    await M.waitForSelector('app-equipo ion-item h2', { timeout: 30000 });
    await M.waitForTimeout(1500);
    espera((await M.locator('app-equipo ion-card.acceso').count()) === 0, 'la enfermera ve el QR de Carmen');
  });

  // Luis: cuenta de médico; médico de Carmen; se une a la mamá de Marta como familiar
  const luis = await sesion('luis@relevo.test');
  const L = luis.page;
  await paso('El Dr. Luis (cuenta de médico) abre la invitación: entra como Familiar', async () => {
    await L.goto(`${BASE}/unirse/${codigo}`);
    await L.waitForSelector('app-unirse ion-button:has-text("Unirme")', { timeout: 30000 });
    const t = limpio(await L.locator('app-unirse ion-card').innerText());
    espera(/Familiar/.test(t) && /Rosa López/.test(t), `unirse: ${t.slice(0, 200)}`);
    await foto(L, 'm3_luis_unirse_como_familiar');
    await L.click('app-unirse ion-button:has-text("Unirme")');
    await L.waitForURL(new RegExp(`/personas/${mamaId}`), { timeout: 30000 });
    await L.waitForTimeout(2500);
  });

  await paso('Con la mamá de Marta, Luis ve las pestañas de la familia (Hoy, Plan) y puede registrar', async () => {
    const tabs = await pestanas(L);
    espera(tabs.some((t) => /Hoy/.test(t)) && !tabs.some((t) => /Seguimiento/.test(t)), `pestañas: ${tabs}`);
    await L.goto(`${BASE}/personas/${mamaId}/bitacora`);
    await L.waitForSelector('app-bitacora', { timeout: 30000 });
    await L.waitForTimeout(2000);
    espera((await L.locator('app-bitacora').getByRole('button', { name: 'Nuevo registro' }).count()) === 1, 'no puede escribir en la bitácora');
  });

  await paso('Inicio de Luis: Carmen como Médico, la mamá de Marta como Familiar', async () => {
    await L.goto(`${BASE}/home`);
    await L.waitForSelector('app-home ion-card.persona:has-text("Rosa López")', { timeout: 30000 });
    await L.waitForTimeout(2000);
    espera((await rolEnTarjeta(L, 'Carmen')) === 'Médico', 'Carmen no dice Médico');
    espera((await rolEnTarjeta(L, 'Rosa López')) === 'Familiar', 'la mamá no dice Familiar');
    espera((await tarjeta(L, 'Carmen').locator('ion-button[title="Semáforo del día"]').count()) === 0, 'tiene semáforo con Carmen');
    espera((await tarjeta(L, 'Rosa López').locator('ion-button[title="Semáforo del día"]').count()) === 1, 'no tiene semáforo con la mamá');
    espera(limpio(await L.locator('app-home h1').innerText()) === 'Personas que cuidas', 'título');
    await foto(L, 'm4_inicio_luis_dos_roles');
  });

  await paso('Luis toca a Carmen: va a Seguimiento sin Hoy (su rol ahí es médico)', async () => {
    await tarjeta(L, 'Carmen').click();
    await L.waitForURL(/persona-demo\/seguimiento/, { timeout: 30000 });
    await L.waitForTimeout(2500);
    const tabs = await pestanas(L);
    espera(tabs.some((t) => /Seguimiento/.test(t)) && !tabs.some((t) => /Hoy/.test(t)), `pestañas: ${tabs}`);
  });

  await paso('Luis toca a la mamá de Marta: va a Hoy', async () => {
    await L.goto(`${BASE}/home`);
    await L.waitForSelector('app-home ion-card.persona:has-text("Rosa López")', { timeout: 30000 });
    await L.waitForTimeout(1500);
    await tarjeta(L, 'Rosa López').click();
    await L.waitForURL(new RegExp(`/personas/${mamaId}(/hoy)?$`), { timeout: 30000 });
    await L.waitForSelector('app-hoy', { timeout: 30000 });
  });

  await paso('Marta le cambia el rol a Luis con su mamá (Familiar → Enfermero/a); con Carmen no cambia', async () => {
    await M.goto(`${BASE}/personas/${mamaId}/equipo`);
    await M.waitForSelector('app-equipo ion-item:has-text("Luis")', { timeout: 30000 });
    await M.waitForTimeout(1500);
    await M.locator('app-equipo ion-item', { hasText: 'Luis' }).first().getByLabel('Opciones').click();
    await M.waitForSelector('ion-action-sheet button:has-text("Cambiar rol")');
    await M.waitForTimeout(500);
    await M.locator('ion-action-sheet button', { hasText: 'Cambiar rol' }).click();
    await M.waitForTimeout(900);
    const opciones = (await M.locator('ion-action-sheet button').allInnerTexts()).map(limpio);
    espera(!opciones.includes('Familiar') && opciones.includes('Responsable') && opciones.includes('Médico'), `opciones: ${opciones}`);
    await M.locator('ion-action-sheet button', { hasText: 'Enfermero/a' }).click();
    await M.waitForSelector('ion-alert button:has-text("Cambiar rol")');
    await M.waitForTimeout(400);
    await M.locator('ion-alert button', { hasText: 'Cambiar rol' }).click();
    await M.waitForTimeout(2500);
    const fila = limpio(await M.locator('app-equipo ion-item', { hasText: 'Luis' }).first().innerText());
    espera(/Enfermero\/a/.test(fila), `fila de Luis: ${fila}`);
    await foto(M, 'm5_equipo_mama_luis_enfermero');
    await L.goto(`${BASE}/home`);
    await L.waitForSelector('app-home ion-card.persona:has-text("Rosa López")', { timeout: 30000 });
    await L.waitForTimeout(2500);
    espera((await rolEnTarjeta(L, 'Rosa López')) === 'Enfermero/a', 'en el inicio de Luis no cambió');
    espera((await rolEnTarjeta(L, 'Carmen')) === 'Médico', 'cambió su rol con Carmen');
  });

  await paso('Ana (responsable de Carmen) también cambia roles a cualquier miembro: Marta a Familiar y de vuelta', async () => {
    const ana = await sesion('ana@relevo.test');
    const A = ana.page;
    await A.goto(`${BASE}/personas/persona-demo/equipo`);
    await A.waitForSelector('app-equipo ion-item:has-text("Marta")', { timeout: 30000 });
    await A.waitForTimeout(1500);
    const cambiar = async (a) => {
      await A.locator('app-equipo ion-item', { hasText: 'Marta' }).first().getByLabel('Opciones').click();
      await A.waitForSelector('ion-action-sheet button:has-text("Cambiar rol")');
      await A.waitForTimeout(500);
      await A.locator('ion-action-sheet button', { hasText: 'Cambiar rol' }).click();
      await A.waitForTimeout(900);
      await A.locator('ion-action-sheet button', { hasText: a }).click();
      await A.waitForSelector('ion-alert button:has-text("Cambiar rol")');
      await A.waitForTimeout(400);
      await A.locator('ion-alert button', { hasText: 'Cambiar rol' }).click();
      await A.waitForTimeout(2500);
      return limpio(await A.locator('app-equipo ion-item', { hasText: 'Marta' }).first().innerText());
    };
    espera(/Familiar/.test(await cambiar('Familiar')), 'no quedó Familiar');
    espera(/Enfermero\/a/.test(await cambiar('Enfermero/a')), 'no regresó a Enfermero/a');
    await ana.ctx.close();
  });

  await marta.ctx.close();
  await luis.ctx.close();
  const relevantes = errores.filter((e) => !/favicon|ERR_|net::/.test(e));
  if (relevantes.length) mal(`errores de consola: ${relevantes.join(' | ').slice(0, 300)}`);
  else ok('sin errores en la consola');
} catch (e) {
  mal(String(e).split('\n')[0]);
} finally {
  log.push(`FALLOS: ${fallos}`);
  writeFileSync(`${OUT}/registro.txt`, log.join('\n') + '\n');
  console.log('FALLOS:', fallos);
  await b.close();
}
