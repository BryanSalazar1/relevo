// Pruebas de la lógica pura de notificaciones. Ejecutar con:  npm test  (dentro de functions/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoInventario,
  AVISO_CITAS_MIN,
  citasProximas,
  correoHtml,
  cuandoCita,
  deGuardia,
  destinatariosCita,
  mensajeCita,
  textoFaltan,
  destinatarios,
  destinatariosAlertas,
  destinatariosInventario,
  enTurno,
  entradaImportante,
  modoAvisos,
  quiereAviso,
  dosisVencidas,
  elementosAgenda,
  estadoInventario,
  mensajeInventario,
  mensajeProximo,
  proximos,
  INSTRUCCIONES_RESUMEN,
  historialGemini,
  horarioDe,
  idTomaDe,
  mensajeEntrada,
  mensajeRecordatorio,
  mensajeTarea,
  mensajeToma,
  partesEnZona,
  recortar,
  sumarDiasIso,
  tareaEnDia,
  tokensInvalidos,
  vigenteEnFecha,
} from './logica.js';

const ZONA = 'America/Mexico_City';

test('mensajeEntrada: título con el tipo y cuerpo con autor y texto', () => {
  const m = mensajeEntrada({
    personaNombre: 'Lupe',
    entrada: {
      tipo: 'incidente',
      autorNombre: 'Ana',
      texto: 'Se cayó en el baño',
    },
  });
  assert.equal(m.titulo, '⚠️ Lupe: incidente en la bitácora');
  assert.equal(m.cuerpo, 'Ana: Se cayó en el baño');
});

test('mensajeEntrada: tipo desconocido no rompe y el texto largo se recorta', () => {
  const m = mensajeEntrada({
    personaNombre: 'Lupe',
    entrada: { tipo: 'otro', autorNombre: '', texto: 'x'.repeat(500) },
  });
  assert.equal(m.titulo, 'Lupe: registro en la bitácora');
  assert.ok(m.cuerpo.startsWith('Alguien: '));
  assert.ok(m.cuerpo.length <= 190);
  assert.ok(m.cuerpo.endsWith('…'));
});

test('recortar: colapsa espacios y respeta el máximo', () => {
  assert.equal(recortar('  hola \n  mundo  '), 'hola mundo');
  assert.equal(recortar('abcdef', 4), 'abc…');
});

test('mensajeToma: distingue tomada de no tomada e incluye quién registró', () => {
  const base = {
    personaNombre: 'Lupe',
    medicamento: { nombre: 'Paracetamol', dosis: '500 mg' },
    horario: '08:00',
  };
  const no = mensajeToma({
    ...base,
    toma: { tomado: false, registradoNombre: 'Ana' },
  });
  assert.equal(no.titulo, 'Lupe: toma no realizada');
  assert.equal(no.cuerpo, 'Paracetamol 500 mg de las 08:00 · registró Ana');
  const si = mensajeToma({ ...base, toma: { tomado: true } });
  assert.equal(si.titulo, 'Lupe: toma realizada');
  assert.equal(si.cuerpo, 'Paracetamol 500 mg de las 08:00');
});

test('mensajeToma: según necesidad', () => {
  const m = mensajeToma({
    personaNombre: 'Lupe',
    medicamento: { nombre: 'Paracetamol', dosis: '500 mg' },
    horario: '16:40',
    toma: { tomado: true, aDemanda: true, registradoNombre: 'Ana', nota: 'dolor de cabeza' },
  });
  assert.equal(m.titulo, 'Lupe: medicamento según necesidad');
  assert.equal(m.cuerpo, 'Paracetamol 500 mg a las 16:40 · registró Ana · dolor de cabeza');
});

test('mensajeRecordatorio', () => {
  const m = mensajeRecordatorio({
    personaNombre: 'Lupe',
    medicamento: { nombre: 'Metformina', dosis: '850 mg' },
    horario: '20:00',
  });
  assert.equal(m.titulo, 'Lupe: hora del medicamento');
  assert.equal(m.cuerpo, 'Metformina 850 mg de las 20:00 sigue sin registrarse.');
});

test('destinatarios: excluye al autor y filtra por rol', () => {
  const miembros = [
    { uid: 'a', rol: 'cuidador_principal' },
    { uid: 'b', rol: 'cuidador_turno' },
    { uid: 'c', rol: 'medico' },
    { uid: 'd', rol: 'familiar' },
  ];
  assert.deepEqual(destinatarios(miembros, { excluir: 'b' }), ['a', 'c', 'd']);
  assert.deepEqual(
    destinatarios(miembros, {
      roles: ['cuidador_principal', 'cuidador_turno', 'familiar'],
    }),
    ['a', 'b', 'd'],
  );
  assert.deepEqual(destinatarios([], {}), []);
});

test('partesEnZona y horarioDe: convierten UTC a la zona de México', () => {
  // 2026-09-15 14:05 UTC = 08:05 en Ciudad de México (UTC-6, sin horario de verano desde 2022)
  const f = new Date('2026-09-15T14:05:00Z');
  const p = partesEnZona(f, ZONA);
  assert.deepEqual(
    { y: p.y, m: p.m, d: p.d, hora: p.hora, minuto: p.minuto },
    { y: '2026', m: '09', d: '15', hora: 8, minuto: 5 },
  );
  assert.equal(p.minutosDelDia, 8 * 60 + 5);
  assert.equal(horarioDe(f, ZONA), '08:05');
  // Medianoche no debe salir como "24"
  assert.equal(horarioDe(new Date('2026-09-15T06:00:00Z'), ZONA), '00:00');
});

test('idTomaDe: mismo formato que la app (yyyyMMdd-HHmm)', () => {
  const p = partesEnZona(new Date('2026-09-15T14:05:00Z'), ZONA);
  assert.equal(idTomaDe(p, '08:00'), '20260915-0800');
  assert.equal(idTomaDe(p, '8:5'), '20260915-0805');
});

test('dosisVencidas: solo horarios ya pasados dentro de la ventana, de medicamentos activos', () => {
  const ahora = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA); // 08:30 CDMX
  const meds = [
    { id: 'm1', nombre: 'Paracetamol', horarios: ['08:00', '14:00', '20:00'] },
    { id: 'm2', nombre: 'Suspendido', activo: false, horarios: ['08:00'] },
    { id: 'm3', nombre: 'Antigua', horarios: ['06:00'] }, // hace 150 min: fuera de la ventana
    { id: 'm4', nombre: 'Justo ahora', horarios: ['08:30'] },
    { nombre: 'Sin id', horarios: ['08:00'] },
  ];
  const v = dosisVencidas(meds, ahora);
  assert.deepEqual(
    v.map((d) => [d.medicamento.id, d.horario, d.idToma, d.minutosDesde]),
    [
      ['m1', '08:00', '20260915-0800', 30],
      ['m4', '08:30', '20260915-0830', 0],
    ],
  );
});

