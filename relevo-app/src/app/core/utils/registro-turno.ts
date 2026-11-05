/**
 * Quién puede registrar ahora (tomas, tareas, bitácora y signos) según su rol y sus turnos:
 *   - Responsable: siempre.
 *   - Enfermero/a: solo dentro de su turno y hasta TOLERANCIA_TURNO_MIN después (por si quien sigue
 *     llega tarde). Sin turnos asignados no registra.
 *   - Familiar: solo si el responsable le dio permiso (`puedeRegistrar`).
 *   - Médico: no registra (escribe indicaciones médicas aparte).
 *   - En pausa: nadie registra.
 * Las rules lo exigen con `franjas` (franjasDeTurnos), que el responsable guarda junto con los turnos.
 * Funciones puras, probadas en registro-turno.spec.ts.
 */
import { Miembro, Rol, Turno } from '../models';
import { HORA_VALIDA, duracionTurno, minutosDe } from './turnos';

/** Minutos después del fin del turno en que todavía se puede registrar. */
export const TOLERANCIA_TURNO_MIN = 30;
/** Minutos antes del fin del turno en que se ofrece dejar una nota para quien sigue. */
export const AVISO_FIN_TURNO_MIN = 30;
/**
 * Las rules miden la hora en franjas de 15 minutos de la semana (0 = domingo 00:00–00:15), en hora del
 * centro de México (UTC−6 todo el año desde 2022). Una franja cuenta si se toca con el turno, así que
 * en el servidor se puede empezar hasta 14 minutos antes; la app muestra la hora exacta.
 */
export const FRANJA_MIN = 15;
const DIA_MIN = 24 * 60;
const SEMANA_MIN = 7 * DIA_MIN;
const FRANJAS_SEMANA = SEMANA_MIN / FRANJA_MIN;

const turnoValido = (t: Turno | null | undefined): t is Turno =>
  !!t && Array.isArray(t.dias) && HORA_VALIDA.test(t.desde) && HORA_VALIDA.test(t.hasta);

