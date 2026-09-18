/**
 * Lógica pura de las notificaciones (sin Firebase) para poder probarla con `node --test`.
 * index.js la usa desde los disparadores de Firestore y del programador.
 */

export const TIPO_ENTRADA_ETIQUETA = {
  sintoma: 'Síntoma',
  animo: 'Ánimo',
  comida: 'Comida',
  sueno: 'Sueño',
  incidente: 'Incidente',
  nota: 'Nota',
};

export const TIPO_TAREA_ETIQUETA = {
  comida: 'Comida',
  bano: 'Baño',
  ejercicio: 'Ejercicio',
  terapia: 'Terapia',
  cita: 'Cita',
  otro: 'Tarea',
};

/** Roles que reciben recordatorios de tomas: los que pueden registrarlas (igual que en la app). */
export const ROLES_REGISTRAN_TOMAS = ['cuidador_principal', 'cuidador_turno', 'familiar'];

/**
 * Ventana del recordatorio, en minutos después de la hora programada: se recuerda una dosis sin
 * registrar desde su hora hasta dos horas después (una sola vez; se anota en `recordatorios`).
 */
export const RECORDATORIO = { desdeMin: 0, hastaMin: 120 };

/** Minutos de anticipación por defecto (medicamentos y tareas sin `avisarMin`). */
export const AVISO_MIN_POR_DEFECTO = 15;

/** Códigos de FCM que indican que el token ya no sirve y hay que quitarlo del perfil. */
export const ERRORES_TOKEN_INVALIDO = [
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
];

export function recortar(texto, max = 180) {
  const limpio = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
}

/** Texto "nombre dosis" del medicamento, p. ej. "Paracetamol 500 mg". */
export function nombreMedicamento(m) {
  return [m?.nombre, m?.dosis].filter(Boolean).join(' ');
}

/** Aviso por una entrada nueva en la bitácora. */
export function mensajeEntrada({ personaNombre, entrada }) {
  const etiqueta = TIPO_ENTRADA_ETIQUETA[entrada.tipo] ?? 'Registro';
  const resaltado = entrada.tipo === 'incidente' || entrada.tipo === 'sintoma' ? '⚠️ ' : '';
  return {
    titulo: `${resaltado}${personaNombre}: ${etiqueta.toLowerCase()} en la bitácora`,
    cuerpo: `${entrada.autorNombre || 'Alguien'}: ${recortar(entrada.texto)}`,
  };
}

/** Aviso por una toma registrada (realizada o no). */
export function mensajeToma({ personaNombre, medicamento, horario, toma }) {
  const med = nombreMedicamento(medicamento);
  const quien = toma.registradoNombre ? ` · registró ${toma.registradoNombre}` : '';
  const nota = toma.nota ? ` · ${toma.nota}` : '';
  if (toma.aDemanda) {
    return {
      titulo: `${personaNombre}: medicamento según necesidad`,
      cuerpo: `${med} a las ${horario}${quien}${nota}`,
    };
  }
  return toma.tomado
    ? {
        titulo: `${personaNombre}: toma realizada`,
        cuerpo: `${med} de las ${horario}${quien}${nota}`,
      }
    : {
        titulo: `${personaNombre}: toma no realizada`,
        cuerpo: `${med} de las ${horario}${quien}${nota}`,
      };
}

/** Aviso por una tarea de la rutina registrada como no hecha (o hecha, si se pide). */
export function mensajeTarea({ personaNombre, tarea, horario, registro }) {
  const tipo = TIPO_TAREA_ETIQUETA[tarea?.tipo] ?? TIPO_TAREA_ETIQUETA.otro;
  const quien = registro.registradoNombre ? ` · registró ${registro.registradoNombre}` : '';
  const nota = registro.nota ? ` · ${registro.nota}` : '';
  return {
    titulo: `${personaNombre}: ${registro.hecha ? 'tarea realizada' : 'tarea no realizada'}`,
    cuerpo: `${tarea?.nombre ?? 'Tarea'} (${tipo}) de las ${horario}${quien}${nota}`,
  };
}

/** Recordatorio de una dosis que ya pasó de su hora y nadie ha registrado. */
export function mensajeRecordatorio({ personaNombre, medicamento, horario }) {
  return {
    titulo: `${personaNombre}: hora del medicamento`,
    cuerpo: `${nombreMedicamento(medicamento)} de las ${horario} sigue sin registrarse.`,
  };
}