test('tokensInvalidos: solo los que FCM marca como no registrados', () => {
  const tokens = ['t1', 't2', 't3'];
  const respuestas = [
    { success: true },
    {
      success: false,
      error: { code: 'messaging/registration-token-not-registered' },
    },
    { success: false, error: { code: 'messaging/internal-error' } },
  ];
  assert.deepEqual(tokensInvalidos(tokens, respuestas), ['t2']);
});

test('correoHtml: escapa el contenido', () => {
  const html = correoHtml({
    titulo: 'A <b>',
    cuerpo: 'x & y',
    enlace: 'https://relevo-e5eaf.web.app/personas/1/bitacora',
  });
  assert.ok(html.includes('A &lt;b&gt;'));
  assert.ok(html.includes('x &amp; y'));
  assert.ok(html.includes('href="https://relevo-e5eaf.web.app/personas/1/bitacora"'));
});

test('elementosAgenda: une medicamentos y tareas con su anticipación', () => {
  const e = elementosAgenda(
    [{ id: 'm1', nombre: 'Paracetamol', dosis: '500 mg', horarios: ['08:00'] }],
    [
      {
        id: 't1',
        tipo: 'comida',
        nombre: 'Desayuno',
        horarios: ['07:30'],
        avisarMin: 30,
      },
      {
        id: 't2',
        tipo: 'bano',
        nombre: 'Baño',
        horarios: ['10:00'],
        activo: false,
      },
      {
        id: 't3',
        tipo: 'otro',
        nombre: 'Sin aviso',
        horarios: ['11:00'],
        avisarMin: 0,
      },
    ],
    10,
  );
  assert.deepEqual(
    e.map((x) => [x.clase, x.id, x.nombre, x.avisarMin, x.activo]),
    [
      ['medicamento', 'm1', 'Paracetamol 500 mg', 10, true],
      ['tarea', 't1', 'Desayuno', 30, true],
      ['tarea', 't2', 'Baño', 15, false],
      ['tarea', 't3', 'Sin aviso', 15, true],
    ],
  );
});

test('proximos: solo horarios por llegar dentro de la anticipación, de elementos activos', () => {
  const ahora = partesEnZona(new Date('2026-09-15T13:50:00Z'), ZONA); // 07:50 CDMX
  const elementos = elementosAgenda(
    [
      {
        id: 'm1',
        nombre: 'Paracetamol',
        dosis: '500 mg',
        horarios: ['08:00', '20:00'],
      },
    ],
    [
      {
        id: 't1',
        tipo: 'comida',
        nombre: 'Desayuno',
        horarios: ['08:15'],
        avisarMin: 30,
      },
      {
        id: 't2',
        tipo: 'comida',
        nombre: 'Comida',
        horarios: ['14:00'],
        avisarMin: 30,
      },
      {
        id: 't3',
        tipo: 'bano',
        nombre: 'Baño',
        horarios: ['08:00'],
        avisarMin: 15,
        activo: false,
      },
      {
        id: 't4',
        tipo: 'otro',
        nombre: 'Ya pasó',
        horarios: ['07:50'],
        avisarMin: 15,
      },
      {
        id: 't5',
        tipo: 'otro',
        nombre: 'Justo al límite',
        horarios: ['08:05'],
        avisarMin: 15,
      },
    ],
    15,
  );
  const p = proximos(elementos, ahora);
  assert.deepEqual(
    p.map((x) => [x.elemento.clase, x.elemento.id, x.horario, x.idHorario, x.faltanMin]),
    [
      ['medicamento', 'm1', '08:00', '20260915-0800', 10],
      ['tarea', 't1', '08:15', '20260915-0815', 25],
      ['tarea', 't5', '08:05', '20260915-0805', 15],
    ],
  );
});

test('mensajeProximo: medicamento y tarea', () => {
  const med = mensajeProximo({
    personaNombre: 'Lupe',
    elemento: { clase: 'medicamento', nombre: 'Paracetamol 500 mg', notas: '' },
    horario: '08:00',
    faltanMin: 10,
  });
  assert.equal(med.titulo, 'Lupe: en 10 min · Medicamento');
  assert.equal(med.cuerpo, 'Paracetamol 500 mg a las 08:00');
  const tarea = mensajeProximo({
    personaNombre: 'Lupe',
    elemento: {
      clase: 'tarea',
      tipo: 'comida',
      nombre: 'Desayuno',
      notas: 'Dieta blanda',
    },
    horario: '08:15',
    faltanMin: 1,
  });
  assert.equal(tarea.titulo, 'Lupe: en 1 min · Comida');
  assert.equal(tarea.cuerpo, 'Desayuno a las 08:15 · Dieta blanda');
  const rango = mensajeProximo({
    personaNombre: 'Lupe',
    elemento: { clase: 'tarea', tipo: 'ejercicio', nombre: 'Caminata', duracionMin: 60 },
    horario: '10:00',
    faltanMin: 15,
  });
  assert.equal(rango.titulo, 'Lupe: en 15 min · Ejercicio');
  assert.equal(rango.cuerpo, 'Caminata de 10:00 a 11:00');
});

test('partesEnZona: fecha ISO y día de la semana en la zona', () => {
  const p = partesEnZona(new Date('2026-09-15T14:05:00Z'), ZONA); // martes 15 sep, 08:05 CDMX
  assert.equal(p.fecha, '2026-09-15');
  assert.equal(p.diaSemana, 2);
  // 2026-09-14 05:30 UTC = domingo 13 sep 23:30 CDMX
  assert.equal(partesEnZona(new Date('2026-09-14T05:30:00Z'), ZONA).diaSemana, 0);
});

test('sumarDiasIso y vigenteEnFecha: ventana del tratamiento', () => {
  assert.equal(sumarDiasIso('2026-09-28', 5), '2026-10-03');
  const m = { inicio: '2026-09-15', duracionDias: 7 }; // 15 al 21
  assert.equal(vigenteEnFecha(m, '2026-09-14'), false);
  assert.equal(vigenteEnFecha(m, '2026-09-15'), true);
  assert.equal(vigenteEnFecha(m, '2026-09-21'), true);
  assert.equal(vigenteEnFecha(m, '2026-09-22'), false);
  assert.equal(vigenteEnFecha({ inicio: '2026-09-15', duracionDias: null }, '2027-01-01'), true);
  assert.equal(vigenteEnFecha({}, '2026-09-15'), true); // medicamentos antiguos sin datos
});

test('tareaEnDia: sin días = todos; con días, solo esos', () => {
  assert.equal(tareaEnDia(undefined, 3), true);
  assert.equal(tareaEnDia([], 3), true);
  assert.equal(tareaEnDia([1, 3, 5, 0], 3), true);
  assert.equal(tareaEnDia([1, 3, 5, 0], 2), false);
});