const diasValidos = (t: Turno) => [...new Set(t.dias)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

/**
 * Franjas de 15 min de la semana en que el miembro puede registrar: cada turno más la tolerancia.
 * Ordenadas y sin repetir (máximo 672 = toda la semana). Las guarda el responsable con los turnos.
 */
export function franjasDeTurnos(turnos: Turno[] | null | undefined): number[] {
  const franjas = new Set<number>();
  for (const t of turnos ?? []) {
    if (!turnoValido(t)) continue;
    const duracion = duracionTurno(t) + TOLERANCIA_TURNO_MIN;
    for (const d of diasValidos(t)) {
      const inicio = d * DIA_MIN + minutosDe(t.desde);
      const fin = inicio + duracion;
      for (let k = Math.floor(inicio / FRANJA_MIN); k * FRANJA_MIN < fin; k++) {
        franjas.add(((k % FRANJAS_SEMANA) + FRANJAS_SEMANA) % FRANJAS_SEMANA);
      }
    }
  }
  return [...franjas].sort((a, b) => a - b);
}

/** Franja de 15 min de un momento, como la calcula el servidor (para pruebas y comparación). */
export function franjaDe(dia: number, minutosDelDia: number): number {
  return dia * (DIA_MIN / FRANJA_MIN) + Math.floor(minutosDelDia / FRANJA_MIN);
}

interface Tramo {
  inicio: number;
  fin: number;
}

/**
 * Los turnos como tramos en minutos relativos al domingo 00:00 de la semana de `ahora`, incluidas la
 * semana anterior y la siguiente (un turno del sábado en la noche sigue el domingo). Los tramos
 * seguidos o encimados se unen: 08–16 y 16–24 son una sola guardia que termina a las 24.
 */
function tramosSemana(turnos: Turno[]): Tramo[] {
  const tramos: Tramo[] = [];
  for (const t of turnos) {
    if (!turnoValido(t)) continue;
    const duracion = duracionTurno(t);
    for (const d of diasValidos(t)) {
      for (const semana of [-1, 0, 1]) {
        const inicio = semana * SEMANA_MIN + d * DIA_MIN + minutosDe(t.desde);
        tramos.push({ inicio, fin: inicio + duracion });
      }
    }
  }
  const unidos: Tramo[] = [];
  for (const t of tramos.sort((a, b) => a.inicio - b.inicio)) {
    const ultimo = unidos.at(-1);
    if (ultimo && t.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, t.fin);
    else unidos.push({ ...t });
  }
  return unidos;
}

export type MotivoSinRegistro = 'pausa' | 'medico' | 'sin_permiso' | 'sin_turnos' | 'fuera_de_turno';

export interface EstadoRegistro {
  /** Puede registrar en este momento */
  puede: boolean;
  /** Por qué no puede (null si puede) */
  motivo: MotivoSinRegistro | null;
  /** Fin del turno actual (sin la tolerancia); null si no aplica */
  finTurno: Date | null;
  /** Hasta cuándo puede registrar (fin del turno + tolerancia) */
  registraHasta: Date | null;
  /** Faltan AVISO_FIN_TURNO_MIN o menos para el fin, o ya está en la tolerancia: se ofrece la nota */
  porAcabar: boolean;
  /** Ya pasó el fin del turno y está en la tolerancia */
  enTolerancia: boolean;
  /** Cuándo terminó su último turno (fuera de turno), para el aviso */
  ultimoFin: Date | null;
  /** Cuándo empieza su siguiente turno (fuera de turno) */
  proximoInicio: Date | null;
}

const VACIO: Omit<EstadoRegistro, 'puede' | 'motivo'> = {
  finTurno: null,
  registraHasta: null,
  porAcabar: false,
  enTolerancia: false,
  ultimoFin: null,
  proximoInicio: null,
};

/**
 * Estado de registro de un miembro en `ahora` (hora del dispositivo, igual que los turnos en Equipo).
 * `miembro` = su documento en la persona (turnos, pausa y permiso); `rol` = su rol ahí.
 */
export function estadoRegistro(
  rol: Rol | null | undefined,
  miembro: Pick<Miembro, 'turnos' | 'pausado' | 'puedeRegistrar'> | null | undefined,
  ahora: Date,
): EstadoRegistro {
  const no = (motivo: MotivoSinRegistro, extra: Partial<EstadoRegistro> = {}): EstadoRegistro => ({
    ...VACIO,
    ...extra,
    puede: false,
    motivo,
  });
  if (!rol) return no('sin_permiso');
  if (miembro?.pausado === true) return no('pausa');
  if (rol === 'cuidador_principal') return { ...VACIO, puede: true, motivo: null };
  if (rol === 'medico') return no('medico');
  if (rol === 'familiar') {
    return miembro?.puedeRegistrar === true ? { ...VACIO, puede: true, motivo: null } : no('sin_permiso');
  }

  // Enfermero/a: depende de sus turnos
  const turnos = (miembro?.turnos ?? []).filter(turnoValido);
  if (!turnos.length) return no('sin_turnos');
  const domingo = new Date(ahora);
  domingo.setHours(0, 0, 0, 0);
  domingo.setDate(domingo.getDate() - domingo.getDay());
  const aFecha = (min: number) => {
    const d = new Date(domingo);
    d.setMinutes(min);
    return d;
  };
  const minAhora = (ahora.getTime() - domingo.getTime()) / 60_000;
  const tramos = tramosSemana(turnos);
  const actual = tramos.find((t) => t.inicio <= minAhora && minAhora < t.fin + TOLERANCIA_TURNO_MIN);
  if (actual) {
    const faltan = actual.fin - minAhora;
    return {
      ...VACIO,
      puede: true,
      motivo: null,
      finTurno: aFecha(actual.fin),
      registraHasta: aFecha(actual.fin + TOLERANCIA_TURNO_MIN),
      porAcabar: faltan <= AVISO_FIN_TURNO_MIN,
      enTolerancia: faltan <= 0,
    };
  }
  const anterior = tramos.filter((t) => t.fin + TOLERANCIA_TURNO_MIN <= minAhora).at(-1);
  const siguiente = tramos.find((t) => t.inicio > minAhora);
  return no('fuera_de_turno', {
    ultimoFin: anterior ? aFecha(anterior.fin) : null,
    proximoInicio: siguiente ? aFecha(siguiente.inicio) : null,
  });
}

/** Texto del aviso cuando no puede registrar ("" si puede). */
export function textoSinRegistro(e: EstadoRegistro, ahora: Date): string {
  const hora = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const cuando = (d: Date) => {
    const dias = Math.round(
      (new Date(d).setHours(0, 0, 0, 0) - new Date(ahora).setHours(0, 0, 0, 0)) / (DIA_MIN * 60_000),
    );
    if (dias === 0) return `hoy a las ${hora(d)}`;
    if (dias === 1) return `mañana a las ${hora(d)}`;
    const nombre = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getDay()];
    return `el ${nombre} a las ${hora(d)}`;
  };
  switch (e.motivo) {
    case null:
      return '';
    case 'pausa':
      return 'El responsable te puso en pausa: puedes ver todo, pero no registrar.';
    case 'medico':
      return 'Como médico lees todo y escribes indicaciones médicas.';
    case 'sin_permiso':
      return 'Puedes ver todo. Para registrar, el responsable tiene que darte permiso en Equipo.';
    case 'sin_turnos':
      return 'Aún no tienes turnos asignados. Pide al responsable que te los asigne en Equipo para poder registrar.';
    case 'fuera_de_turno': {
      const reciente = e.ultimoFin && ahora.getTime() - e.ultimoFin.getTime() < 12 * 3_600_000;
      const inicio = reciente ? `Tu turno terminó a las ${hora(e.ultimoFin!)}.` : 'Estás fuera de tu turno.';
      const proximo = e.proximoInicio ? ` Tu próximo turno empieza ${cuando(e.proximoInicio)}.` : '';
      return `${inicio} Puedes ver todo, pero solo registras durante tu turno.${proximo}`;
    }
  }
}
