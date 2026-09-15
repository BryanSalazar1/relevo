import { formatDate } from '@angular/common';

export function inicioDeDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sumarDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Clave local yyyy-mm-dd (no UTC) para agrupar por día. */
export function claveDia(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

/** Edad en años a partir de una fecha ISO yyyy-mm-dd; null si no hay fecha válida. */
export function edad(fechaIso?: string | null): number | null {
  if (!fechaIso) return null;
  const n = new Date(`${fechaIso}T00:00:00`);
  if (isNaN(n.getTime())) return null;
  const hoy = new Date();
  let e = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) e--;
  return e;
}

/** "Hoy", "Ayer" o "martes 8 de septiembre". */
export function etiquetaDia(d: Date): string {
  const hoy = claveDia(new Date());
  const ayer = claveDia(sumarDias(new Date(), -1));
  const clave = claveDia(d);
  if (clave === hoy) return 'Hoy';
  if (clave === ayer) return 'Ayer';
  const texto = formatDate(d, "EEEE d 'de' MMMM", 'es');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Rango legible: "3 – 10 de septiembre de 2026". */
export function etiquetaRango(desde: Date, hastaExclusivo: Date): string {
  const fin = sumarDias(hastaExclusivo, -1);
  const mismoMes = desde.getMonth() === fin.getMonth() && desde.getFullYear() === fin.getFullYear();
  if (mismoMes) {
    return `${desde.getDate()} – ${formatDate(fin, "d 'de' MMMM 'de' y", 'es')}`;
  }
  return `${formatDate(desde, "d 'de' MMM", 'es')} – ${formatDate(fin, "d 'de' MMM 'de' y", 'es')}`;
}

const CORTO_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

/** "Todos los días", "L, X, V y D" o "Solo los domingos", a partir de Date.getDay(). */
export function textoDias(dias?: number[] | null): string {
  const unicos = new Set((dias ?? []).filter((d) => d >= 0 && d <= 6));
  if (unicos.size === 0 || unicos.size === 7) return 'Todos los días';
  const cortos = ORDEN_SEMANA.filter((d) => unicos.has(d)).map((d) => CORTO_DIA[d]);
  if (cortos.length === 1) return `Solo los ${['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][[...unicos][0]]}`;
  return `${cortos.slice(0, -1).join(', ')} y ${cortos[cortos.length - 1]}`;
}

/** "L, M, X, J y V 08:00–16:00 · S y D 09:00–13:00", o "Sin turnos" si no hay. */
export function textoTurnos(turnos?: { dias: number[]; desde: string; hasta: string }[] | null): string {
  if (!turnos?.length) return 'Sin turnos';
  return turnos.map((t) => `${textoDias(t.dias)} ${t.desde}–${t.hasta}`).join(' · ');
}

/** true si la tarea aplica ese día de la semana (sin días definidos = todos). */
export function tareaEnDia(dias: number[] | undefined | null, dia: Date): boolean {
  return !dias?.length || dias.includes(dia.getDay());
}

/** "11:00" = "10:00" + 60 min (da la vuelta a medianoche). */
export function horaFin(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h || 0) * 60 + (m || 0) + minutos) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "10:00–11:00", o "10:00" si la tarea no tiene duración. */
export function rangoHorario(hhmm: string, duracionMin?: number | null): string {
  return duracionMin && duracionMin > 0 ? `${hhmm}–${horaFin(hhmm, duracionMin)}` : hhmm;
}

/** "45 min", "1 h", "1 h 30 min". */
export function textoDuracion(min?: number | null): string {
  if (!min || min <= 0) return 'Solo hora de inicio';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** "hace 5 min", "hace 3 h", "ayer 22:10" o "8 sep 07:30", para la última toma. */
export function haceCuanto(d: Date, ahora = new Date()): string {
  const min = Math.max(0, Math.round((ahora.getTime() - d.getTime()) / 60000));
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (claveDia(d) === claveDia(ahora)) return `hace ${Math.floor(min / 60)} h (${formatDate(d, 'HH:mm', 'es')})`;
  if (claveDia(d) === claveDia(sumarDias(ahora, -1))) return `ayer ${formatDate(d, 'HH:mm', 'es')}`;
  return formatDate(d, 'd MMM HH:mm', 'es');
}

/** yyyy-MM-ddTHH:mm en hora local, el formato que espera ion-datetime. */
export function aIsoLocal(d: Date): string {
  return formatDate(d, "yyyy-MM-dd'T'HH:mm", 'es');
}

export interface GrupoDia<T> {
  clave: string;
  dia: Date;
  items: T[];
}

/** Agrupa conservando el orden de entrada. */
export function agruparPorDia<T>(items: T[], fechaDe: (t: T) => Date): GrupoDia<T>[] {
  const grupos: GrupoDia<T>[] = [];
  const porClave = new Map<string, GrupoDia<T>>();
  for (const item of items) {
    const fecha = fechaDe(item);
    const clave = claveDia(fecha);
    let g = porClave.get(clave);
    if (!g) {
      g = { clave, dia: inicioDeDia(fecha), items: [] };
      porClave.set(clave, g);
      grupos.push(g);
    }
    g.items.push(item);
  }
  return grupos;
}
