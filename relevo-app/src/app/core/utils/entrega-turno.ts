/**
 * Entrega de turno: qué pasó "desde tu último turno", calculado de forma determinista con los datos
 * que Hoy ya lee (agenda del día, bitácora y signos vitales). Sin IA. Funciones puras, probadas en
 * entrega-turno.spec.ts.
 */
import { formatDate } from '@angular/common';
import { EntradaBitacora, RANGOS_SIGNO, SignoVital, TIPOS_SIGNO, Turno } from '../models';
import { FilaDia } from './agenda-dia';
import { GRACIA_MIN } from './semaforo';

const HORA_MS = 3_600_000;
/** Sin turnos definidos se resumen las últimas 8 horas. */
export const VENTANA_SIN_TURNOS_MS = 8 * HORA_MS;
/** Tope de la ventana: si el turno anterior fue hace días, se resumen como mucho 3 días. */
export const VENTANA_MAX_MS = 72 * HORA_MS;
/** Cuántas líneas se muestran en la tarjeta antes de "ver más". */
export const MAX_LINEAS_ENTREGA = 6;

export interface OpcionesInicio {
  turnos?: Turno[] | null;
  ahora: Date;
  /** Última vez que esta persona abrió la bitácora en este dispositivo (localStorage) */
  ultimaVisita?: Date | null;
}

const minutosDe = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Instante de un día (a medianoche) más `min` minutos. */
function enDia(dia: Date, min: number): Date {
  const d = new Date(dia);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(min);
  return d;
}

interface Tramo {
  inicio: Date;
  fin: Date;
}

