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
  indicacion: 'Indicación médica',
};

export const TIPO_TAREA_ETIQUETA = {
  comida: 'Comida',
  bano: 'Baño',
  ejercicio: 'Ejercicio',
  terapia: 'Terapia',
  signos: 'Signos vitales',
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
 * antes). Si hay turnos pero nadie está de guardia, el responsable. Quien apagó
 * "recordatorios de mi guardia" en Notificaciones (recordatorios: false) no cuenta.
 */
export function deGuardia(miembros, ahora) {
  const registran = miembros.filter(
    (m) => m.uid && ROLES_REGISTRAN_TOMAS.includes(m.rol) && m.recordatorios !== false,
  );
  const conTurnos = registran.filter((m) => Array.isArray(m.turnos) && m.turnos.length > 0);
  if (!conTurnos.length) return registran.map((m) => m.uid);
  const activos = conTurnos.filter((m) => m.turnos.some((t) => enTurno(t, ahora)));
  if (activos.length) return activos.map((m) => m.uid);
  return registran.filter((m) => m.rol === 'cuidador_principal').map((m) => m.uid);
}

// ---------------------------------------------------------------------------
// Preferencias de avisos de cada miembro (las elige en Notificaciones; mismos valores en la app
// y en firestore.rules)
// ---------------------------------------------------------------------------

/** Qué avisos del equipo recibe: todos, solo los importantes o ninguno. */
export const MODOS_AVISOS = ['todos', 'importantes', 'ninguno'];

/** Modo efectivo de un miembro: `avisos`; sin él, `alertas: false` (versión anterior) = ninguno. */
export function modoAvisos(m) {
  if (MODOS_AVISOS.includes(m?.avisos)) return m.avisos;
  return m?.alertas === false ? 'ninguno' : 'todos';
}

/** Lo "importante" (delicado) de una entrada de bitácora: incidentes, síntomas e indicaciones del médico. */
export function entradaImportante(entrada) {
  return entrada?.tipo === 'incidente' || entrada?.tipo === 'sintoma' || entrada?.tipo === 'indicacion';
}

/**
 * ¿El miembro quiere recibir este aviso del equipo en este momento?
 *   - modo 'ninguno': nunca; 'importantes': solo si `importante`.
 *   - soloEnTurno: solo mientras alguno de sus turnos cubre `ahora` (sin turnos definidos no aplica).
 */
export function quiereAviso(m, { importante = true, ahora } = {}) {
  const modo = modoAvisos(m);
  if (modo === 'ninguno') return false;
  if (modo === 'importantes' && !importante) return false;
  if (m?.soloEnTurno === true && ahora && Array.isArray(m.turnos) && m.turnos.length > 0) {
    return m.turnos.some((t) => enTurno(t, ahora));
  }
  return true;
}

/**
 * Quién recibe un aviso del equipo (bitácora, tomas omitidas o según necesidad, tareas no hechas):
 * todos menos quien lo originó, según las preferencias de cada uno (`quiereAviso`).
 * `importante` marca lo delicado (incidente, síntoma, toma no tomada, medicamento agotado).
 */
export function destinatariosAlertas(miembros, { excluir, importante = true, ahora } = {}) {
  return miembros
    .filter((m) => m.uid && m.uid !== excluir && quiereAviso(m, { importante, ahora }))
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

// ---------------------------------------------------------------------------
// Inventario bajo (la misma regla vive en la app; deben quedar idénticas)
// ---------------------------------------------------------------------------

/** Se avisa cuando lo que queda alcanza para estos días o menos. */
export const DIAS_AVISO_INVENTARIO = 5;

/** Mínimo absoluto de unidades, y umbral de los medicamentos "según necesidad". */
export const UNIDADES_AVISO_INVENTARIO = 5;

/** Días entre dos fechas ISO yyyy-mm-dd (hasta − desde; sin zona horaria). */
function diasEntreIso(desde, hasta) {
  const utc = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(hasta) - utc(desde)) / 86_400_000);
}

/**
 * Cómo va el inventario del medicamento en la fecha local `hoyIso`:
 * { nivel: 'ok' | 'bajo' | 'agotado', unidades, alDia, dias } (`dias` = para cuántos días alcanza;
 * null si es según necesidad). Devuelve null si no aplica: no se controla el inventario, está
 * suspendido o el tratamiento ya terminó.
 */