test('dosisVencidas y proximos respetan la duración del medicamento y los días de la tarea', () => {
  const ahora = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA); // martes 08:30 CDMX
  const meds = [
    { id: 'vigente', nombre: 'A', horarios: ['08:00'], inicio: '2026-09-10', duracionDias: 10 },
    { id: 'terminado', nombre: 'B', horarios: ['08:00'], inicio: '2026-09-01', duracionDias: 7 },
    { id: 'futuro', nombre: 'C', horarios: ['08:00'], inicio: '2026-09-20', duracionDias: null },
  ];
  assert.deepEqual(
    dosisVencidas(meds, ahora).map((d) => d.medicamento.id),
    ['vigente'],
  );

  const elementos = elementosAgenda(
    [{ id: 'm', nombre: 'D', horarios: ['08:40'], inicio: '2026-09-01', duracionDias: 3 }],
    [
      { id: 'martes', tipo: 'bano', nombre: 'Baño', horarios: ['08:40'], dias: [2, 4] },
      { id: 'lunes', tipo: 'bano', nombre: 'Baño', horarios: ['08:40'], dias: [1, 3, 5] },
      { id: 'diario', tipo: 'comida', nombre: 'Desayuno', horarios: ['08:40'] },
    ],
    15,
  );
  assert.deepEqual(
    proximos(elementos, ahora).map((p) => p.elemento.id),
    ['martes', 'diario'],
  );
});

test('enTurno: diurno, nocturno que cruza la medianoche y días', () => {
  const martes0830 = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA);
  const martes2330 = partesEnZona(new Date('2026-09-16T05:30:00Z'), ZONA);
  const miercoles0130 = partesEnZona(new Date('2026-09-16T07:30:00Z'), ZONA);
  const diurno = { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' };
  assert.equal(enTurno(diurno, martes0830), true);
  assert.equal(enTurno(diurno, martes2330), false);
  assert.equal(enTurno({ ...diurno, dias: [6, 0] }, martes0830), false);
  const nocturno = { dias: [2], desde: '22:00', hasta: '06:00' }; // martes noche → miércoles madrugada
  assert.equal(enTurno(nocturno, martes2330), true);
  assert.equal(enTurno(nocturno, miercoles0130), true);
  assert.equal(enTurno(nocturno, martes0830), false);
  assert.equal(enTurno({ dias: [2], desde: 'x', hasta: '06:00' }, martes0830), false);
});

test('deGuardia: sin turnos todos; con turnos solo los activos; nadie activo → responsable', () => {
  const martes0830 = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA);
  const base = [
    { uid: 'resp', rol: 'cuidador_principal' },
    { uid: 'enf', rol: 'cuidador_turno' },
    { uid: 'fam', rol: 'familiar' },
    { uid: 'doc', rol: 'medico' },
  ];
  assert.deepEqual(deGuardia(base, martes0830), ['resp', 'enf', 'fam']);
  const conTurnos = [
    { uid: 'resp', rol: 'cuidador_principal' },
    {
      uid: 'enf',
      rol: 'cuidador_turno',
      turnos: [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' }],
    },
    {
      uid: 'fam',
      rol: 'familiar',
      turnos: [{ dias: [1, 2, 3, 4, 5], desde: '16:00', hasta: '22:00' }],
    },
  ];
  assert.deepEqual(deGuardia(conTurnos, martes0830), ['enf']);
  const martes2330 = partesEnZona(new Date('2026-09-16T05:30:00Z'), ZONA);
  assert.deepEqual(deGuardia(conTurnos, martes2330), ['resp']);
});

test('destinatariosAlertas: todos menos el autor y quienes apagaron las alertas', () => {
  const miembros = [
    { uid: 'a', rol: 'cuidador_principal' },
    { uid: 'b', rol: 'familiar', alertas: false },
    { uid: 'c', rol: 'medico' },
  ];
  assert.deepEqual(destinatariosAlertas(miembros, { excluir: 'a' }), ['c']);
  assert.deepEqual(destinatariosAlertas(miembros), ['a', 'c']);
});

test('mensajeTarea: no hecha con nota', () => {
  const m = mensajeTarea({
    personaNombre: 'Lupe',
    tarea: { tipo: 'comida', nombre: 'Desayuno' },
    horario: '08:00',
    registro: { hecha: false, registradoNombre: 'Ana', nota: 'no tenía hambre' },
  });
  assert.equal(m.titulo, 'Lupe: tarea no realizada');
  assert.equal(m.cuerpo, 'Desayuno (Comida) de las 08:00 · registró Ana · no tenía hambre');
});

test('historialGemini: filtra entradas inválidas, recorta y traduce roles', () => {
  const h = historialGemini(
    [
      { rol: 'usuario', texto: 'a' },
      { rol: 'asistente', texto: 'b' },
      { rol: 'otro', texto: 'c' },
      { rol: 'usuario', texto: '   ' },
      { rol: 'usuario', texto: 'd' },
    ],
    2,
  );
  assert.deepEqual(h, [
    { role: 'model', parts: [{ text: 'b' }] },
    { role: 'user', parts: [{ text: 'd' }] },
  ]);
  assert.deepEqual(historialGemini('nada'), []);
});

test('INSTRUCCIONES_RESUMEN: pide las secciones del PDF en el orden esperado', () => {
  const secciones = ['RESUMEN GENERAL', 'MEDICAMENTOS', 'SÍNTOMAS E INCIDENTES', 'RUTINA Y ALIMENTACIÓN', 'SIGNOS VITALES', 'PARA COMENTAR CON EL MÉDICO'];
  let pos = -1;
  for (const s of secciones) {
    const i = INSTRUCCIONES_RESUMEN.indexOf(s);
    assert.ok(i > pos, `falta o está fuera de orden: ${s}`);
    pos = i;
  }
});

// --- Inventario bajo ---

const HOY = '2026-09-15';
const losartan = (inventario, extra = {}) => ({
  nombre: 'Losartán',
  dosis: '50 mg',
  horarios: ['08:00'],
  inventario,
  ...extra,
});

test('estadoInventario: umbral de 5 días según las tomas al día', () => {
  assert.deepEqual(estadoInventario(losartan(5), HOY), {
    nivel: 'bajo',
    unidades: 5,
    alDia: 1,
    dias: 5,
  });
  assert.equal(estadoInventario(losartan(6), HOY).nivel, 'ok');
  const metformina = (inventario) => ({ horarios: ['08:00', '20:00'], inventario });
  assert.deepEqual(estadoInventario(metformina(10), HOY), {
    nivel: 'bajo',
    unidades: 10,
    alDia: 2,
    dias: 5,
  });
  assert.equal(estadoInventario(metformina(11), HOY).nivel, 'ok');
  assert.deepEqual(estadoInventario(losartan(0), HOY), {
    nivel: 'agotado',
    unidades: 0,
    alDia: 1,
    dias: 0,
  });
});