/** Los tramos de guardia de los últimos días (un turno nocturno termina al día siguiente). */
function tramosRecientes(turnos: Turno[], ahora: Date, dias = 8): Tramo[] {
  const tramos: Tramo[] = [];
  for (let k = -dias; k <= 0; k++) {
    const dia = new Date(ahora);
    dia.setHours(0, 0, 0, 0);
    dia.setDate(dia.getDate() + k);
    for (const t of turnos) {
      if (!t?.dias?.includes(dia.getDay())) continue;
      const desde = minutosDe(t.desde);
      const hasta = minutosDe(t.hasta);
      if (Number.isNaN(desde) || Number.isNaN(hasta)) continue;
      const inicio = enDia(dia, desde);
      // Nocturno (hasta <= desde): termina al día siguiente
      const fin = hasta > desde ? enDia(dia, hasta) : enDia(dia, hasta + 24 * 60);
      tramos.push({ inicio, fin });
    }
  }
  return tramos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/**
 * Cuándo terminó el turno anterior del usuario: el último tramo que acabó antes de ahora o, si está
 * de guardia en este momento, antes de que empezara su turno actual. null si no hay turnos previos.
 */
export function finTurnoAnterior(turnos: Turno[], ahora: Date): Date | null {
  const tramos = tramosRecientes(turnos, ahora);
  const actual = tramos.find((t) => t.inicio.getTime() <= ahora.getTime() && ahora.getTime() < t.fin.getTime());
  const limite = actual ? actual.inicio.getTime() : ahora.getTime();
  let fin: Date | null = null;
  for (const t of tramos) {
    if (t.fin.getTime() <= limite && (!fin || t.fin.getTime() > fin.getTime())) fin = t.fin;
  }
  return fin;
}

/**
 * Desde cuándo se resume: el fin del turno anterior (con turnos) o las últimas 8 horas; nunca más
 * de 3 días atrás; y si la última visita es más reciente, desde esa visita.
 */
export function inicioEntrega({ turnos, ahora, ultimaVisita }: OpcionesInicio): Date {
  const porDefecto = new Date(ahora.getTime() - VENTANA_SIN_TURNOS_MS);
  let desde = turnos?.length ? (finTurnoAnterior(turnos, ahora) ?? porDefecto) : porDefecto;
  const tope = new Date(ahora.getTime() - VENTANA_MAX_MS);
  if (desde.getTime() < tope.getTime()) desde = tope;
  if (ultimaVisita && ultimaVisita.getTime() > desde.getTime() && ultimaVisita.getTime() <= ahora.getTime()) {
    desde = ultimaVisita;
  }
  return desde;
}

export type TipoNovedad =
  | 'toma_omitida'
  | 'toma_vencida'
  | 'tarea_omitida'
  | 'tarea_vencida'
  | 'sintoma'
  | 'incidente'
  | 'signo'
  | 'nota'
  | 'indicacion';

export interface Novedad {
  tipo: TipoNovedad;
  hora: Date;
  /** Una línea: "Losartán 08:00 no tomada" */
  texto: string;
  /** Quién lo registró o escribió, si se sabe */
  quien?: string;
  icono: string;
  color: string;
}

export interface DatosEntrega {
  desde: Date;
  ahora: Date;
  /** Filas de la agenda de los días que cubre la ventana (tomas y tareas) */
  filas: FilaDia[];
  entradas: EntradaBitacora[];
  signos: SignoVital[];
  /** Para no contar como "de otra persona" las notas propias */
  miUid: string | null;
}

/** "Glucosa 210 mg/dL". */
export function textoSigno(s: Pick<SignoVital, 'tipo' | 'valor' | 'valorSecundario'>): string {
  const info = TIPOS_SIGNO.find((t) => t.valor === s.tipo);
  const valor = s.valorSecundario != null ? `${s.valor}/${s.valorSecundario}` : `${s.valor}`;
  return `${info?.corto ?? s.tipo} ${valor} ${info?.unidad ?? ''}`.trim();
}

/** El rango habitual si la medición queda fuera de él ("70–180"), o null si está dentro o no tiene rango. */
export function fueraDeRango(s: Pick<SignoVital, 'tipo' | 'valor' | 'valorSecundario'>): string | null {
  const r = RANGOS_SIGNO[s.tipo];
  if (!r) return null;
  const principalFuera = s.valor < r.min || s.valor > r.max;
  const secundariaFuera =
    s.valorSecundario != null &&
    r.minSecundario != null &&
    r.maxSecundario != null &&
    (s.valorSecundario < r.minSecundario || s.valorSecundario > r.maxSecundario);
  if (!principalFuera && !secundariaFuera) return null;
  return r.minSecundario != null ? `${r.min}–${r.max}/${r.minSecundario}–${r.maxSecundario}` : `${r.min}–${r.max}`;
}

const enVentana = (d: Date, desde: Date, ahora: Date) =>
  d.getTime() >= desde.getTime() && d.getTime() <= ahora.getTime();

const recortar = (texto: string, max = 90) => {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
};

/**
 * Lo relevante de la ventana, de lo más reciente a lo más antiguo: dosis no tomadas o vencidas sin
 * registro, tareas no hechas o vencidas, síntomas e incidentes, signos fuera de rango y la última
 * nota escrita por otra persona. Las indicaciones del médico van siempre primero.
 */
export function novedadesEntrega({ desde, ahora, filas, entradas, signos, miUid }: DatosEntrega): Novedad[] {
  const lista: Novedad[] = [];
  const gracia = GRACIA_MIN * 60_000;

  for (const f of filas) {
    if (f.aDemanda) continue;
    const toma = f.tipo === 'toma';
    if (f.registrado && f.hecho === false) {
      // Cuenta cuando se registró (una "no tomada" de la mañana puede marcarse en la noche)
      const hora = f.registradoEn ?? f.horaReal ?? f.hora;
      if (!enVentana(hora, desde, ahora) && !enVentana(f.hora, desde, ahora)) continue;
      lista.push({
        tipo: toma ? 'toma_omitida' : 'tarea_omitida',
        hora,
        texto: `${f.titulo} ${f.horario}: ${toma ? 'no tomada' : 'no hecha'}${f.nota ? ` · ${f.nota}` : ''}`,
        quien: f.quien,
        icono: toma ? 'medkit-outline' : f.icono,
        color: 'danger',
      });
    } else if (!f.registrado && enVentana(f.hora, desde, ahora)) {
      const fin = f.hora.getTime() + Math.max(0, f.duracionMin ?? 0) * 60_000;
      if (ahora.getTime() < fin + gracia) continue;
      lista.push({
        tipo: toma ? 'toma_vencida' : 'tarea_vencida',
        hora: f.hora,
        texto: `${f.titulo} ${f.horario}: sin registrar`,
        icono: toma ? 'medkit-outline' : f.icono,
        color: 'warning',
      });
    }
  }

  for (const e of entradas) {
    const hora = e.fecha.toDate();
    if (!enVentana(hora, desde, ahora)) continue;
    if (e.tipo === 'indicacion') {
      lista.push({
        tipo: 'indicacion',
        hora,
        texto: `Indicación médica: ${recortar(e.texto)}`,
        quien: e.autorNombre,
        icono: 'document-text-outline',
        color: 'primary',
      });
      continue;
    }
    if (e.tipo !== 'sintoma' && e.tipo !== 'incidente') continue;
    lista.push({
      tipo: e.tipo,
      hora,
      texto: `${e.tipo === 'incidente' ? 'Incidente' : 'Síntoma'}: ${recortar(e.texto)}`,
      quien: e.autorNombre,
      icono: e.tipo === 'incidente' ? 'warning-outline' : 'medical-outline',
      color: 'danger',
    });
  }

  for (const s of signos) {
    const hora = s.fecha.toDate();
    if (!enVentana(hora, desde, ahora)) continue;
    const rango = fueraDeRango(s);
    if (!rango) continue;
    lista.push({
      tipo: 'signo',
      hora,
      texto: `${textoSigno(s)} (habitual ${rango})`,
      icono: 'pulse-outline',
      color: 'warning',
    });
  }

  const notaDeOtro = entradas
    .filter((e) => e.tipo === 'nota' && e.autorUid !== miUid && enVentana(e.fecha.toDate(), desde, ahora))
    .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())[0];
  if (notaDeOtro) {
    lista.push({
      tipo: 'nota',
      hora: notaDeOtro.fecha.toDate(),
      texto: `Nota: ${recortar(notaDeOtro.texto)}`,
      quien: notaDeOtro.autorNombre,
      icono: 'chatbox-ellipses-outline',
      color: 'medium',
    });
  }

  return lista.sort(
    (a, b) =>
      Number(b.tipo === 'indicacion') - Number(a.tipo === 'indicacion') ||
      b.hora.getTime() - a.hora.getTime(),
  );
}

/** "desde ayer 22:00", "desde hoy 06:00" o "desde el 10 oct 16:00", para el subtítulo de la tarjeta. */
export function textoDesde(desde: Date, ahora: Date): string {
  const mismoDia = desde.toDateString() === ahora.toDateString();
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  const hora = formatDate(desde, 'HH:mm', 'es');
  if (mismoDia) return `desde hoy ${hora}`;
  if (desde.toDateString() === ayer.toDateString()) return `desde ayer ${hora}`;
  return `desde el ${formatDate(desde, 'd MMM HH:mm', 'es')}`;
}