export function estadoInventario(m, hoyIso) {
  if (typeof m?.inventario !== 'number' || !Number.isFinite(m.inventario)) return null;
  if (m.activo === false) return null;
  const duracion = Number(m.duracionDias);
  const fin = m.inicio && duracion > 0 ? sumarDiasIso(m.inicio, duracion) : null; // exclusivo
  if (fin && hoyIso >= fin) return null;

  const unidades = Math.max(0, m.inventario); // datos antiguos pudieron quedar en -1
  const alDia = m.segunNecesidad ? 0 : (m.horarios ?? []).length;
  const dias = alDia > 0 ? Math.floor(unidades / alDia) : null;
  const estado = (nivel) => ({ nivel, unidades, alDia, dias });

  // Tratamiento con fin: si lo que hay alcanza para los días que faltan, no hace falta resurtir.
  // Hoy no se cuenta: parte de sus dosis ya se descontó y aquí no se sabe cuáles (contarlo completo
  // daba avisos falsos con un surtido exacto, p. ej. 21 pastillas para 7 días de 3 al día).
  if (fin && alDia > 0) {
    const desde = hoyIso >= m.inicio ? sumarDiasIso(hoyIso, 1) : m.inicio;
    const faltanDosis = Math.max(0, diasEntreIso(desde, fin)) * alDia;
    if (unidades >= faltanDosis) return estado('ok');
  }
  const umbral = Math.max(UNIDADES_AVISO_INVENTARIO, alDia * DIAS_AVISO_INVENTARIO);
  return estado(unidades === 0 ? 'agotado' : unidades <= umbral ? 'bajo' : 'ok');
}

const GRAVEDAD_INVENTARIO = { bajo: 1, agotado: 2 };

/**
 * Decide si un cambio en el medicamento amerita aviso de inventario. `antes` / `despues` son los
 * datos del documento (undefined al crear / al borrar) y `estado` el nivel del último aviso guardado.
 * Devuelve { avisar, estado }: qué avisar ahora ('bajo' | 'agotado' | null) y el estado a guardar.
 * Solo se avisa cuando el nivel empeora por una baja real del inventario (una toma o una corrección
 * hacia abajo). El estado guardado solo mejora al resurtir o cuando el responsable corrige el
 * inventario a mano desde el formulario (la app marca `editadoEn` al guardar): deshacer tomas (una
 * o varias) lo conserva, para que volver a marcarlas no repita el aviso.
 */
export function avisoInventario({ antes, despues, estado, hoyIso }) {
  const e = despues ? estadoInventario(despues, hoyIso) : null;
  // Borrado, suspendido, terminado o sin control de inventario: no aplica y el aviso se rearma
  if (!e) return { avisar: null, estado: null };
  const inv = (x) =>
    typeof x?.inventario === 'number' && Number.isFinite(x.inventario) ? x.inventario : null;
  const nivel = GRAVEDAD_INVENTARIO[e.nivel] ? e.nivel : null;
  const previo = estado ?? null;
  const gravedad = (n) => GRAVEDAD_INVENTARIO[n] ?? 0;
  const masGrave = gravedad(nivel) >= gravedad(previo) ? nivel : previo;
  const a = inv(antes);
  const d = inv(despues);

  // Alta o empezar a controlar el inventario: quien lo capturó ya sabe cuánto hay
  if (a === null) return { avisar: null, estado: nivel };
  // Baja real. Reparar a 0 un negativo antiguo también cuenta: de ese agotado nunca se avisó
  if (d < a || (a < 0 && d === 0)) {
    return { avisar: gravedad(nivel) > gravedad(previo) ? nivel : null, estado: masGrave };
  }
  // Se editó otra cosa (más horarios, otra duración, reactivar): no se anota el nivel nuevo, para
  // que la siguiente toma sí avise; si con el cambio mejoró, el aviso se rearma
  if (d === a) return { avisar: null, estado: gravedad(nivel) < gravedad(previo) ? nivel : previo };
  // +1 sin resurtido ni edición = se deshizo una toma: se conserva lo ya avisado
  const resurtido =
    d - a >= 2 ||
    antes.ultimoResurtido !== despues.ultimoResurtido ||
    !mismoInstante(antes.editadoEn, despues.editadoEn);
  if (!resurtido) return { avisar: null, estado: masGrave };
  // Resurtido o corrección a mano: el aviso se rearma (o queda en 'bajo' si hay poco, sin avisar)
  return { avisar: null, estado: nivel };
}

/** Compara dos marcas de tiempo (Timestamp de Firestore, número o texto); ausentes en ambos = iguales. */
function mismoInstante(a, b) {
  const valor = (x) => (x && typeof x.toMillis === 'function' ? x.toMillis() : (x ?? null));
  return valor(a) === valor(b);
}

/** Aviso de inventario bajo o agotado (`estado` = resultado de estadoInventario). */
export function mensajeInventario({ personaNombre, medicamento, estado }) {
  const med = nombreMedicamento(medicamento);
  if (estado.nivel === 'agotado') {
    return {
      titulo: `⚠️ ${personaNombre}: se acabó un medicamento`,
      cuerpo: `Ya no quedan unidades de ${med}. Actualiza el inventario cuando lo resurtan.`,
    };
  }
  const quedan = `${estado.unidades === 1 ? 'Queda' : 'Quedan'} ${estado.unidades} de ${med}`;
  const alcance =
    estado.dias === null
      ? ' (según necesidad).'
      : estado.dias === 0
        ? ': no alcanza para un día completo.'
        : `: alcanza para ${estado.dias} ${estado.dias === 1 ? 'día' : 'días'}.`;
  return { titulo: `${personaNombre}: queda poco medicamento`, cuerpo: `${quedan}${alcance}` };
}

