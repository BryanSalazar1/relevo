/**
 * Agenda del día: une las tomas programadas de medicamentos y las tareas de la rutina en una sola
 * lista cronológica, y de ahí saca lo que necesitan la pantalla Hoy y el semáforo (pendientes,
 * estado y avance). Funciones puras (sin Angular ni Firebase) para poder probarlas.
 */
import { formatDate } from '@angular/common';
import { TIPO_TAREA_INFO } from '../models';
import { DosisProgramada } from '../services/medicamentos.service';
import { TareaProgramada } from '../services/tareas.service';
import { horaFin, rangoHorario } from './fechas';
import { EstadoSemaforo, FaseSemaforo, PendienteSemaforo, cuandoEs } from './semaforo';

/** Hasta cuántos días atrás se puede navegar la agenda del día (lo anterior está en el reporte). */
export const DIAS_ATRAS_MAX = 90;

/** Lo que comparten una toma y una tarea cuando se pintan en la lista del día. */
interface BaseFila extends PendienteSemaforo {
  /** Única en el día: `toma-{medId}-{idToma}` o `tarea-{tareaId}-{idRegistro}` */
  clave: string;
  /** "08:00" o "10:00–11:00" */
  horario: string;
  /** "a las 08:00" o "de 10:00 a 11:00" (para frases: "Era a las 08:00") */
  horarioTexto: string;
  titulo: string;
  /** Dosis o tipo de tarea, con las notas del plan */
  detalle: string;
  icono: string;
  /** Color de Ionic del tipo (tomas: primary; tareas: el de su tipo) */
  colorTipo: string;
  /** Ya tiene registro (tomada / no tomada, hecha / no hecha) */
  registrado: boolean;
  /** true si se tomó / se hizo, false si no, null sin registro */
  hecho: boolean | null;
  /** Toma según necesidad ya registrada: no estaba programada */
  aDemanda: boolean;
  quien?: string;
  nota?: string;
  horaReal?: Date;
  /** Cuándo se registró (una "no tomada" de las 08:00 puede registrarse a las 20:55) */
  registradoEn?: Date;
}

/** Fecha de un Timestamp de Firestore; undefined si no viene o aún no lo asignó el servidor. */
function fechaDe(valor: unknown): Date | undefined {
  const t = valor as { toDate?: () => Date } | null | undefined;
  return t && typeof t.toDate === 'function' ? t.toDate() : undefined;
}

/** Una fila de la agenda del día. */
export type FilaDia = BaseFila &
  ({ tipo: 'toma'; dosis: DosisProgramada } | { tipo: 'tarea'; programada: TareaProgramada });

export const TITULO_FASE: Record<FaseSemaforo, string> = {
  atrasado: 'Atrasado',
  sin_registrar: 'Sin registrar',
  ahora: 'Es hora',
  pronto: 'Ya casi',
  despues: 'Todo al día',
};

function filaDeDosis(d: DosisProgramada): FilaDia {
  const horario = formatDate(d.hora, 'HH:mm', 'es');
  return {
    tipo: 'toma',
    dosis: d,
    clave: `toma-${d.medicamento.id}-${d.idToma}`,
    hora: d.hora,
    horario,
    horarioTexto: `a las ${horario}`,
    titulo: d.medicamento.nombre,
    detalle: [d.medicamento.dosis, d.medicamento.notas].filter(Boolean).join(' · '),
    icono: 'medkit-outline',
    colorTipo: 'primary',
    registrado: !!d.toma,
    hecho: d.toma ? d.toma.tomado : null,
    aDemanda: d.aDemanda === true,
    quien: d.toma?.registradoNombre,
    nota: d.toma?.nota,
    horaReal: fechaDe(d.toma?.horaReal),
    registradoEn: fechaDe(d.toma?.registradoEn),
  };
}

function filaDeTarea(t: TareaProgramada): FilaDia {
  const info = TIPO_TAREA_INFO[t.tarea.tipo] ?? TIPO_TAREA_INFO['otro'];
  const dura = t.tarea.duracionMin && t.tarea.duracionMin > 0 ? t.tarea.duracionMin : null;
  return {
    tipo: 'tarea',
    programada: t,
    clave: `tarea-${t.tarea.id}-${t.idRegistro}`,
    hora: t.hora,
    horario: rangoHorario(t.horario, dura),
    horarioTexto: dura ? `de ${t.horario} a ${horaFin(t.horario, dura)}` : `a las ${t.horario}`,
    titulo: t.tarea.nombre,
    detalle: [info.etiqueta, t.tarea.notas].filter(Boolean).join(' · '),
    icono: info.icono,
    colorTipo: info.color,
    registrado: !!t.registro,
    hecho: t.registro ? t.registro.hecha : null,
    aDemanda: false,
    quien: t.registro?.registradoNombre,
    nota: t.registro?.nota,
    horaReal: fechaDe(t.registro?.horaReal),
    registradoEn: fechaDe(t.registro?.registradoEn),
    duracionMin: dura,
    avisarMin: t.tarea.avisarMin,
  };
}

/** Todas las filas del día (tomas y tareas), por hora; a la misma hora, primero los medicamentos. */
export function filasDelDia(dosis: DosisProgramada[], tareas: TareaProgramada[]): FilaDia[] {
  return [...dosis.map(filaDeDosis), ...tareas.map(filaDeTarea)].sort(
    (a, b) =>
      a.hora.getTime() - b.hora.getTime() ||
      Number(a.tipo === 'tarea') - Number(b.tipo === 'tarea') ||
      a.titulo.localeCompare(b.titulo),
  );
}

/** Lo que sigue sin registrar (las tomas según necesidad no cuentan: no estaban programadas). */
export function pendientesDelDia(filas: FilaDia[]): FilaDia[] {
  return filas.filter((f) => !f.registrado && !f.aDemanda);
}

/** Cuánto de lo programado ya tiene registro. */
export function avanceDia(filas: FilaDia[]): { total: number; registradas: number } {
  const programadas = filas.filter((f) => !f.aDemanda);
  return {
    total: programadas.length,
    registradas: programadas.filter((f) => f.registrado).length,
  };
}

/** "Atrasado", "Es hora", "Ya casi", "Todo al día" o "3 atrasados". */
export function tituloEstado(e: EstadoSemaforo<PendienteSemaforo>): string {
  if (e.atrasados > 1) return `${e.atrasados} atrasados`;
  // Nada urgente pero quedó algo viejo sin anotar: el título lo dice, aunque "manda" lo que sigue
  const soloViejo = !e.fase || e.fase === 'despues' || e.fase === 'sin_registrar';
  if (e.atrasados === 0 && e.sinRegistrar > 0 && soloViejo) return `${e.sinRegistrar} sin registrar`;
  return TITULO_FASE[e.fase ?? 'despues'];
}

/** "Era a las 08:00 · hace 35 min", "A las 14:00 · en 10 min" o "De 10:00 a 11:00" (si es ahora). */
export function textoCuando(e: EstadoSemaforo<FilaDia>, ahora: Date): string {
  const p = e.principal;
  if (!p) return '';
  const horario =
    e.fase === 'atrasado' || e.fase === 'sin_registrar'
      ? `Era ${p.horarioTexto}`
      : p.horarioTexto.charAt(0).toUpperCase() + p.horarioTexto.slice(1);
  const falta = cuandoEs(p.hora, ahora);
  return falta === 'ahora' ? horario : `${horario} · ${falta}`;
}