test('estadoInventario: según necesidad usa el mínimo de unidades y no calcula días', () => {
  const paracetamol = (inventario) => ({ segunNecesidad: true, horarios: [], inventario });
  assert.deepEqual(estadoInventario(paracetamol(5), HOY), {
    nivel: 'bajo',
    unidades: 5,
    alDia: 0,
    dias: null,
  });
  assert.equal(estadoInventario(paracetamol(6), HOY).nivel, 'ok');
  // Aunque conserve horarios viejos, según necesidad no cuenta tomas al día
  assert.equal(estadoInventario({ ...paracetamol(6), horarios: ['08:00', '20:00'] }, HOY).alDia, 0);
});

test('estadoInventario: null si no se controla, está suspendido o el tratamiento terminó', () => {
  assert.equal(estadoInventario(losartan(null), HOY), null);
  assert.equal(estadoInventario(losartan(undefined), HOY), null);
  assert.equal(estadoInventario(losartan('5'), HOY), null);
  assert.equal(estadoInventario(losartan(NaN), HOY), null);
  assert.equal(estadoInventario(undefined, HOY), null);
  assert.equal(estadoInventario(losartan(3, { activo: false }), HOY), null);
  const tratamiento = { inicio: '2026-09-08', duracionDias: 7 }; // 8 al 14
  assert.equal(estadoInventario(losartan(3, tratamiento), '2026-09-14').nivel, 'ok'); // último día
  assert.equal(estadoInventario(losartan(3, tratamiento), HOY), null);
});

test('estadoInventario: un inventario negativo de datos antiguos cuenta como agotado', () => {
  assert.deepEqual(estadoInventario(losartan(-1), HOY), {
    nivel: 'agotado',
    unidades: 0,
    alDia: 1,
    dias: 0,
  });
});

test('estadoInventario: si alcanza para terminar el tratamiento está ok aunque sean pocas', () => {
  const amoxicilina = (inventario, inicio = HOY) => ({
    horarios: ['06:00', '14:00', '22:00'],
    inicio,
    duracionDias: 7,
    inventario,
  });
  // Empieza hoy: hoy no se cuenta, faltan 6 días × 3 = 18
  assert.equal(estadoInventario(amoxicilina(21), HOY).nivel, 'ok');
  assert.equal(estadoInventario(amoxicilina(18), HOY).nivel, 'ok');
  assert.equal(estadoInventario(amoxicilina(17), HOY).nivel, 'ok'); // no alcanza, pero sobran 15
  assert.equal(estadoInventario(amoxicilina(15), HOY).nivel, 'bajo');
  // Penúltimo día (inicio hace 5 días): faltan las 3 dosis de mañana
  assert.equal(estadoInventario(amoxicilina(3, '2026-09-10'), HOY).nivel, 'ok');
  assert.deepEqual(estadoInventario(amoxicilina(2, '2026-09-10'), HOY), {
    nivel: 'bajo',
    unidades: 2,
    alDia: 3,
    dias: 0,
  });
  assert.equal(estadoInventario(amoxicilina(0, '2026-09-10'), HOY).nivel, 'agotado');
  // Último día (inicio hace 6 días): después de hoy no falta nada, así que quedarse en 0 es lo normal
  assert.equal(estadoInventario(amoxicilina(2, '2026-09-09'), HOY).nivel, 'ok');
  assert.equal(estadoInventario(amoxicilina(0, '2026-09-09'), HOY).nivel, 'ok');
  // Todavía no empieza: se cuentan los 7 días completos desde el inicio
  assert.equal(estadoInventario(amoxicilina(21, '2026-09-20'), HOY).nivel, 'ok');
  assert.equal(estadoInventario(amoxicilina(12, '2026-09-20'), HOY).nivel, 'bajo');
  // Cruza el fin de mes: del 2 al 3 de octubre faltan 2 días × 3
  assert.equal(estadoInventario(amoxicilina(6, '2026-09-27'), '2026-10-01').nivel, 'ok');
  assert.equal(estadoInventario(amoxicilina(5, '2026-09-27'), '2026-10-01').nivel, 'bajo');
});

test('avisoInventario: un tratamiento surtido con la cantidad exacta no avisa nunca; si falta un día, sí', () => {
  const dias = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
  const curso = (inventario) => ({
    nombre: 'Amoxicilina',
    dosis: '500 mg',
    horarios: ['06:00', '14:00', '22:00'],
    inicio: dias[0],
    duracionDias: 7,
    inventario,
  });
  // Registra las 3 tomas de cada día, guardando el estado como lo hace el disparador
  const seguir = (inicial) => {
    const avisos = [];
    let inventario = inicial;
    let estado = null;
    for (const hoyIso of dias) {
      for (let toma = 0; toma < 3 && inventario > 0; toma++) {
        const r = avisoInventario({ antes: curso(inventario), despues: curso(inventario - 1), estado, hoyIso });
        if (r.avisar) avisos.push(`${hoyIso} ${r.avisar} (${inventario - 1})`);
        estado = r.estado;
        inventario -= 1;
      }
    }
    return avisos;
  };
  assert.deepEqual(seguir(21), []);
  assert.deepEqual(seguir(18), ['2026-09-15 bajo (15)', '2026-09-20 agotado (0)']);
});

/** Aplica cambios de inventario en cadena, guardando el estado como lo hace el disparador. */
function seguirInventario(pasos, estado = null) {
  const avisos = [];
  for (const [a, d] of pasos) {
    const r = avisoInventario({
      antes: a === undefined ? undefined : losartan(a),
      despues: d === undefined ? undefined : losartan(d),
      estado,
      hoyIso: HOY,
    });
    avisos.push(r.avisar);
    estado = r.estado;
  }
  return { avisos, estado };
}

