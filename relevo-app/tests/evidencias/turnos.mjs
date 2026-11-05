// Turnos de guardia, opción por opción, en el navegador contra los EMULADORES con la semilla.
// Requiere: npm run emulators, npm run semilla y npx ng serve --port 4300 (FORZAR_EMULADORES = true).
// Borra los turnos del equipo de la persona de demostración al empezar.
//   node tests/evidencias/turnos.mjs <carpeta de salida>
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2];
const BASE = process.env.RELEVO_BASE || 'http://localhost:4300';
const FS = `http://localhost:${process.env.FIRESTORE_PORT ?? 8080}/v1/projects/demo-relevo/databases/(default)/documents/personas_cuidadas/persona-demo/miembros`;
// Ids de cada miembro (cambian con cada semilla)
const UID = {};
for (const d of (await (await fetch(FS, { headers: { Authorization: 'Bearer owner' } })).json()).documents) {
  const nombre = d.fields.nombre.stringValue.split(' ')[0].normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();
  UID[nombre] = d.name.split('/').pop();
}
delete UID.dr;
let fallos = 0;
const log = [];
const ok = (m) => { log.push(`✔ ${m}`); console.log('✔', m); };
const mal = (m) => { fallos++; log.push(`✘ ${m}`); console.log('✘', m); };
const igual = (real, esperado, m) => (real === esperado ? ok(m) : mal(`${m}\n     esperado: ${JSON.stringify(esperado)}\n     real:     ${JSON.stringify(real)}`));
const verdad = (c, m) => (c ? ok(m) : mal(m));
const limpio = (t) => t.replace(/\s+/g, ' ').trim();

/** Turnos guardados en Firestore para un miembro: [{dias, desde, hasta}] */
async function turnosGuardados(uid) {
  const r = await (await fetch(`${FS}/${uid}`, { headers: { Authorization: 'Bearer owner' } })).json();
  const v = r.fields?.turnos?.arrayValue?.values ?? [];
  return v.map(({ mapValue: { fields: f } }) => ({
    dias: (f.dias.arrayValue.values ?? []).map((x) => Number(x.integerValue)),
    desde: f.desde.stringValue,
    hasta: f.hasta.stringValue,
  }));
}
async function borrarTurnos(uid) {
  await fetch(`${FS}/${uid}?updateMask.fieldPaths=turnos`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {} }),
  });
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 360, height: 800 } });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('console', (m) => m.type() === 'error' && errores.push(m.text()));

async function entrar(email) {
  await page.goto(`${BASE}/login`);
  await page.fill('ion-input[name="email"] input', email);
  await page.fill('ion-input[name="password"] input', 'relevo123');
  await page.click('ion-button[type="submit"]');
  await page.waitForURL(/home/);
  await page.locator('app-home ion-card', { hasText: 'Carmen' }).first().waitFor();
}
async function salir() {
  await ctx.clearCookies();
  await page.evaluate(() => indexedDB.databases().then((dbs) => dbs.forEach((d) => indexedDB.deleteDatabase(d.name))));
  await page.evaluate(() => localStorage.clear());
}
async function irAEquipo() {
  await page.goto(`${BASE}/personas/persona-demo/equipo`);
  await page.waitForSelector('app-equipo ion-item h2');
  await page.waitForTimeout(1200);
}
const textoMiembro = async (nombre) =>
  limpio(await page.locator('app-equipo ion-item', { hasText: nombre }).first().locator('p.turnos').innerText());
const coberturaEquipo = async () => limpio(await page.locator('app-equipo .cobertura').innerText());

const modal = () => page.locator('app-turnos-modal');
const tarjeta = (i) => modal().locator('ion-card.turno').nth(i);
async function abrir(nombre) {
  await page.locator('app-equipo ion-item', { hasText: nombre }).first().locator('ion-button', { hasText: 'Turnos' }).click();
  await modal().waitFor();
  await page.waitForTimeout(500);
}
const toque = (loc) => ({ click: async () => { await loc.click(); await page.waitForTimeout(250); }, getAttribute: (a) => loc.getAttribute(a) });
const dia = (i, nombre) => toque(tarjeta(i).locator(`button.dia[aria-label="${nombre}"]`));
const diasActivos = async (i) => tarjeta(i).locator('button.dia.activo').evaluateAll((bs) => bs.map((x) => x.textContent.trim()).join(''));
const todoElDia = async (i) => tarjeta(i).locator('ion-toggle').evaluate((t) => t.checked);
const hayHoras = async (i) => (await tarjeta(i).locator('ion-input').count()) > 0;
const resumen = async (i) => limpio(await tarjeta(i).locator('.resumen').innerText());
const cobertura = async () => limpio(await modal().locator('.cobertura').innerText());
const puedeGuardar = async () =>
  !(await modal().locator('ion-header ion-button', { hasText: 'Guardar' }).evaluate((x) => x.disabled));