/** "11:00" = "10:00" + 60 min (da la vuelta a medianoche). */
export function sumarMinutosHHmm(hhmm, minutos) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const total = ((((h || 0) * 60 + (m || 0) + minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Aviso previo: "Lupe: en 15 min · Comida" / "Desayuno a las 08:00" o "Ejercicio de 10:00 a 11:00". */
export function mensajeProximo({ personaNombre, elemento, horario, faltanMin }) {
  const clase =
    elemento.clase === 'medicamento'
      ? 'Medicamento'
      : (TIPO_TAREA_ETIQUETA[elemento.tipo] ?? TIPO_TAREA_ETIQUETA.otro);
  const cuanto = faltanMin <= 1 ? 'en 1 min' : `en ${faltanMin} min`;
  const cuando =
    elemento.duracionMin > 0
      ? `de ${horario} a ${sumarMinutosHHmm(horario, elemento.duracionMin)}`
      : `a las ${horario}`;
  return {
    titulo: `${personaNombre}: ${cuanto} · ${clase}`,
    cuerpo: `${elemento.nombre} ${cuando}${elemento.notas ? ` · ${elemento.notas}` : ''}`,
  };
}

/**
 * Une medicamentos y tareas en una sola lista de "elementos con horario" para los avisos previos.
 * Cada elemento: { clase, id, nombre, tipo?, notas?, horarios, avisarMin, activo }.
 */
export function elementosAgenda(
  medicamentos,
  tareas,
  avisoMedicamentosMin = AVISO_MIN_POR_DEFECTO,
) {
  const meds = (medicamentos ?? []).map((m) => ({
    clase: 'medicamento',
    id: m.id,
    nombre: nombreMedicamento(m),
    notas: m.notas || '',
    horarios: m.horarios ?? [],
    avisarMin: avisoMedicamentosMin,
    activo: m.activo !== false,
    inicio: m.inicio,
    duracionDias: m.duracionDias,
  }));
  const tars = (tareas ?? []).map((t) => ({
    clase: 'tarea',
    id: t.id,
    nombre: t.nombre,
    tipo: t.tipo,
    notas: t.notas || '',
    horarios: t.horarios ?? [],
    avisarMin: Number(t.avisarMin) > 0 ? Number(t.avisarMin) : AVISO_MIN_POR_DEFECTO,
    activo: t.activo !== false,
    dias: t.dias,
    duracionMin: Number(t.duracionMin) > 0 ? Number(t.duracionMin) : 0,
  }));
  return [...meds, ...tars];
}

/**
 * Elementos cuyo horario de hoy está por llegar: faltan entre 1 y `avisarMin` minutos.
 * Devuelve uno por horario, con el id del registro/toma (yyyyMMdd-HHmm) para saber si ya se hizo.
 */
export function proximos(elementos, ahora) {
  const salida = [];
  for (const e of elementos) {
    if (!e?.id || !e.activo) continue;
    if (e.clase === 'medicamento' && !vigenteEnFecha(e, ahora.fecha)) continue;
    if (e.clase === 'tarea' && !tareaEnDia(e.dias, ahora.diaSemana)) continue;
    for (const horario of e.horarios ?? []) {
      const [h, m] = horario.split(':').map(Number);
      if (Number.isNaN(h)) continue;
      const faltan = h * 60 + (m || 0) - ahora.minutosDelDia;
      if (faltan <= 0 || faltan > e.avisarMin) continue;
      salida.push({
        elemento: e,
        horario,
        idHorario: idTomaDe(ahora, horario),
        faltanMin: faltan,
      });
    }
  }
  return salida;
}

function minutosDe(hhmm) {
  const [h, m] = String(hhmm ?? '')
    .split(':')
    .map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

/** ¿El turno { dias, desde, hasta } cubre este momento? Si hasta <= desde, cruza la medianoche. */
export function enTurno(turno, ahora) {
  const desde = minutosDe(turno?.desde);
  const hasta = minutosDe(turno?.hasta);
  if (desde === null || hasta === null || !Array.isArray(turno.dias)) return false;
  const min = ahora.minutosDelDia;
  const hoy = ahora.diaSemana;
  const ayer = (hoy + 6) % 7;
  if (desde < hasta) return turno.dias.includes(hoy) && min >= desde && min < hasta;
  // Nocturno: empieza hoy a las `desde`, o es la continuación del turno de ayer hasta `hasta`
  return (turno.dias.includes(hoy) && min >= desde) || (turno.dias.includes(ayer) && min < hasta);
}

/**
 * Quién recibe los recordatorios de rutina (tomas pendientes, avisos previos) en este momento:
 * los que están de guardia. Si nadie del equipo definió turnos, todos los que registran (como
 * antes). Si hay turnos pero nadie está de guardia, el responsable.
 */
export function deGuardia(miembros, ahora) {
  const registran = miembros.filter((m) => m.uid && ROLES_REGISTRAN_TOMAS.includes(m.rol));
  const conTurnos = registran.filter((m) => Array.isArray(m.turnos) && m.turnos.length > 0);
  if (!conTurnos.length) return registran.map((m) => m.uid);
  const activos = conTurnos.filter((m) => m.turnos.some((t) => enTurno(t, ahora)));
  if (activos.length) return activos.map((m) => m.uid);
  return registran.filter((m) => m.rol === 'cuidador_principal').map((m) => m.uid);
}

/**
 * Quién recibe las alertas (bitácora, tomas omitidas, tomas según necesidad): todos menos quien
 * lo originó, salvo quien tenga las alertas desactivadas (miembro.alertas === false).
 */
export function destinatariosAlertas(miembros, { excluir } = {}) {
  return miembros
    .filter((m) => m.uid && m.uid !== excluir && m.alertas !== false)
    .map((m) => m.uid);
}

/**
 * Uids de los miembros que deben recibir el aviso: todos menos quien lo originó y, si se indican,
 * solo los de ciertos roles.
 */
export function destinatarios(miembros, { excluir, roles } = {}) {
  return miembros
    .filter((m) => m.uid && m.uid !== excluir && (!roles || roles.includes(m.rol)))
    .map((m) => m.uid);
}

/** Fecha y hora de `fecha` vistas en la zona horaria dada. */
export function partesEnZona(fecha, zona) {
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const p = Object.fromEntries(
    formato
      .formatToParts(fecha)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value]),
  );
  const hora = Number(p.hour) % 24;
  const minuto = Number(p.minute);
  const diaSemana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return {
    y: p.year,
    m: p.month,
    d: p.day,
    fecha: `${p.year}-${p.month}-${p.day}`,
    diaSemana,
    hora,
    minuto,
    minutosDelDia: hora * 60 + minuto,
  };
}

/** Suma días a una fecha ISO yyyy-mm-dd (sin zona horaria). */
export function sumarDiasIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  const dd = (v) => String(v).padStart(2, '0');
  return `${x.getUTCFullYear()}-${dd(x.getUTCMonth() + 1)}-${dd(x.getUTCDate())}`;
}

/** ¿El medicamento se toma en esa fecha? (inicio y duracionDias como en la app; sin datos = siempre) */
export function vigenteEnFecha(m, fechaIso) {
  if (m?.inicio && fechaIso < m.inicio) return false;
  if (
    m?.inicio &&
    Number(m.duracionDias) > 0 &&
    fechaIso >= sumarDiasIso(m.inicio, Number(m.duracionDias))
  ) {
    return false;
  }
  return true;
}

/** ¿La tarea aplica ese día de la semana? (sin días definidos = todos) */
export function tareaEnDia(dias, diaSemana) {
  return !Array.isArray(dias) || dias.length === 0 || dias.includes(diaSemana);
}

/** "HH:mm" de una fecha en la zona horaria dada. */
export function horarioDe(fecha, zona) {
  const p = partesEnZona(fecha, zona);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}

/** Id de la toma que usa la app (yyyyMMdd-HHmm) para un horario "HH:mm" del día de `partes`. */
export function idTomaDe(partes, horario) {
  const [h, m] = horario.split(':');
  return `${partes.y}${partes.m}${partes.d}-${String(Number(h)).padStart(2, '0')}${String(Number(m) || 0).padStart(2, '0')}`;
}

/**
 * Dosis de hoy que ya pasaron de su hora dentro de la ventana de recordatorio.
 * Devuelve una por cada horario de cada medicamento activo.
 */
export function dosisVencidas(medicamentos, ahora) {
  const salida = [];
  for (const medicamento of medicamentos) {
    if (!medicamento?.id || medicamento.activo === false) continue;
    if (!vigenteEnFecha(medicamento, ahora.fecha)) continue;
    for (const horario of medicamento.horarios ?? []) {
      const [h, m] = horario.split(':').map(Number);
      if (Number.isNaN(h)) continue;
      const desde = ahora.minutosDelDia - (h * 60 + (m || 0));
      if (desde < RECORDATORIO.desdeMin || desde > RECORDATORIO.hastaMin) continue;
      salida.push({
        medicamento,
        horario,
        idToma: idTomaDe(ahora, horario),
        minutosDesde: desde,
      });
    }
  }
  return salida;
}

/** Tokens que FCM rechazó como inválidos, según las respuestas de sendEachForMulticast. */
export function tokensInvalidos(tokens, respuestas) {
  return tokens.filter((_, i) => {
    const r = respuestas[i];
    return r && !r.success && ERRORES_TOKEN_INVALIDO.includes(r.error?.code);
  });
}

function escaparHtml(texto) {
  return String(texto).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** Cuerpo del correo en texto plano. */
export function correoTexto({ titulo, cuerpo, enlace }) {
  return `${titulo}\n\n${cuerpo}\n\nAbrir en Relevo: ${enlace}\n\nRecibes este correo porque formas parte del equipo de cuidado en Relevo.`;
}

/** Cuerpo del correo en HTML sencillo (se ve bien en cualquier cliente de correo). */
export function correoHtml({ titulo, cuerpo, enlace }) {
  return `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f5f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e0e0e0">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#3880ff">Relevo</p>
    <h1 style="margin:0 0 12px;font-size:20px">${escaparHtml(titulo)}</h1>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.5">${escaparHtml(cuerpo)}</p>
    <a href="${escaparHtml(enlace)}" style="display:inline-block;background:#3880ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Abrir en Relevo</a>
    <p style="margin:24px 0 0;font-size:12px;color:#777">Recibes este correo porque formas parte del equipo de cuidado en Relevo.</p>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Asistente (Gemini): instrucciones de sistema e historial de la conversación
// ---------------------------------------------------------------------------

export const INSTRUCCIONES_ASISTENTE = `Eres el asistente de Relevo, una bitácora compartida para el cuidado de una persona (adulto mayor, paciente crónico o en recuperación). Respondes en español, de forma breve, cálida y clara, a familiares, enfermeros y médicos.

Reglas:
- Usa EXCLUSIVAMENTE los datos que se te entregan abajo (bitácora, medicamentos y tomas, signos vitales, citas). Si algo no está en los datos, dilo con claridad ("no hay registros de eso"). Nunca inventes.
- Cuando cuentes ocurrencias (por ejemplo, tomas omitidas), da el número y enumera brevemente las fechas como evidencia.
- Cita fechas, horas y quién registró cada cosa cuando ayude.
- No des diagnósticos ni cambies tratamientos. Si detectas algo preocupante (síntomas repetidos, tomas omitidas seguidas, signos fuera de lo habitual), sugiere comentarlo con el médico.
- Responde en texto plano, sin markdown ni asteriscos; usa párrafos cortos o listas con guiones.`;

/** Convierte el historial del chat ({ rol, texto }) al formato de Gemini; ignora lo que no sea válido y deja las últimas `maximo` vueltas. */
export function historialGemini(historial, maximo = 8) {
  if (!Array.isArray(historial)) return [];
  return historial
    .filter(
      (m) =>
        m &&
        (m.rol === 'usuario' || m.rol === 'asistente') &&
        typeof m.texto === 'string' &&
        m.texto.trim(),
    )
    .slice(-maximo)
    .map((m) => ({
      role: m.rol === 'usuario' ? 'user' : 'model',
      parts: [{ text: m.texto.slice(0, 4000) }],
    }));
}

/** Instrucciones para el resumen del reporte (PDF): texto plano con secciones fijas, solo con los datos. */
export const INSTRUCCIONES_RESUMEN = `Eres el asistente de Relevo, una bitácora compartida de cuidado. Vas a escribir el resumen de un periodo para el reporte que la familia entrega al médico. Escribe en español, claro y respetuoso, en tercera persona, usando el nombre de la persona cuidada.

Reglas:
- Usa EXCLUSIVAMENTE los datos que se te entregan abajo. Nunca inventes. Si una sección no tiene datos, escribe "Sin registros en este periodo".
- Cita fechas (día y hora cuando ayude) y quién registró cada cosa relevante.
- Cuenta ocurrencias con números: tomas omitidas, comidas no hechas, incidentes.
- No des diagnósticos ni cambies tratamientos; señala lo que conviene comentar con el médico.
- Texto plano, sin markdown ni asteriscos. Máximo 400 palabras.
- Usa exactamente estas secciones, cada una con su título en MAYÚSCULAS en una línea y debajo frases cortas o viñetas con guion:
RESUMEN GENERAL
MEDICAMENTOS
SÍNTOMAS E INCIDENTES
RUTINA Y ALIMENTACIÓN
SIGNOS VITALES
PARA COMENTAR CON EL MÉDICO`;
