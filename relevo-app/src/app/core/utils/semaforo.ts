/**
 * Semáforo del día: resume lo pendiente (tomas y tareas de la rutina) en un solo color, para
 * entenderlo de un vistazo con el teléfono apoyado en un mueble.
 *   - rojo: algo se pasó de su hora hace poco y sigue sin registrarse (todavía se puede dar)
 *   - amarillo: algo está por tocar (dentro de su aviso), es su hora, o quedó algo viejo sin
 *     registrar (ya no es urgente darlo, pero hay que anotar qué pasó)
 *   - verde: nada urgente; se muestra lo que sigue
 * Funciones puras (sin Angular ni Firebase) para poder probarlas.
 */

/** Minutos de anticipación con los que un pendiente sin `avisarMin` pone el semáforo en amarillo. */
export const AVISO_MIN_POR_DEFECTO = 15;

/** Minutos de tolerancia después de la hora (o del fin del rango) antes de pasar a rojo. */
export const GRACIA_MIN = 15;

/**
 * Minutos después de la hora tras los que un atrasado pasa a "sin registrar": la ventana de los
 * recordatorios ya cerró (functions/logica.js, RECORDATORIO.hastaMin) y el semáforo deja de estar
 * en rojo toda la noche por una dosis de la mañana. Sigue pendiente de anotar.
 */
export const SIN_REGISTRAR_MIN = 120;

export type ColorSemaforo = 'verde' | 'amarillo' | 'rojo';

/** Dónde está un pendiente respecto a su hora. */
export type FaseSemaforo = 'atrasado' | 'sin_registrar' | 'ahora' | 'pronto' | 'despues';

/** Lo mínimo que el semáforo necesita saber de un pendiente (sin registro todavía). */
export interface PendienteSemaforo {
  hora: Date;
  /** Tareas con rango ("ejercicio de 10 a 11"): mientras dura es "ahora", no "atrasado" */
  duracionMin?: number | null;
  /** Minutos antes de la hora desde los que cuenta como "pronto" */
  avisarMin?: number | null;
}

export interface EstadoSemaforo<T extends PendienteSemaforo> {
  color: ColorSemaforo;
  /** El pendiente que manda: el atrasado más antiguo, el que toca ahora o el que sigue; null si no queda nada */
  principal: T | null;
  fase: FaseSemaforo | null;
  /** Los demás pendientes del día, por hora */
  resto: { pendiente: T; fase: FaseSemaforo }[];
  /** Pasados de su hora hace poco (todavía urge darlos) */
  atrasados: number;
  /** Pasados de su hora hace más de SIN_REGISTRAR_MIN: hay que anotar qué pasó */
  sinRegistrar: number;
}

const MIN = 60_000;

export function faseDe(p: PendienteSemaforo, ahora: Date): FaseSemaforo {
  const t = ahora.getTime();
  const inicio = p.hora.getTime();
  const fin = inicio + Math.max(0, p.duracionMin ?? 0) * MIN;
  if (t >= fin + SIN_REGISTRAR_MIN * MIN) return 'sin_registrar';
  if (t >= fin + GRACIA_MIN * MIN) return 'atrasado';
  if (t >= inicio) return 'ahora';
  if (t >= inicio - (p.avisarMin ?? AVISO_MIN_POR_DEFECTO) * MIN) return 'pronto';
  return 'despues';
}

/** Lo viejo sin registrar va al final: lo que manda es lo que toca ahora o lo que sigue */
const URGENCIA: Record<FaseSemaforo, number> = {
  atrasado: 0,
  ahora: 1,
  pronto: 1,
  despues: 2,
  sin_registrar: 3,
};

/** Estado del semáforo con los pendientes de hoy (solo los que aún no tienen registro). */
export function estadoSemaforo<T extends PendienteSemaforo>(
  pendientes: T[],
  ahora: Date,
): EstadoSemaforo<T> {
  const lista = pendientes
    .map((pendiente) => ({ pendiente, fase: faseDe(pendiente, ahora) }))
    // Primero lo más urgente; dentro de cada grupo, por hora (el atrasado más antiguo va primero)
    .sort(
      (a, b) =>
        URGENCIA[a.fase] - URGENCIA[b.fase] ||
        a.pendiente.hora.getTime() - b.pendiente.hora.getTime(),
    );
  const atrasados = lista.filter((x) => x.fase === 'atrasado').length;
  const sinRegistrar = lista.filter((x) => x.fase === 'sin_registrar').length;
  const primero = lista[0] ?? null;
  const color: ColorSemaforo =
    atrasados > 0
      ? 'rojo'
      : (primero && primero.fase !== 'despues') || sinRegistrar > 0
        ? 'amarillo'
        : 'verde';
  return {
    color,
    principal: primero?.pendiente ?? null,
    fase: primero?.fase ?? null,
    resto: lista.slice(1).sort((a, b) => a.pendiente.hora.getTime() - b.pendiente.hora.getTime()),
    atrasados,
    sinRegistrar,
  };
}

/** "5 min", "2 h", "2 h 15 min" (mínimo "1 min"). */
export function textoMinutos(min: number): string {
  const n = Math.max(1, Math.round(min));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** "en 10 min", "hace 35 min" o "ahora", según la hora del pendiente. */
export function cuandoEs(hora: Date, ahora: Date): string {
  const min = Math.round((hora.getTime() - ahora.getTime()) / MIN);
  if (min === 0) return 'ahora';
  return min > 0 ? `en ${textoMinutos(min)}` : `hace ${textoMinutos(-min)}`;
}