const atajo = (i, texto) => toque(tarjeta(i).locator('button.atajo', { hasText: texto }));
async function hora(i, campo, valor) {
  const input = tarjeta(i).locator(`ion-input[label="${campo}"] input`);
  await input.fill(valor);
  await page.waitForTimeout(250);
}
async function alternarTodoElDia(i) {
  await tarjeta(i).locator('ion-toggle').click();
  await page.waitForTimeout(300);
}
async function guardar() {
  await modal().locator('ion-header ion-button', { hasText: 'Guardar' }).click();
  await modal().waitFor({ state: 'detached' });
  await page.waitForTimeout(1500);
}
async function cancelar() {
  await modal().locator('ion-header ion-button', { hasText: 'Cancelar' }).click();
  await modal().waitFor({ state: 'detached' });
  await page.waitForTimeout(800);
}

try {
  for (const uid of Object.values(UID)) await borrarTurnos(uid);

  // ------------------------------------------------------------ Responsable: Equipo sin turnos
  await entrar('ana@relevo.test');
  await irAEquipo();
  igual(await textoMiembro('Marta'), 'Sin turnos', 'Equipo: Marta sin turnos');
  igual(await coberturaEquipo(), 'Nadie tiene turnos: los recordatorios llegan a todos los que registran.', 'Equipo: aviso cuando nadie tiene turnos');
  verdad((await page.locator('app-equipo ion-item', { hasText: 'Dr. Luis' }).locator('ion-button', { hasText: 'Turnos' }).count()) === 0, 'El médico no tiene botón de turnos');
  await page.screenshot({ path: `${OUT}/01_equipo_sin_turnos.png`, fullPage: true });

  // ------------------------------------------------------------ 1. Atajo "Todos los días, las 24 h"
  await abrir('Marta');
  verdad(await modal().locator('ion-button', { hasText: 'Todos los días, las 24 h' }).isVisible(), 'Sin turnos: ofrece "Todos los días, las 24 h"');
  verdad(await modal().locator('ion-button', { hasText: 'Elegir días y horario' }).isVisible(), 'Sin turnos: ofrece "Elegir días y horario"');
  igual(await modal().locator('.otro').first().innerText().then(limpio), 'Ana García · Responsable Sin turnos', 'Lista las guardias del resto del equipo');
  await modal().locator('ion-button', { hasText: 'Todos los días, las 24 h' }).click(); await page.waitForTimeout(400);
  await page.waitForTimeout(400);
  igual(await diasActivos(0), 'LMXJVSD', '24 h: los 7 días marcados');
  verdad(await todoElDia(0), '24 h: "Todo el día" activado');
  verdad(!(await hayHoras(0)), '24 h: no pide horario');
  igual(await resumen(0), 'Todos los días · las 24 h', '24 h: resumen');
  igual(await cobertura(), 'Siempre hay alguien de guardia.', '24 h: la semana queda cubierta');
  verdad(await puedeGuardar(), '24 h: se puede guardar');
  await page.screenshot({ path: `${OUT}/02_todos_los_dias_24h.png` });
  await guardar();
  igual(JSON.stringify(await turnosGuardados(UID.marta)), JSON.stringify([{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }]), 'Firestore: 24 h se guarda como 00:00–00:00 con los 7 días');
  igual(await textoMiembro('Marta'), 'Todos los días, las 24 h', 'Equipo: texto de Marta');
  igual(await coberturaEquipo(), 'Siempre hay alguien de guardia.', 'Equipo: cobertura completa');

  // ------------------------------------------------------------ 2. Reabrir: se conserva; quitar un día; pasar a horario
  await abrir('Marta');
  verdad(await todoElDia(0), 'Al reabrir, "Todo el día" sigue activado');
  verdad(!(await hayHoras(0)), 'Al reabrir, sin horario');
  await dia(0, 'domingo').click();
  igual(await diasActivos(0), 'LMXJVS', 'Quitar el domingo');
  verdad(await todoElDia(0), 'Quitar un día no apaga "Todo el día"');
  igual(await resumen(0), 'L, M, X, J, V y S · las 24 h', 'Resumen sin domingo');
  igual(await cobertura(), 'Sin nadie de guardia: Domingo todo el día. En esas horas los recordatorios le llegan al responsable.', 'Cobertura: el domingo queda sin nadie');
  await alternarTodoElDia(0);
  verdad(!(await todoElDia(0)) && (await hayHoras(0)), 'Apagar "Todo el día" muestra el horario');
  igual(await tarjeta(0).locator('ion-input[label="Desde"] input').inputValue(), '08:00', 'Horario propuesto: desde 08:00');
  igual(await tarjeta(0).locator('ion-input[label="Hasta"] input').inputValue(), '16:00', 'Horario propuesto: hasta 16:00');
  igual(await resumen(0), 'L, M, X, J, V y S · 8 h', 'Resumen con horario y duración');

  // Nocturno
  await hora(0, 'Desde', '22:00');
  await hora(0, 'Hasta', '06:00');
  igual(await resumen(0), 'L, M, X, J, V y S · 8 h · termina al día siguiente', 'Nocturno: avisa que termina al día siguiente');
  verdad(await puedeGuardar(), 'Nocturno: se puede guardar');

  // Errores: misma hora, sin hora, sin días
  await hora(0, 'Hasta', '22:00');
  igual(await resumen(0), 'La hora de fin debe ser distinta; para 24 h activa «Todo el día».', 'Misma hora de inicio y fin: explica qué hacer');
  verdad(!(await puedeGuardar()), 'Misma hora: no deja guardar');
  await hora(0, 'Hasta', '');
  igual(await resumen(0), 'Escribe la hora de inicio y de fin.', 'Sin hora de fin: lo pide');
  verdad(!(await puedeGuardar()), 'Sin hora: no deja guardar');
  await hora(0, 'Hasta', '06:00');
  for (const d of ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']) await dia(0, d).click();
  igual(await diasActivos(0), '', 'Sin días marcados');
  igual(await resumen(0), 'Elige al menos un día.', 'Sin días: lo pide');
  verdad(!(await puedeGuardar()), 'Sin días: no deja guardar');

  // Cancelar no guarda nada
  await cancelar();
  igual(JSON.stringify(await turnosGuardados(UID.marta)), JSON.stringify([{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }]), 'Cancelar no cambia lo guardado');

  // ------------------------------------------------------------ 3. Atajos de días y "todos los días" automático
  await abrir('Sofía');
  await modal().locator('ion-button', { hasText: 'Elegir días y horario' }).click(); await page.waitForTimeout(400);
  await page.waitForTimeout(300);
  igual(await diasActivos(0), 'LMXJV', 'Nuevo turno: lunes a viernes');
  verdad((await atajo(0, 'Lunes a viernes').getAttribute('class')).includes('activo'), 'El atajo "Lunes a viernes" se ve activo');
  verdad(!(await todoElDia(0)) && (await hayHoras(0)), 'Nuevo turno: con horario');
  await atajo(0, 'Fin de semana').click();
  igual(await diasActivos(0), 'SD', 'Atajo "Fin de semana"');
  verdad(!(await todoElDia(0)), 'Fin de semana: conserva el horario');
  await atajo(0, 'Todos los días').click();
  igual(await diasActivos(0), 'LMXJVSD', 'Atajo "Todos los días"');
  verdad(await todoElDia(0) && !(await hayHoras(0)), 'Todos los días sin haber tocado las horas: ya no pide horario (24 h)');
  await atajo(0, 'Lunes a viernes').click();
  verdad(await todoElDia(0), 'Volver a lunes a viernes conserva las 24 h');
  await alternarTodoElDia(0);
  await dia(0, 'sábado').click();
  await dia(0, 'domingo').click();
  igual(await diasActivos(0), 'LMXJVSD', 'Marcar uno por uno los 7 días');
  verdad(!(await todoElDia(0)), 'Si ya eligió que no es todo el día, marcar los 7 días respeta su horario');
  await cancelar();

  await abrir('Sofía');
  await modal().locator('ion-button', { hasText: 'Elegir días y horario' }).click(); await page.waitForTimeout(400);
  await hora(0, 'Desde', '09:00');
  await hora(0, 'Hasta', '13:00');
  await atajo(0, 'Todos los días').click();
  verdad(!(await todoElDia(0)) && (await hayHoras(0)), 'Con horas ya escritas, "Todos los días" no las borra');
  igual(await resumen(0), 'Todos los días · 4 h', 'Todos los días de 09:00 a 13:00');
  await cancelar();

  await abrir('Sofía');
  await modal().locator('ion-button', { hasText: 'Elegir días y horario' }).click(); await page.waitForTimeout(400);
  await dia(0, 'sábado').click();
  await dia(0, 'domingo').click();
  verdad(await todoElDia(0) && !(await hayHoras(0)), 'Marcar a mano los días hasta tener los 7 (sin tocar horas) pasa a 24 h');
  await cancelar();

  // ------------------------------------------------------------ 4. Varios turnos: traslapes y quitar
  await abrir('Sofía');
  await modal().locator('ion-button', { hasText: 'Elegir días y horario' }).click(); await page.waitForTimeout(400);
  await hora(0, 'Desde', '16:00');
  await hora(0, 'Hasta', '22:00');
  await modal().locator('ion-button', { hasText: 'Agregar otro turno' }).click(); await page.waitForTimeout(400);
  await page.waitForTimeout(300);
  igual(await modal().locator('ion-card.turno').count(), 2, 'Agregar otro turno');
  await hora(1, 'Desde', '20:00');
  await hora(1, 'Hasta', '23:00');
  igual(limpio(await modal().locator('ion-note.bloque[color="danger"]').innerText()), 'Dos turnos se traslapan el lunes: ajusta las horas o los días.', 'Traslape: lo explica con el día');
  verdad(!(await puedeGuardar()), 'Traslape: no deja guardar');
  await atajo(1, 'Fin de semana').click();
  verdad((await modal().locator('ion-note.bloque[color="danger"]').count()) === 0, 'Cambiando los días ya no hay traslape');
  // Nocturno del viernes que invade el sábado
  await hora(1, 'Desde', '05:00');
  await hora(1, 'Hasta', '09:00');
  await atajo(0, 'Lunes a viernes').click();
  await hora(0, 'Desde', '22:00');
  await hora(0, 'Hasta', '06:00');
  igual(limpio(await modal().locator('ion-note.bloque[color="danger"]').innerText()), 'Dos turnos se traslapan el sábado: ajusta las horas o los días.', 'El nocturno del viernes choca con el sábado 05:00–09:00');
  await tarjeta(1).locator('ion-button', { hasText: 'Quitar' }).click(); await page.waitForTimeout(400);
  await page.waitForTimeout(300);
  igual(await modal().locator('ion-card.turno').count(), 1, 'Quitar un turno');
  verdad(await puedeGuardar(), 'Sin el turno que chocaba, se puede guardar');
  await hora(0, 'Desde', '16:00');
  await hora(0, 'Hasta', '22:00');
  await modal().locator('ion-button', { hasText: 'Agregar otro turno' }).click(); await page.waitForTimeout(400);
  await atajo(1, 'Fin de semana').click();
  await hora(1, 'Desde', '09:00');
  await hora(1, 'Hasta', '13:00');
  verdad(await puedeGuardar(), 'Dos turnos sin traslape: se puede guardar');
  igual(await modal().locator('.otro', { hasText: 'Marta' }).innerText().then(limpio), 'Marta López · Enfermero/a Todos los días, las 24 h', 'Ve las guardias de Marta');
  await page.screenshot({ path: `${OUT}/03_dos_turnos.png`, fullPage: true });
  await guardar();
  igual(JSON.stringify(await turnosGuardados(UID.sofia)), JSON.stringify([
    { dias: [1, 2, 3, 4, 5], desde: '16:00', hasta: '22:00' },
    { dias: [0, 6], desde: '09:00', hasta: '13:00' },
  ]), 'Firestore: dos turnos de Sofía, días ordenados');
  igual(await textoMiembro('Sofía'), 'L, M, X, J y V 16:00–22:00 · S y D 09:00–13:00', 'Equipo: texto de Sofía');

  // ------------------------------------------------------------ 5. Cobertura con huecos (Marta solo entre semana de día)
  await abrir('Marta');
  await atajo(0, 'Lunes a viernes').click();
  await alternarTodoElDia(0);
  await hora(0, 'Desde', '08:00');
  await hora(0, 'Hasta', '16:00');
  igual(await cobertura(), 'Sin nadie de guardia: L, M, X, J y V 00:00–08:00 y 22:00–24:00 · S y D 00:00–09:00 y 13:00–24:00. En esas horas los recordatorios le llegan al responsable.', 'Cobertura en vivo con lo que se edita y los turnos de Sofía');
  await guardar();
  igual(await coberturaEquipo(), 'Sin nadie de guardia: L, M, X, J y V 00:00–08:00 y 22:00–24:00 · S y D 00:00–09:00 y 13:00–24:00. En esas horas los recordatorios le llegan al responsable.', 'Equipo: muestra las horas sin nadie de guardia');
  await page.screenshot({ path: `${OUT}/04_equipo_cobertura.png`, fullPage: true });

  // Pedro cubre las noches entre semana
  await abrir('Pedro');
  await modal().locator('ion-button', { hasText: 'Elegir días y horario' }).click(); await page.waitForTimeout(400);
  await hora(0, 'Desde', '22:00');
  await hora(0, 'Hasta', '08:00');
  await guardar();
  igual(await coberturaEquipo(), 'Sin nadie de guardia: Lunes 00:00–08:00 · Sábado 08:00–09:00 y 13:00–24:00 · Domingo 00:00–09:00 y 13:00–24:00. En esas horas los recordatorios le llegan al responsable.', 'Equipo: la noche de Pedro cubre la madrugada siguiente');

  // Quitar todos los turnos de Pedro
  await abrir('Pedro');
  await tarjeta(0).locator('ion-button', { hasText: 'Quitar' }).click(); await page.waitForTimeout(400);
  verdad(await modal().locator('ion-button', { hasText: 'Todos los días, las 24 h' }).isVisible(), 'Sin turnos de nuevo: vuelven las dos opciones');
  await guardar();
  igual(JSON.stringify(await turnosGuardados(UID.pedro)), '[]', 'Firestore: Pedro sin turnos');
  igual(await textoMiembro('Pedro'), 'Sin turnos', 'Equipo: Pedro sin turnos');

  // Marta otra vez todos los días 24 h para lo que sigue
  await abrir('Marta');
  await atajo(0, 'Todos los días').click();
  await alternarTodoElDia(0);
  verdad(await todoElDia(0), 'Volver a activar "Todo el día" a mano');
  await guardar();

  // ------------------------------------------------------------ 6. Marta (enfermera): no edita turnos; Notificaciones y Hoy
  await salir();
  await entrar('marta@relevo.test');
  await irAEquipo();
  verdad((await page.locator('app-equipo ion-button', { hasText: 'Turnos' }).count()) === 0, 'Quien no es responsable no ve el botón de turnos');
  igual(await textoMiembro('Marta'), 'Todos los días, las 24 h', 'Marta ve sus turnos en Equipo');
  await page.goto(`${BASE}/notificaciones`);
  await page.waitForSelector('app-notificaciones');
  await page.waitForTimeout(1500);
  await page.locator('app-notificaciones ion-card', { hasText: 'Carmen' }).locator('ion-button', { hasText: /Avanzado/i }).first().click();
  await page.waitForTimeout(600);
  const notif = limpio(await page.locator('app-notificaciones').innerText());
  verdad(!(await page.locator('app-notificaciones ion-toggle', { hasText: 'Solo durante mis turnos' }).evaluate((t) => t.disabled)), 'Notificaciones: con turnos se puede activar "Solo durante mis turnos"');
  verdad(notif.includes('Todos los días, las 24 h'), 'Notificaciones: muestra sus turnos');
  await page.goto(`${BASE}/personas/persona-demo/hoy`);
  await page.waitForSelector('app-hoy');
  await page.waitForTimeout(2500);
  const hoy = limpio(await page.locator('app-hoy').innerText());
  const entrega = hoy.match(/Desde tu último turno[^·]*?(desde [^·]+?\d{1,2}:\d{2})/i)?.[1] ?? hoy.match(/(desde (hoy|ayer|el) [^ ]+( [^ ]+)?)/)?.[1];
  log.push(`   Hoy (Marta 24 h): ${entrega}`);
  verdad(!/desde hoy 00:00/.test(hoy), 'Hoy: con guardia de 24 h la entrega no empieza a la medianoche');
  await page.screenshot({ path: `${OUT}/05_hoy_marta.png` });

  verdad(errores.filter((e) => !/favicon|ERR_|net::/.test(e)).length === 0, `Sin errores en la consola${errores.length ? ': ' + errores.join(' | ').slice(0, 300) : ''}`);
} catch (e) {
  mal(String(e).split('\n').slice(0, 4).join(' '));
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  log.push(`FALLOS: ${fallos}`);
  writeFileSync(`${OUT}/registro.txt`, log.join('\n') + '\n');
  console.log('FALLOS:', fallos);
  await b.close();
}
