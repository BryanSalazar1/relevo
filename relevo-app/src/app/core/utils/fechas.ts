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