test('avisoInventario: avisa una vez al cruzar a bajo y otra al agotarse', () => {
  assert.deepEqual(
    avisoInventario({ antes: losartan(6), despues: losartan(5), estado: null, hoyIso: HOY }),
    { avisar: 'bajo', estado: 'bajo' },
  );
  assert.deepEqual(
    avisoInventario({ antes: losartan(5), despues: losartan(4), estado: 'bajo', hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  assert.deepEqual(
    avisoInventario({ antes: losartan(1), despues: losartan(0), estado: 'bajo', hoyIso: HOY }),
    { avisar: 'agotado', estado: 'agotado' },
  );
  const r = seguirInventario([
    [7, 6],
    [6, 5],
    [5, 4],
    [4, 3],
    [3, 2],
    [2, 1],
    [1, 0],
  ]);
  assert.deepEqual(r.avisos, [null, 'bajo', null, null, null, null, 'agotado']);
  assert.equal(r.estado, 'agotado');
});

test('avisoInventario: deshacer una toma conserva el estado y rehacerla no repite el aviso', () => {
  assert.deepEqual(
    avisoInventario({ antes: losartan(5), despues: losartan(6), estado: 'bajo', hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  const r = seguirInventario([
    [6, 5],
    [5, 6],
    [6, 5],
  ]);
  assert.deepEqual(r.avisos, ['bajo', null, null]);
  assert.equal(r.estado, 'bajo');
  // Igual con el agotado: 1→0, deshacer y volver a marcar
  const agotado = seguirInventario(
    [
      [1, 0],
      [0, 1],
      [1, 0],
    ],
    'bajo',
  );
  assert.deepEqual(agotado.avisos, ['agotado', null, null]);
});

test('avisoInventario: resurtir rearma el aviso y un nuevo cruce vuelve a avisar', () => {
  assert.deepEqual(
    avisoInventario({ antes: losartan(3), despues: losartan(33), estado: 'bajo', hoyIso: HOY }),
    { avisar: null, estado: null },
  );
  const r = seguirInventario(
    [
      [3, 33],
      [6, 5],
    ],
    'bajo',
  );
  assert.deepEqual(r.avisos, [null, 'bajo']);
});

test('avisoInventario: crear con inventario bajo no avisa pero deja el estado', () => {
  assert.deepEqual(
    avisoInventario({ antes: undefined, despues: losartan(4), estado: null, hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  assert.deepEqual(
    avisoInventario({ antes: undefined, despues: losartan(30), estado: null, hoyIso: HOY }),
    { avisar: null, estado: null },
  );
  // Empezar a controlar el inventario de un medicamento que ya existía tampoco avisa
  assert.deepEqual(
    avisoInventario({ antes: losartan(null), despues: losartan(4), estado: null, hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  // …pero la siguiente toma no repite y agotarlo sí avisa
  const r = seguirInventario(
    [
      [4, 3],
      [1, 0],
    ],
    'bajo',
  );
  assert.deepEqual(r.avisos, [null, 'agotado']);
});

test('avisoInventario: resurtir de 0 a 3 deja bajo sin avisar y al llegar a 0 avisa agotado', () => {
  assert.deepEqual(
    avisoInventario({ antes: losartan(0), despues: losartan(3), estado: 'agotado', hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  assert.deepEqual(
    avisoInventario({ antes: losartan(1), despues: losartan(0), estado: 'bajo', hoyIso: HOY }),
    { avisar: 'agotado', estado: 'agotado' },
  );
});

test('avisoInventario: reparar un -1 a 0 avisa del agotado una vez; resurtir desde un negativo no avisa', () => {
  // De ese agotado nunca se avisó: el negativo viene de antes de que existiera el aviso
  assert.deepEqual(
    avisoInventario({ antes: losartan(-1), despues: losartan(0), estado: null, hoyIso: HOY }),
    { avisar: 'agotado', estado: 'agotado' },
  );
  assert.deepEqual(
    avisoInventario({ antes: losartan(-1), despues: losartan(0), estado: 'agotado', hoyIso: HOY }),
    { avisar: null, estado: 'agotado' },
  );
  assert.deepEqual(
    avisoInventario({ antes: losartan(-1), despues: losartan(3), estado: null, hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  // Editar otra cosa de un medicamento que sigue en negativo no avisa
  assert.deepEqual(
    avisoInventario({
      antes: losartan(-1),
      despues: losartan(-1, { horarios: ['08:00', '20:00'] }),
      estado: null,
      hoyIso: HOY,
    }),
    { avisar: null, estado: null },
  );
});

test('avisoInventario: deshacer varias tomas y volver a marcarlas no repite ningún aviso', () => {
  const agotado = seguirInventario(
    [
      [1, 0],
      [0, 1],
      [1, 2],
      [2, 1],
      [1, 0],
    ],
    'bajo',
  );
  assert.deepEqual(agotado.avisos, ['agotado', null, null, null, null]);
  assert.equal(agotado.estado, 'agotado');
  const bajo = seguirInventario([
    [6, 5],
    [5, 6],
    [6, 7],
    [7, 6],
    [6, 5],
  ]);
  assert.deepEqual(bajo.avisos, ['bajo', null, null, null, null]);
  assert.equal(bajo.estado, 'bajo');
});

test('avisoInventario: resurtir una sola unidad también rearma el aviso (cambia ultimoResurtido)', () => {
  const r = avisoInventario({
    antes: losartan(0, { ultimoResurtido: 30 }),
    despues: losartan(1, { ultimoResurtido: 1 }),
    estado: 'agotado',
    hoyIso: HOY,
  });
  assert.deepEqual(r, { avisar: null, estado: 'bajo' });
  assert.deepEqual(
    avisoInventario({
      antes: losartan(1, { ultimoResurtido: 1 }),
      despues: losartan(0, { ultimoResurtido: 1 }),
      estado: r.estado,
      hoyIso: HOY,
    }),
    { avisar: 'agotado', estado: 'agotado' },
  );
});

test('avisoInventario: corregir el inventario a mano (cambia editadoEn) rearma el aviso aunque suba 1', () => {
  // El responsable deja en 1 un medicamento agotado desde el formulario: no avisa, pero rearma
  const r = avisoInventario({
    antes: losartan(0, { editadoEn: 1 }),
    despues: losartan(1, { editadoEn: 2 }),
    estado: 'agotado',
    hoyIso: HOY,
  });
  assert.deepEqual(r, { avisar: null, estado: 'bajo' });
  // …y la siguiente toma que lo deja en 0 vuelve a avisar
  assert.deepEqual(
    avisoInventario({
      antes: losartan(1, { editadoEn: 2 }),
      despues: losartan(0, { editadoEn: 2 }),
      estado: r.estado,
      hoyIso: HOY,
    }),
    { avisar: 'agotado', estado: 'agotado' },
  );
  // Deshacer una toma no trae editadoEn nuevo: conserva el estado
  assert.deepEqual(
    avisoInventario({
      antes: losartan(0, { editadoEn: 2 }),
      despues: losartan(1, { editadoEn: 2 }),
      estado: 'agotado',
      hoyIso: HOY,
    }),
    { avisar: null, estado: 'agotado' },
  );
  // Un medicamento guardado antes de existir la marca la recibe por primera vez: también cuenta
  assert.deepEqual(
    avisoInventario({ antes: losartan(0), despues: losartan(1, { editadoEn: 3 }), estado: 'agotado', hoyIso: HOY }),
    { avisar: null, estado: 'bajo' },
  );
  // Con Timestamp de Firestore se compara el instante, no el objeto
  const ts = (ms) => ({ toMillis: () => ms });
  assert.deepEqual(
    avisoInventario({
      antes: losartan(0, { editadoEn: ts(5) }),
      despues: losartan(1, { editadoEn: ts(5) }),
      estado: 'agotado',
      hoyIso: HOY,
    }),
    { avisar: null, estado: 'agotado' },
  );
  assert.deepEqual(
    avisoInventario({
      antes: losartan(0, { editadoEn: ts(5) }),
      despues: losartan(1, { editadoEn: ts(9) }),
      estado: 'agotado',
      hoyIso: HOY,
    }),
    { avisar: null, estado: 'bajo' },
  );
});

test('avisoInventario: si queda bajo por editar otra cosa, avisa la siguiente toma', () => {
  // Con 1 al día, 8 unidades están bien; al pasar a 2 al día el umbral sube a 10
  const dosAlDia = { horarios: ['08:00', '20:00'] };
  const editar = avisoInventario({
    antes: losartan(8),
    despues: losartan(8, dosAlDia),
    estado: null,
    hoyIso: HOY,
  });
  assert.deepEqual(editar, { avisar: null, estado: null });
  assert.deepEqual(
    avisoInventario({
      antes: losartan(8, dosAlDia),
      despues: losartan(7, dosAlDia),
      estado: editar.estado,
      hoyIso: HOY,
    }),
    { avisar: 'bajo', estado: 'bajo' },
  );
  // Y si con el cambio deja de estar bajo, el aviso se rearma
  assert.deepEqual(
    avisoInventario({
      antes: losartan(8, dosAlDia),
      despues: losartan(8),
      estado: 'bajo',
      hoyIso: HOY,
    }),
    { avisar: null, estado: null },
  );
});

test('avisoInventario: borrar, suspender o dejar de controlar limpia el estado', () => {
  assert.deepEqual(
    avisoInventario({ antes: losartan(3), despues: undefined, estado: 'bajo', hoyIso: HOY }),
    { avisar: null, estado: null },
  );
  assert.deepEqual(
    avisoInventario({
      antes: losartan(3),
      despues: losartan(3, { activo: false }),
      estado: 'bajo',
      hoyIso: HOY,
    }),
    { avisar: null, estado: null },
  );
  assert.deepEqual(
    avisoInventario({ antes: losartan(3), despues: losartan(null), estado: 'bajo', hoyIso: HOY }),
    { avisar: null, estado: null },
  );
  // Al reactivarlo con poco inventario no avisa (no fue una baja) ni queda anotado: avisará la siguiente toma
  assert.deepEqual(
    avisoInventario({
      antes: losartan(3, { activo: false }),
      despues: losartan(3),
      estado: null,
      hoyIso: HOY,
    }),
    { avisar: null, estado: null },
  );
});

test('mensajeInventario: plural, singular, menos de un día, según necesidad y agotado', () => {
  const mensaje = (m) =>
    mensajeInventario({
      personaNombre: 'Lupe',
      medicamento: m,
      estado: estadoInventario(m, HOY),
    });
  const plural = mensaje(losartan(5));
  assert.equal(plural.titulo, 'Lupe: queda poco medicamento');
  assert.equal(plural.cuerpo, 'Quedan 5 de Losartán 50 mg: alcanza para 5 días.');
  assert.equal(mensaje(losartan(1)).cuerpo, 'Queda 1 de Losartán 50 mg: alcanza para 1 día.');
  assert.equal(
    mensaje(losartan(1, { horarios: ['08:00', '20:00'] })).cuerpo,
    'Queda 1 de Losartán 50 mg: no alcanza para un día completo.',
  );
  assert.equal(
    mensaje(losartan(2, { horarios: ['06:00', '14:00', '22:00'] })).cuerpo,
    'Quedan 2 de Losartán 50 mg: no alcanza para un día completo.',
  );
  assert.equal(
    mensaje({ nombre: 'Paracetamol', dosis: '500 mg', segunNecesidad: true, inventario: 5 }).cuerpo,
    'Quedan 5 de Paracetamol 500 mg (según necesidad).',
  );
  const agotado = mensaje(losartan(0));
  assert.equal(agotado.titulo, '⚠️ Lupe: se acabó un medicamento');
  assert.equal(
    agotado.cuerpo,
    'Ya no quedan unidades de Losartán 50 mg. Actualiza el inventario cuando lo resurtan.',
  );
});

test('destinatariosInventario: responsables siempre, familiares con alertas; enfermeros y médicos no', () => {
  const miembros = [
    { uid: 'resp', rol: 'cuidador_principal', alertas: false },
    { uid: 'resp2', rol: 'cuidador_principal' },
    { uid: 'enf', rol: 'cuidador_turno' },
    { uid: 'fam', rol: 'familiar' },
    { uid: 'famSin', rol: 'familiar', alertas: false },
    { uid: 'doc', rol: 'medico' },
    { rol: 'cuidador_principal' },
  ];
  // Cada quien manda sobre sus avisos: un responsable que los apagó tampoco recibe el inventario
  assert.deepEqual(destinatariosInventario(miembros), ['resp2', 'fam']);
  assert.deepEqual(destinatariosInventario([]), []);
});

test('destinatariosInventario: "queda poco" solo a quien quiere todos los avisos; "agotado" también a "importantes"', () => {
  const miembros = [
    { uid: 'todo', rol: 'cuidador_principal', avisos: 'todos' },
    { uid: 'imp', rol: 'familiar', avisos: 'importantes' },
    { uid: 'nada', rol: 'familiar', avisos: 'ninguno' },
  ];
  assert.deepEqual(destinatariosInventario(miembros, { importante: false }), ['todo']);
  assert.deepEqual(destinatariosInventario(miembros, { importante: true }), ['todo', 'imp']);
});

test('modoAvisos y quiereAviso: modos, versión anterior (alertas) y "solo en turno"', () => {
  assert.equal(modoAvisos({}), 'todos');
  assert.equal(modoAvisos({ alertas: false }), 'ninguno');
  assert.equal(modoAvisos({ alertas: false, avisos: 'todos' }), 'todos'); // manda `avisos`
  assert.equal(modoAvisos({ avisos: 'raro' }), 'todos');

  assert.equal(quiereAviso({ avisos: 'ninguno' }, { importante: true }), false);
  assert.equal(quiereAviso({ avisos: 'importantes' }, { importante: false }), false);
  assert.equal(quiereAviso({ avisos: 'importantes' }, { importante: true }), true);
  assert.equal(quiereAviso({ avisos: 'todos' }, { importante: false }), true);

  const turnos = [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' }];
  const martes0830 = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA);
  const martes2330 = partesEnZona(new Date('2026-09-16T05:30:00Z'), ZONA);
  assert.equal(quiereAviso({ soloEnTurno: true, turnos }, { ahora: martes0830 }), true);
  assert.equal(quiereAviso({ soloEnTurno: true, turnos }, { ahora: martes2330 }), false);
  // Sin turnos definidos "solo en turno" no aplica; sin `ahora` tampoco se puede evaluar
  assert.equal(quiereAviso({ soloEnTurno: true, turnos: [] }, { ahora: martes2330 }), true);
  assert.equal(quiereAviso({ soloEnTurno: true, turnos }), true);
});

test('destinatariosAlertas: respeta "importantes" y "solo en turno" de cada miembro', () => {
  const turnos = [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' }];
  const miembros = [
    { uid: 'autor', rol: 'cuidador_principal' },
    { uid: 'todo', rol: 'familiar', avisos: 'todos' },
    { uid: 'imp', rol: 'familiar', avisos: 'importantes' },
    { uid: 'nada', rol: 'medico', avisos: 'ninguno' },
    { uid: 'turno', rol: 'cuidador_turno', soloEnTurno: true, turnos },
  ];
  const martes0830 = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA);
  const martes2330 = partesEnZona(new Date('2026-09-16T05:30:00Z'), ZONA);
  assert.deepEqual(
    destinatariosAlertas(miembros, { excluir: 'autor', importante: false, ahora: martes0830 }),
    ['todo', 'turno'],
  );
  assert.deepEqual(
    destinatariosAlertas(miembros, { excluir: 'autor', importante: true, ahora: martes2330 }),
    ['todo', 'imp'],
  );
});

test('entradaImportante: incidentes, síntomas e indicaciones médicas sí; notas, ánimo y sueño no', () => {
  assert.equal(entradaImportante({ tipo: 'incidente' }), true);
  assert.equal(entradaImportante({ tipo: 'sintoma' }), true);
  assert.equal(entradaImportante({ tipo: 'indicacion' }), true);
  assert.equal(entradaImportante({ tipo: 'nota' }), false);
  assert.equal(entradaImportante({ tipo: 'animo' }), false);
  assert.equal(entradaImportante(undefined), false);
});

test('deGuardia: quien apagó los recordatorios no los recibe, ni como respaldo', () => {
  const turnos = [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' }];
  const martes0830 = partesEnZona(new Date('2026-09-15T14:30:00Z'), ZONA);
  const martes2330 = partesEnZona(new Date('2026-09-16T05:30:00Z'), ZONA);
  const miembros = [
    { uid: 'resp', rol: 'cuidador_principal', recordatorios: false },
    { uid: 'enf', rol: 'cuidador_turno', turnos },
    { uid: 'fam', rol: 'familiar', recordatorios: false, turnos },
  ];
  assert.deepEqual(deGuardia(miembros, martes0830), ['enf']);
  // Nadie de guardia y el responsable apagó sus recordatorios: no hay respaldo
  assert.deepEqual(deGuardia(miembros, martes2330), []);
  // Sin turnos en el equipo, todos los que registran... salvo quien los apagó
  assert.deepEqual(deGuardia([{ uid: 'a', rol: 'familiar' }, { uid: 'b', rol: 'familiar', recordatorios: false }], martes0830), ['a']);
});

test('citasProximas: citas por llegar dentro de su anticipación (1 h si no dicen); 0 = sin aviso; los turnos no', () => {
  const ahora = Date.UTC(2026, 9, 20, 15, 0); // 2026-10-20 09:00 CDMX
  const en = (min) => ({ toMillis: () => ahora + min * 60000 });
  const eventos = [
    { id: 'c1', tipo: 'cita', titulo: 'Cardiólogo', inicio: en(45) },
    { id: 'c2', tipo: 'cita', titulo: 'Lejos todavía', inicio: en(90) },
    { id: 'c3', tipo: 'terapia', titulo: 'Fisioterapia', inicio: en(100), avisarMin: 120 },
    { id: 'c4', tipo: 'cita', titulo: 'Sin aviso', inicio: en(10), avisarMin: 0 },
    { id: 'c5', tipo: 'cita', titulo: 'Ya empezó', inicio: en(-5) },
    { id: 't1', tipo: 'turno', titulo: 'Turno de Marta', inicio: en(30) },
    { id: 'c6', tipo: 'cita', titulo: 'Un día antes, justo', inicio: en(1440), avisarMin: 1440 },
    { id: 'c7', tipo: 'cita', titulo: 'Sin fecha' },
  ];
  assert.deepEqual(
    citasProximas(eventos, ahora).map((c) => [c.evento.id, c.faltanMin]),
    [
      ['c1', 45],
      ['c3', 100],
      ['c6', 1440],
    ],
  );
  assert.equal(AVISO_CITAS_MIN, 60);
});

test('textoFaltan y cuandoCita', () => {
  assert.equal(textoFaltan(1), 'en 1 min');
  assert.equal(textoFaltan(45), 'en 45 min');
  assert.equal(textoFaltan(60), 'en 1 h');
  assert.equal(textoFaltan(90), 'en 1 h 30 min');
  assert.equal(textoFaltan(1440), 'en 1 día');
  assert.equal(textoFaltan(2880), 'en 2 días');
  const ahora = partesEnZona(new Date('2026-10-20T15:00:00Z'), ZONA); // mar 20 oct, 09:00 CDMX
  const partes = (iso) => partesEnZona(new Date(iso), ZONA);
  assert.equal(cuandoCita(partes('2026-10-20T16:00:00Z'), ahora), 'hoy a las 10:00');
  assert.equal(cuandoCita(partes('2026-10-21T13:30:00Z'), ahora), 'mañana a las 07:30');
  assert.equal(cuandoCita(partes('2026-10-27T16:00:00Z'), ahora), 'el 27 oct a las 10:00');
});

test('mensajeCita: anticipación y tipo en el título; cuándo, lugar, quién acompaña y notas en el cuerpo', () => {
  const ahora = partesEnZona(new Date('2026-10-20T15:00:00Z'), ZONA);
  const m = mensajeCita({
    personaNombre: 'Lupe',
    evento: { tipo: 'cita', titulo: 'Cardiólogo', lugar: 'Hospital Ángeles', notas: 'Llevar el reporte' },
    faltanMin: 60,
    inicio: partesEnZona(new Date('2026-10-20T16:00:00Z'), ZONA),
    ahora,
    acompana: 'Sofía',
  });
  assert.equal(m.titulo, 'Lupe: en 1 h · Cita');
  assert.equal(m.cuerpo, 'Cardiólogo hoy a las 10:00 · Hospital Ángeles · acompaña Sofía · Llevar el reporte');
  const t = mensajeCita({
    personaNombre: 'Lupe',
    evento: { tipo: 'terapia', titulo: 'Fisioterapia' },
    faltanMin: 1440,
    inicio: partesEnZona(new Date('2026-10-21T16:00:00Z'), ZONA),
    ahora,
  });
  assert.equal(t.titulo, 'Lupe: en 1 día · Terapia');
  assert.equal(t.cuerpo, 'Fisioterapia mañana a las 10:00');
});

test('destinatariosCita: quien acompaña siempre; responsable y familiares según sus avisos; cuidadores solo de guardia; el médico no', () => {
  const ahora = partesEnZona(new Date('2026-10-20T15:00:00Z'), ZONA); // martes 09:00
  const todos = [0, 1, 2, 3, 4, 5, 6];
  const miembros = [
    { uid: 'ana', rol: 'cuidador_principal' },
    { uid: 'marta', rol: 'cuidador_turno', turnos: [{ dias: todos, desde: '20:00', hasta: '08:00' }] },
    { uid: 'pedro', rol: 'cuidador_turno', turnos: [{ dias: [2], desde: '08:00', hasta: '14:00' }] },
    { uid: 'sofia', rol: 'familiar', avisos: 'ninguno' },
    { uid: 'raul', rol: 'familiar', avisos: 'importantes' },
    { uid: 'lupe', rol: 'familiar', avisos: 'ninguno' },
    { uid: 'luis', rol: 'medico' },
  ];
  const cita = { id: 'c1', tipo: 'cita', titulo: 'Cardiólogo', responsableUid: 'sofia' };
  assert.deepEqual(destinatariosCita(miembros, cita, ahora).sort(), ['ana', 'pedro', 'raul', 'sofia']);
  // Sin turnos definidos nadie está "de guardia" en particular: reciben el recordatorio todos los
  // que registran (como las tomas), salvo quien apagó los recordatorios
  const sinTurnos = miembros.filter((m) => !m.turnos).map((m) => (m.uid === 'lupe' ? { ...m, recordatorios: false } : m));
  assert.deepEqual(
    destinatariosCita(sinTurnos, { ...cita, responsableUid: null }, ahora).sort(),
    ['ana', 'raul', 'sofia'],
  );
});

test('dosisVencidas: no recuerda dosis programadas antes de dar de alta el medicamento', () => {
  const instante = new Date('2026-09-15T21:10:00Z'); // 15:10 CDMX
  const ahora = partesEnZona(instante, ZONA);
  const meds = [
    // Agregado a las 15:05: la dosis de las 15:00 ya había pasado
    { id: 'nuevo', nombre: 'Nuevo', horarios: ['15:00'], creadoEn: { toMillis: () => Date.parse('2026-09-15T21:05:00Z') } },
    { id: 'viejo', nombre: 'Viejo', horarios: ['15:00'], creadoEn: { toMillis: () => Date.parse('2026-09-01T12:00:00Z') } },
  ];
  assert.deepEqual(dosisVencidas(meds, ahora, instante.getTime()).map((d) => d.medicamento.id), ['viejo']);
  // Sin el instante (llamadas anteriores) se comporta como antes
  assert.equal(dosisVencidas(meds, ahora).length, 2);
});

test('cuotaIa: cuenta por usuario y por día; al llegar al límite se niega sin contar y al día siguiente se reinicia', async () => {
  const { cuotaIa, LIMITE_IA_DIARIO } = await import('./logica.js');
  assert.equal(LIMITE_IA_DIARIO, 30);
  // Primera consulta del día
  let r = cuotaIa(null, '2026-10-31', 3);
  assert.deepEqual(r, { permitido: true, usados: 1, restantes: 2, datos: { fecha: '2026-10-31', usados: 1 } });
  r = cuotaIa(r.datos, '2026-10-31', 3);
  r = cuotaIa(r.datos, '2026-10-31', 3);
  assert.equal(r.usados, 3);
  assert.equal(r.restantes, 0);
  // La cuarta se niega y no se guarda nada
  const negada = cuotaIa(r.datos, '2026-10-31', 3);
  assert.equal(negada.permitido, false);
  assert.equal(negada.datos, null);
  // Otro día empieza de cero
  assert.deepEqual(cuotaIa(r.datos, '2026-11-01', 3).datos, { fecha: '2026-11-01', usados: 1 });
  // Datos raros guardados no rompen la cuenta
  assert.equal(cuotaIa({ fecha: '2026-10-31', usados: 'x' }, '2026-10-31', 3).usados, 1);
});

test('peticionSemaforo: token aleatorio y un día de ~24 h cercano a hoy', async () => {
  const { peticionSemaforo } = await import('./logica.js');
  const ahora = Date.UTC(2026, 9, 31, 18);
  const desde = Date.UTC(2026, 9, 31, 6);
  const hasta = desde + 24 * 3_600_000;
  const token = 'Ab3_-'.repeat(7) + 'xyz'; // 38 caracteres
  assert.deepEqual(peticionSemaforo({ token, desde, hasta }, ahora), { token, desde, hasta });
  // Token: corto, con caracteres raros o que no es texto
  assert.equal(peticionSemaforo({ token: 'corto', desde, hasta }, ahora).error, 'token');
  assert.equal(peticionSemaforo({ token: token.slice(0, 31) + '/', desde, hasta }, ahora).error, 'token');
  assert.equal(peticionSemaforo({ token: 123, desde, hasta }, ahora).error, 'token');
  assert.equal(peticionSemaforo(null, ahora).error, 'token');
  // Día: no numérico, de una semana, o de hace un mes
  assert.equal(peticionSemaforo({ token, desde: 'x', hasta }, ahora).error, 'dia');
  assert.equal(peticionSemaforo({ token, desde, hasta: desde + 7 * 86_400_000 }, ahora).error, 'dia');
  assert.equal(peticionSemaforo({ token, desde: desde - 30 * 86_400_000, hasta: hasta - 30 * 86_400_000 }, ahora).error, 'dia');
});

test('datosSemaforo: solo lo mínimo del plan del día, sin ficha, inventario, notas de registros ni autores', async () => {
  const { datosSemaforo } = await import('./logica.js');
  const ts = (ms) => ({ toMillis: () => ms });
  const r = datosSemaforo({
    persona: { nombre: 'Carmen', alergias: ['Penicilina'], notasMedicas: 'privado', enlaceSemaforo: 'x' },
    medicamentos: [
      { id: 'los', nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 28, activo: true, creadoEn: ts(1), notas: 'Con agua' },
      { id: 'sus', nombre: 'Suspendido', dosis: '1', horarios: ['09:00'], activo: false },
    ],
    tomas: [{ medicamentoId: 'los', id: '20261031-0800', tomado: true, horaProgramada: ts(5), registradoNombre: 'Marta', nota: 'privado' }],
    tareas: [{ id: 'cam', tipo: 'ejercicio', nombre: 'Caminata', horarios: ['17:00'], dias: [1, 'x'], duracionMin: 30, activo: true }],
    registros: [{ tareaId: 'cam', id: '20261031-1700', hecha: false, registradoPor: 'uid', nota: 'privado' }],
  });
  assert.equal(r.nombre, 'Carmen');
  assert.deepEqual(r.medicamentos.map((m) => m.id), ['los']);
  assert.deepEqual(r.medicamentos[0], {
    id: 'los', nombre: 'Losartán', dosis: '50 mg', notas: 'Con agua', horarios: ['08:00'], segunNecesidad: false,
    inicio: null, duracionDias: null, creadoEn: 1,
  });
  assert.deepEqual(r.tomas, [{ medicamentoId: 'los', id: '20261031-0800', tomado: true, horaProgramada: 5 }]);
  assert.deepEqual(r.tareas[0].dias, [1]);
  assert.deepEqual(r.registros, [{ tareaId: 'cam', id: '20261031-1700', hecha: false }]);
  // Nada de la ficha médica, el inventario ni quién registró
  const texto = JSON.stringify(r);
  for (const prohibido of ['Penicilina', 'privado', 'Marta', 'uid', 'inventario', 'enlaceSemaforo']) {
    assert.ok(!texto.includes(prohibido), prohibido);
  }
});
