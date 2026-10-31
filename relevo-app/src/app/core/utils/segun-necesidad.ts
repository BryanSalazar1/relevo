/**
 * Medicamentos según necesidad con indicación del médico ("si hay dolor, máximo 3 al día, cada 8 h").
 *
 * La app no decide nada clínico: guarda la indicación tal como la dio el médico, la recuerda al dar
 * la dosis, avisa (sin impedir) si se pasa del máximo o del intervalo, y resume para el médico
 * cuántas veces y por qué se usó. Funciones puras, probadas en segun-necesidad.spec.ts.
 */
import { formatDate } from '@angular/common';
import { Medicamento, MotivoToma, Toma } from '../models';

/** Límites que puede capturar el responsable (mismos topes en firestore.rules). */
export const LIMITES_SEGUN_NECESIDAD = {
  condicion: 80,
  maxAlDia: { min: 1, max: 24 },
  horasEntreTomas: { min: 1, max: 72 },
} as const;

/** Sin intervalo indicado, una toma a menos de esta distancia de otra sugiere un registro repetido. */
export const TOMA_REPETIDA_MIN = 60;

const HORA = 3_600_000;

/** Cuándo ocurrió una toma: la hora real si se dio, si no la programada. */
export function momentoToma(t: Pick<Toma, 'horaReal' | 'horaProgramada'>): Date {
  return (t.horaReal ?? t.horaProgramada).toDate();
}

const mismoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Si hay dolor · máximo 3 al día · cada 8 h", o '' si el medicamento no tiene indicación. */
export function textoIndicacion(m: Pick<Medicamento, 'condicion' | 'maxAlDia' | 'horasEntreTomas'>): string {
  const partes: string[] = [];
  const condicion = m.condicion?.trim();
  if (condicion) partes.push(condicion.charAt(0).toUpperCase() + condicion.slice(1));
  if (m.maxAlDia) partes.push(`máximo ${m.maxAlDia} al día`);
  if (m.horasEntreTomas) partes.push(`cada ${m.horasEntreTomas} h`);
  return partes.join(' · ');
}

/** Cómo quedaría una toma nueva respecto a la indicación del médico. */
export interface RevisionToma {
  /** Tomas dadas hoy (antes de esta) */
  tomadasHoy: number;
  maxAlDia: number | null;
  /** Horas desde la última toma dada; null si no hay */
  horasDesdeUltima: number | null;
  /** Con esta, se pasaría del máximo al día */
  excedeMaximo: boolean;
  /** Se daría antes del intervalo indicado */
  antesDeTiempo: boolean;
  /** Sin intervalo indicado: hay otra toma de hace menos de una hora (¿registro repetido?) */
  posibleRepetida: boolean;
  /** Avisos para quien da la dosis, del más importante al menos */
  avisos: string[];
}

