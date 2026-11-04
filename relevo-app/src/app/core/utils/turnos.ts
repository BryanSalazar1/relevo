/**
 * Turnos de guardia: validación, textos y cobertura del equipo. Funciones puras, probadas en
 * turnos.spec.ts. Un turno con `desde === hasta` dura 24 h ("todo el día"); se guarda como
 * 00:00–00:00, que el servidor (functions/logica.js, enTurno) ya interpreta así.
 */
import { DIAS_SEMANA, Miembro, PUEDE_REGISTRAR_TOMAS, Turno } from '../models';
import { textoDias } from './fechas';

/** "HH:mm" de 00:00 a 23:59. */
export const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

const DIA_MIN = 24 * 60;

export const minutosDe = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Las 24 horas: misma hora de inicio y fin. */
export function esTodoElDia(t: Pick<Turno, 'desde' | 'hasta'>): boolean {
  return !!t.desde && t.desde === t.hasta;
}

/** Termina al día siguiente (p. ej. 22:00–06:00); un turno de 24 h no cuenta. */
export function cruzaMedianoche(t: Pick<Turno, 'desde' | 'hasta'>): boolean {
  return !!t.desde && !!t.hasta && t.hasta < t.desde;
}

/** Duración en minutos (24 h si es todo el día). */
export function duracionTurno(t: Pick<Turno, 'desde' | 'hasta'>): number {
  const d = minutosDe(t.hasta) - minutosDe(t.desde);
  return d > 0 ? d : d + DIA_MIN;
}

/** "8 h", "7 h 30 min", "24 h". */
export function textoDuracionTurno(t: Pick<Turno, 'desde' | 'hasta'>): string {
  const min = duracionTurno(t);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "L, M, X, J y V 08:00–16:00", "Todos los días, las 24 h" o "S y D 22:00–06:00 (termina al día siguiente)". */
export function textoTurno(t: Turno): string {
  if (esTodoElDia(t)) return `${textoDias(t.dias)}, las 24 h`;
  return `${textoDias(t.dias)} ${t.desde}–${t.hasta}${cruzaMedianoche(t) ? ' (termina al día siguiente)' : ''}`;
}

/** Todos los turnos de un miembro en una línea, o "Sin turnos". */
export function textoTurnos(turnos?: Turno[] | null): string {
  if (!turnos?.length) return 'Sin turnos';
  return turnos.map(textoTurno).join(' · ');
}

/** Tramos de guardia dentro de cada día (0–6): un nocturno se parte en dos días. */
function tramosPorDia(t: Turno): { dia: number; desde: number; hasta: number }[] {
  if (!HORA_VALIDA.test(t.desde) || !HORA_VALIDA.test(t.hasta)) return [];
  const desde = minutosDe(t.desde);
  const hasta = minutosDe(t.hasta);
  const tramos: { dia: number; desde: number; hasta: number }[] = [];
  for (const dia of new Set(t.dias)) {
    if (desde < hasta) tramos.push({ dia, desde, hasta });
    else {
      tramos.push({ dia, desde, hasta: DIA_MIN });
      if (hasta > 0) tramos.push({ dia: (dia + 1) % 7, desde: 0, hasta });
    }
  }
  return tramos;
}

/**
 * Día de la semana (0–6) en el que dos turnos del mismo miembro se pisan, o null si ninguno. Un turno
 * nocturno (hasta < desde) ocupa de `desde` a medianoche ese día y de medianoche a `hasta` el siguiente.
 */
export function turnosTraslapados(turnos: Turno[]): number | null {
  const tramos = turnos.flatMap((t, turno) => tramosPorDia(t).map((x) => ({ ...x, turno })));
  for (let a = 0; a < tramos.length; a++) {
    for (let b = a + 1; b < tramos.length; b++) {
      const x = tramos[a];
      const y = tramos[b];
      if (x.turno === y.turno || x.dia !== y.dia) continue;
      if (x.desde < y.hasta && y.desde < x.hasta) return x.dia;
    }
  }
  return null;
}

/** Horas de un día sin nadie de guardia, en minutos [desde, hasta). */
export interface Hueco {
  desde: number;
  hasta: number;
}

/**
 * Huecos de la semana: para cada día (0–6), los tramos en que ningún turno del equipo cubre. null si
 * nadie tiene turnos (entonces todos reciben los recordatorios y no hay huecos que mostrar).
 */
export function huecosCobertura(turnosEquipo: (Turno[] | null | undefined)[]): Hueco[][] | null {
  const turnos = turnosEquipo.flatMap((t) => t ?? []);
  if (!turnos.length) return null;
  const cubierto = Array.from({ length: 7 }, () => new Uint8Array(DIA_MIN));
  for (const t of turnos) {
    for (const { dia, desde, hasta } of tramosPorDia(t)) cubierto[dia].fill(1, desde, hasta);
  }
  return cubierto.map((dia) => {
    const huecos: Hueco[] = [];
    for (let m = 0; m < DIA_MIN; m++) {
      if (dia[m]) continue;
      const inicio = m;
      while (m < DIA_MIN && !dia[m]) m++;
      huecos.push({ desde: inicio, hasta: m });
    }
    return huecos;
  });
}

/**
 * "L, M, X, J y V 00:00–08:00 y 16:00–24:00 · S y D todo el día", agrupando los días con los mismos
 * huecos; "" si siempre hay alguien de guardia.
 */
export function textoHuecos(huecos: Hueco[][]): string {
  const grupos = new Map<string, number[]>();
  for (const { valor } of DIAS_SEMANA) {
    const lista = huecos[valor];
    if (!lista.length) continue;
    const clave =
      lista.length === 1 && lista[0].desde === 0 && lista[0].hasta === DIA_MIN
        ? 'todo el día'
        : lista.map((h) => `${hhmm(h.desde)}–${hhmm(h.hasta)}`).join(' y ');
    grupos.set(clave, [...(grupos.get(clave) ?? []), valor]);
  }
  const nombreDe = (d: number) => {
    const nombre = DIAS_SEMANA.find((x) => x.valor === d)!.nombre;
    return nombre.charAt(0).toUpperCase() + nombre.slice(1);
  };
  return [...grupos]
    .map(([horas, dias]) => `${dias.length === 1 ? nombreDe(dias[0]) : textoDias(dias)} ${horas}`)
    .join(' · ');
}

/**
 * Turnos de quienes reciben los recordatorios de la guardia (como deGuardia en functions/logica.js):
 * los que registran tomas, no apagaron sus recordatorios y no están en pausa. El médico no hace guardias.
 */
export function turnosQueCubren(
  miembros: Pick<Miembro, 'rol' | 'turnos' | 'recordatorios' | 'pausado'>[],
): Turno[][] {
  return miembros
    .filter((m) => PUEDE_REGISTRAR_TOMAS.includes(m.rol) && m.recordatorios !== false && m.pausado !== true)
    .map((m) => m.turnos ?? []);
}

/**
 * Una línea sobre la cobertura de la semana, o null si nadie tiene turnos (entonces los
 * recordatorios llegan a todos los que registran).
 */
export function resumenCobertura(turnosEquipo: (Turno[] | null | undefined)[]): string | null {
  const huecos = huecosCobertura(turnosEquipo);
  if (!huecos) return null;
  const texto = textoHuecos(huecos);
  if (!texto) return 'Siempre hay alguien de guardia.';
  return `Sin nadie de guardia: ${texto}. En esas horas los recordatorios le llegan al responsable.`;
}
