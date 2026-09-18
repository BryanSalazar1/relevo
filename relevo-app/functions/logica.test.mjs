// Pruebas de la lógica pura de notificaciones. Ejecutar con:  npm test  (dentro de functions/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correoHtml,
  deGuardia,
  destinatarios,
  destinatariosAlertas,
  enTurno,
  dosisVencidas,
  elementosAgenda,
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