/**
 * Quién recibe el aviso de inventario: responsables y familiares (son quienes resurten), según sus
 * preferencias de avisos; "agotado" cuenta como importante y "queda poco" no. Enfermeros y médicos
 * no lo reciben.
 */
export function destinatariosInventario(miembros, { importante = true, ahora } = {}) {
  return miembros
    .filter(
      (m) =>
        m.uid &&
        (m.rol === 'cuidador_principal' || m.rol === 'familiar') &&
        quiereAviso(m, { importante, ahora }),
    )
    .map((m) => m.uid);
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

// ---------------------------------------------------------------------------
// Citas del calendario (eventos_calendario): aviso previo
// ---------------------------------------------------------------------------

/** Anticipación del aviso cuando la cita no dice (AVISO_CITA_MIN_POR_DEFECTO en la app) */
export const AVISO_CITAS_MIN = 60;
/** Anticipación máxima que se admite (una semana): acota la consulta del calendario */
export const AVISO_CITAS_MAX_MIN = 7 * 24 * 60;

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Milisegundos de un Timestamp de Firestore, Date o número; null si no es una fecha. */
function milisDe(valor) {
  if (valor == null) return null;
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === 'number') return valor;
  if (typeof valor.seconds === 'number') return valor.seconds * 1000;
  return null;
}

/**
 * Citas y terapias cuyo inicio se acerca: faltan entre 1 y `avisarMin` minutos (AVISO_CITAS_MIN si
 * la cita no dice; 0 = sin aviso). Los turnos (versiones anteriores) no avisan.
 * Devuelve [{ evento, faltanMin }].
 */
export function citasProximas(eventos, ahoraMs) {
  const salida = [];
  for (const ev of eventos ?? []) {
    if (!ev?.id || ev.tipo === 'turno') continue;
    const inicioMs = milisDe(ev.inicio);
    if (inicioMs === null) continue;
    const avisar = ev.avisarMin == null ? AVISO_CITAS_MIN : Number(ev.avisarMin);
    if (!(avisar > 0)) continue;
    const faltan = Math.ceil((inicioMs - ahoraMs) / 60000);
    if (faltan <= 0 || faltan > avisar) continue;
    salida.push({ evento: ev, faltanMin: faltan });
  }
  return salida;
}

/** "en 1 min", "en 45 min", "en 1 h", "en 1 h 30 min", "en 1 día", "en 2 días". */
export function textoFaltan(min) {
  if (min <= 1) return 'en 1 min';
  if (min < 60) return `en ${min} min`;
  if (min < 1440) {
    const h = Math.floor(min / 60);
    const resto = min % 60;
    return resto ? `en ${h} h ${resto} min` : `en ${h} h`;
  }
  const dias = Math.round(min / 1440);
  return `en ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** "hoy a las 10:00", "mañana a las 10:00" o "el 27 oct a las 10:00" (partes de partesEnZona). */
export function cuandoCita(inicio, ahora) {
  const hhmm = `${String(inicio.hora).padStart(2, '0')}:${String(inicio.minuto).padStart(2, '0')}`;
  if (inicio.fecha === ahora.fecha) return `hoy a las ${hhmm}`;
  if (inicio.fecha === sumarDiasIso(ahora.fecha, 1)) return `mañana a las ${hhmm}`;
  return `el ${Number(inicio.d)} ${MESES_CORTOS[Number(inicio.m) - 1]} a las ${hhmm}`;
}

/**
 * Aviso de cita: "Lupe: en 1 h · Cita" / "Cardiólogo hoy a las 10:00 · Hospital Ángeles · acompaña
 * Sofía · Llevar el reporte". `inicio` y `ahora` son partes de partesEnZona.
 */
export function mensajeCita({ personaNombre, evento, faltanMin, inicio, ahora, acompana }) {
  const clase = evento.tipo === 'terapia' ? 'Terapia' : 'Cita';
  const partes = [`${evento.titulo} ${cuandoCita(inicio, ahora)}`];
  if (evento.lugar) partes.push(evento.lugar);
  if (acompana) partes.push(`acompaña ${acompana}`);
  if (evento.notas) partes.push(evento.notas);
  return {
    titulo: `${personaNombre}: ${textoFaltan(faltanMin)} · ${clase}`,
    cuerpo: recortar(partes.join(' · ')),
  };
}

/**
 * Quién recibe el aviso de una cita: quien está de guardia (como los demás recordatorios), más
 * quien acompaña (siempre) y el responsable y los familiares que reciben avisos del equipo (una
 * cita cuenta como importante), para que la familia se entere aunque no esté de guardia.
 */
export function destinatariosCita(miembros, evento, ahora) {
  const uids = new Set(deGuardia(miembros, ahora));
  for (const m of miembros) {
    if (!m.uid) continue;
    if (m.uid === evento.responsableUid) {
      uids.add(m.uid);
    } else if (
      ['cuidador_principal', 'familiar'].includes(m.rol) &&
      quiereAviso(m, { importante: true, ahora })
    ) {
      uids.add(m.uid);
    }
  }
  return [...uids];
}