/** "3 h", "1 h 20 min", "45 min". */
function textoHoras(horas: number): string {
  const min = Math.max(1, Math.round(horas * 60));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/**
 * Revisa una toma nueva de un medicamento según necesidad contra su indicación. `tomas` son las
 * tomas recientes de ese medicamento (basta con las de hoy y las de las últimas `horasEntreTomas`).
 */
export function revisarNuevaToma(
  m: Pick<Medicamento, 'maxAlDia' | 'horasEntreTomas'>,
  tomas: Toma[],
  ahora: Date,
): RevisionToma {
  const dadas = tomas.filter((t) => t.tomado).map(momentoToma).filter((d) => d.getTime() <= ahora.getTime());
  const tomadasHoy = dadas.filter((d) => mismoDia(d, ahora)).length;
  const ultima = dadas.length ? new Date(Math.max(...dadas.map((d) => d.getTime()))) : null;
  const horasDesdeUltima = ultima ? (ahora.getTime() - ultima.getTime()) / HORA : null;
  const maxAlDia = m.maxAlDia ?? null;
  const intervalo = m.horasEntreTomas ?? null;

  const excedeMaximo = maxAlDia !== null && tomadasHoy >= maxAlDia;
  const antesDeTiempo = intervalo !== null && horasDesdeUltima !== null && horasDesdeUltima < intervalo;
  const posibleRepetida =
    intervalo === null && horasDesdeUltima !== null && horasDesdeUltima * 60 < TOMA_REPETIDA_MIN;

  const avisos: string[] = [];
  if (excedeMaximo) {
    avisos.push(`Hoy ya van ${tomadasHoy} de ${maxAlDia} permitidas. Consulta al médico antes de dar otra.`);
  }
  if (antesDeTiempo) {
    avisos.push(`La última fue hace ${textoHoras(horasDesdeUltima!)}; la indicación es cada ${intervalo} h.`);
  }
  if (posibleRepetida) {
    avisos.push('Ya hay una toma de hace menos de una hora: revisa que no sea un registro repetido.');
  }
  return { tomadasHoy, maxAlDia, horasDesdeUltima, excedeMaximo, antesDeTiempo, posibleRepetida, avisos };
}

/** "Hoy van 2 de 3" o "Hoy van 2" (sin máximo), para Hoy y para la confirmación. */
export function textoHoy(tomadasHoy: number, maxAlDia: number | null | undefined): string {
  return maxAlDia ? `Hoy van ${tomadasHoy} de ${maxAlDia}` : `Hoy van ${tomadasHoy}`;
}

/** Lo que el médico necesita saber de un medicamento según necesidad en el periodo. */
export interface ResumenCondicional {
  /** Tomas dadas en el periodo */
  tomas: number;
  porMotivo: Record<MotivoToma, number>;
  /** Promedio de la intensidad del dolor anotada (0-10); null si no se anotó */
  intensidadPromedio: number | null;
  /** Días en que se dieron más que el máximo indicado */
  diasSobreMaximo: { fecha: Date; tomas: number }[];
  /** Tomas dadas antes del intervalo indicado respecto a la anterior */
  antesDeTiempo: number;
}

export function resumenCondicional(
  m: Pick<Medicamento, 'maxAlDia' | 'horasEntreTomas'>,
  tomas: Toma[],
): ResumenCondicional {
  const dadas = tomas.filter((t) => t.tomado).sort((a, b) => momentoToma(a).getTime() - momentoToma(b).getTime());
  const porMotivo: Record<MotivoToma, number> = { dolor: 0, fiebre: 0, otro: 0 };
  const intensidades: number[] = [];
  const porDia = new Map<string, { fecha: Date; tomas: number }>();
  let antesDeTiempo = 0;
  dadas.forEach((t, i) => {
    if (t.motivo) porMotivo[t.motivo] += 1;
    if (typeof t.intensidad === 'number') intensidades.push(t.intensidad);
    const d = momentoToma(t);
    const clave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const dia = porDia.get(clave) ?? { fecha: d, tomas: 0 };
    dia.tomas += 1;
    porDia.set(clave, dia);
    if (i > 0 && m.horasEntreTomas) {
      const horas = (d.getTime() - momentoToma(dadas[i - 1]).getTime()) / HORA;
      if (horas < m.horasEntreTomas) antesDeTiempo += 1;
    }
  });
  const max = m.maxAlDia ?? null;
  return {
    tomas: dadas.length,
    porMotivo,
    intensidadPromedio: intensidades.length
      ? Math.round((intensidades.reduce((a, b) => a + b, 0) / intensidades.length) * 10) / 10
      : null,
    diasSobreMaximo: max ? [...porDia.values()].filter((d) => d.tomas > max) : [],
    antesDeTiempo,
  };
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** "5 tomas: 4 por dolor (intensidad promedio 6/10), 1 por fiebre". */
export function textoUso(r: ResumenCondicional): string {
  if (!r.tomas) return 'Sin tomas en el periodo';
  const motivos: string[] = [];
  if (r.porMotivo.dolor) {
    motivos.push(
      `${r.porMotivo.dolor} por dolor${r.intensidadPromedio !== null ? ` (intensidad promedio ${r.intensidadPromedio}/10)` : ''}`,
    );
  }
  if (r.porMotivo.fiebre) motivos.push(`${r.porMotivo.fiebre} por fiebre`);
  if (r.porMotivo.otro) motivos.push(`${r.porMotivo.otro} por otro motivo`);
  return `${r.tomas} ${plural(r.tomas, 'toma', 'tomas')}${motivos.length ? `: ${motivos.join(', ')}` : ''}`;
}

/** Lo que conviene comentar con el médico: excesos sobre su indicación. */
export function textosExceso(
  nombre: string,
  m: Pick<Medicamento, 'maxAlDia' | 'horasEntreTomas' | 'condicion'>,
  r: ResumenCondicional,
): string[] {
  const quien = m.condicion?.trim() ? `${nombre} (${m.condicion.trim()})` : nombre;
  const textos: string[] = [];
  for (const d of r.diasSobreMaximo) {
    textos.push(`${quien}: el ${formatDate(d.fecha, 'd MMM', 'es')} se dieron ${d.tomas}, más del máximo de ${m.maxAlDia} al día`);
  }
  if (r.antesDeTiempo) {
    textos.push(
      `${quien}: ${r.antesDeTiempo} ${plural(r.antesDeTiempo, 'toma', 'tomas')} con menos de ${m.horasEntreTomas} h desde la anterior`,
    );
  }
  return textos;
}
