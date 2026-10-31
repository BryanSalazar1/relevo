/**
 * Hoja para la consulta: lo que un médico de primer contacto o geriatra usa de verdad en una
 * consulta corta, calculado a partir de lo que ya registra Relevo. Funciones puras, probadas en
 * hoja-consulta.spec.ts. Los umbrales siguen guías clínicas (ver README, "Hoja para la consulta"):
 * presión en casa (ESH), hipoglucemia (ADA), pérdida de peso (AAFP), caídas (CDC STEADI) y el
 * umbral histórico de adherencia del 80 %.
 */
import { formatDate } from '@angular/common';
import {
  EntradaBitacora,
  MOMENTO_GLUCOSA_ETIQUETA,
  MomentoGlucosa,
  SignoVital,
  Toma,
} from '../models';

export const UMBRALES_HOJA = {
  /** Una lectura así amerita atención el mismo día */
  presionUrgente: { sistolica: 180, diastolica: 110 },
  /** Hipoglucemia nivel 1 (ADA) */
  glucosaBaja: 70,
  glucosaAlta: 180,
  glucosaMuyAlta: 250,
  /** Pérdida de peso que amerita evaluación (AAFP: 5 % en 6 a 12 meses) */
  perdidaPesoPorcentaje: 5,
  /** Tendencia a la baja que conviene mencionar aunque no llegue al 5 % */
  perdidaPesoAviso: 3,
  fiebre: 38,
  oxigenacionBaja: 92,
  pulso: { min: 50, max: 100 },
  /** Umbral histórico de adherencia (Haynes, 1980) que usan las medidas de calidad */
  adherenciaMinima: 80,
  /** Días que abarca el promedio de presión (la última semana con lecturas) */
  diasPresion: 7,
} as const;

const ms = (s: SignoVital) => s.fecha.toMillis();
const porFecha = (a: SignoVital, b: SignoVital) => ms(a) - ms(b);
const redondear = (n: number, decimales = 0) => Math.round(n * 10 ** decimales) / 10 ** decimales;
const promedio = (xs: number[], decimales = 0) =>
  redondear(xs.reduce((a, b) => a + b, 0) / xs.length, decimales);
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

// ---------------------------------------------------------------------------
// Presión arterial: promedio de la última semana con lecturas, no mínimo y máximo del mes
// ---------------------------------------------------------------------------
export interface ResumenPresion {
  /** Lecturas que entraron al promedio */
  n: number;
  dias: number;
  sistolica: number;
  diastolica: number;
  desde: Date;
  hasta: Date;
  /** Lecturas del periodo de 180/110 o más */
  urgentes: number;
  /** Lecturas con sistólica de 90 o menos (peligro según NEWS2) */
  bajas: number;
  /** Meta en casa con que se juzgó el promedio (135/85; 145/85 desde los 80 años) */
  meta: { sistolica: number; diastolica: number };
  /** El promedio está por arriba de 135/85 */
  alto: boolean;
}

export function promedioPresion(
  signos: SignoVital[],
  dias: number = UMBRALES_HOJA.diasPresion,
  edad?: number | null,
): ResumenPresion | null {
  const lecturas = signos.filter((s) => s.tipo === 'presion' && s.valorSecundario != null).sort(porFecha);
  if (!lecturas.length) return null;
  const ultima = lecturas[lecturas.length - 1];
  const limite = ms(ultima) - dias * 86_400_000;
  const ventana = lecturas.filter((s) => ms(s) > limite);
  const sistolica = promedio(ventana.map((s) => s.valor));
  const diastolica = promedio(ventana.map((s) => s.valorSecundario as number));
  const u = UMBRALES_HOJA;
  return {
    n: ventana.length,
    dias,
    sistolica,
    diastolica,
    desde: ventana[0].fecha.toDate(),
    hasta: ultima.fecha.toDate(),
    urgentes: lecturas.filter(
      (s) => s.valor >= u.presionUrgente.sistolica || (s.valorSecundario as number) >= u.presionUrgente.diastolica,
    ).length,
    bajas: lecturas.filter((s) => s.valor <= 90).length,
    meta: metaPresion(edad),
    alto: sistolica >= metaPresion(edad).sistolica || diastolica >= metaPresion(edad).diastolica,
  };
}

// ---------------------------------------------------------------------------
// Glucosa: primero las hipoglucemias, luego el patrón por momento del día
// ---------------------------------------------------------------------------
export interface ResumenGlucosa {
  n: number;
  promedio: number;
  /** Por debajo de 70 */
  bajas: number;
  /** Por arriba de 180 */
  altas: number;
  /** Por arriba de 250 */
  muyAltas: number;
  porMomento: { momento: MomentoGlucosa; etiqueta: string; n: number; promedio: number }[];
  /** Lecturas sin momento (anteriores a que se capturara) */
  sinMomento: number;
}

const ORDEN_MOMENTOS: MomentoGlucosa[] = ['ayunas', 'despues_comer', 'antes_dormir', 'otro'];

export function resumenGlucosa(signos: SignoVital[]): ResumenGlucosa | null {
  const lecturas = signos.filter((s) => s.tipo === 'glucosa');
  if (!lecturas.length) return null;
  const u = UMBRALES_HOJA;
  const grupos = new Map<MomentoGlucosa, number[]>();
  for (const s of lecturas) {
    if (s.momento) grupos.set(s.momento, [...(grupos.get(s.momento) ?? []), s.valor]);
  }
  return {
    n: lecturas.length,
    promedio: promedio(lecturas.map((s) => s.valor)),
    bajas: lecturas.filter((s) => s.valor < u.glucosaBaja).length,
    altas: lecturas.filter((s) => s.valor > u.glucosaAlta).length,
    muyAltas: lecturas.filter((s) => s.valor > u.glucosaMuyAlta).length,
    porMomento: ORDEN_MOMENTOS.filter((m) => grupos.has(m)).map((m) => ({
      momento: m,
      etiqueta: MOMENTO_GLUCOSA_ETIQUETA[m],
      n: grupos.get(m)!.length,
      promedio: promedio(grupos.get(m)!),
    })),
    sinMomento: lecturas.filter((s) => !s.momento).length,
  };
}

// ---------------------------------------------------------------------------
// Peso: tendencia del periodo en porcentaje
// ---------------------------------------------------------------------------
export interface CambioPeso {
  n: number;
  inicial: number;
  final: number;
  fechaInicial: Date;
  fechaFinal: Date;
  kg: number;
  porcentaje: number;
}

export function cambioPeso(signos: SignoVital[]): CambioPeso | null {
  const pesos = signos.filter((s) => s.tipo === 'peso').sort(porFecha);
  if (pesos.length < 2) return null;
  const a = pesos[0];
  const b = pesos[pesos.length - 1];
  const kg = redondear(b.valor - a.valor, 1);
  return {
    n: pesos.length,
    inicial: a.valor,
    final: b.valor,
    fechaInicial: a.fecha.toDate(),
    fechaFinal: b.fecha.toDate(),
    kg,
    porcentaje: a.valor > 0 ? redondear((kg / a.valor) * 100, 1) : 0,
  };
}

// ---------------------------------------------------------------------------
// Temperatura, oxigenación y pulso: cuántas veces salieron de rango
// ---------------------------------------------------------------------------
export type TipoSimple = 'temperatura' | 'oxigenacion' | 'pulso';

export interface ResumenSimple {
  tipo: TipoSimple;
  n: number;
  min: number;
  max: number;
  promedio: number;
  /** Lecturas fuera del rango que importa (fiebre, oxigenación baja, pulso fuera de 50–100) */
  fuera: number;
}

function fueraDeRango(tipo: TipoSimple, valor: number): boolean {
  const u = UMBRALES_HOJA;
  if (tipo === 'temperatura') return valor >= u.fiebre;
  if (tipo === 'oxigenacion') return valor < u.oxigenacionBaja;
  return valor < u.pulso.min || valor > u.pulso.max;
}

export function resumenSimple(signos: SignoVital[], tipo: TipoSimple): ResumenSimple | null {
  const lecturas = signos.filter((s) => s.tipo === tipo);
  if (!lecturas.length) return null;
  const valores = lecturas.map((s) => s.valor);
  const decimales = tipo === 'temperatura' ? 1 : 0;
  return {
    tipo,
    n: lecturas.length,
    min: Math.min(...valores),
    max: Math.max(...valores),
    promedio: promedio(valores, decimales),
    fuera: valores.filter((v) => fueraDeRango(tipo, v)).length,
  };
}

// ---------------------------------------------------------------------------
// Caídas: las registradas como tales y las que el texto sugiere (registros anteriores a la pregunta)
// ---------------------------------------------------------------------------
export interface ResumenCaidas {
  total: number;
  conLesion: number;
  /** Incidentes sin la pregunta contestada cuyo texto habla de una caída */
  posibles: number;
}

const PATRON_CAIDA = /\bca[ií]d[ao]s?\b|\bse ca(e|y[oó])\b|\bcay[oó]\b|\bresbal|\btropez/i;

export function resumenCaidas(entradas: EntradaBitacora[]): ResumenCaidas {
  const incidentes = entradas.filter((e) => e.tipo === 'incidente');
  return {
    total: incidentes.filter((e) => e.caida === true).length,
    conLesion: incidentes.filter((e) => e.caida === true && e.lesion === true).length,
    posibles: incidentes.filter((e) => typeof e.caida !== 'boolean' && PATRON_CAIDA.test(e.texto)).length,
  };
}

// ---------------------------------------------------------------------------
// Medicamentos: qué dosis se omiten, no solo cuántas
// ---------------------------------------------------------------------------
export interface Omisiones {
  omitidas: number;
  /** "3 de 4 a las 20:00" cuando la mayoría de las omisiones cae en el mismo horario */
  patron: string | null;
}

export function patronOmisiones(tomas: Toma[]): Omisiones {
  const omitidas = tomas.filter((t) => !t.tomado && !t.aDemanda);
  if (!omitidas.length) return { omitidas: 0, patron: null };
  const porHora = new Map<string, number>();
  for (const t of omitidas) {
    const hora = formatDate(t.horaProgramada.toDate(), 'HH:mm', 'es');
    porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
  }
  const [hora, n] = [...porHora.entries()].sort((a, b) => b[1] - a[1])[0];
  const patron = omitidas.length >= 2 && n / omitidas.length >= 0.6 ? `${n} de ${omitidas.length} a las ${hora}` : null;
  return { omitidas: omitidas.length, patron };
}

// ---------------------------------------------------------------------------
// Resumen clínico de los signos y sus filas para pantalla y PDF
// ---------------------------------------------------------------------------
export interface ResumenClinico {
  presion: ResumenPresion | null;
  glucosa: ResumenGlucosa | null;
  peso: CambioPeso | null;
  /** Cuando solo hay un peso en el periodo: ese */
  pesoUnico: SignoVital | null;
  temperatura: ResumenSimple | null;
  oxigenacion: ResumenSimple | null;
  pulso: ResumenSimple | null;
}

export function resumenClinico(signos: SignoVital[], edad?: number | null): ResumenClinico {
  const pesos = signos.filter((s) => s.tipo === 'peso');
  return {
    presion: promedioPresion(signos, UMBRALES_HOJA.diasPresion, edad),
    glucosa: resumenGlucosa(signos),
    peso: cambioPeso(signos),
    pesoUnico: pesos.length === 1 ? pesos[0] : null,
    temperatura: resumenSimple(signos, 'temperatura'),
    oxigenacion: resumenSimple(signos, 'oxigenacion'),
    pulso: resumenSimple(signos, 'pulso'),
  };
}

export interface FilaSigno {
  etiqueta: string;
  resumen: string;
  /** Qué salió de rango ('' si nada) */
  fuera: string;
  alerta: boolean;
}

export function filasSignos(rc: ResumenClinico): FilaSigno[] {
  const u = UMBRALES_HOJA;
  const f = (d: Date) => formatDate(d, 'd MMM', 'es');
  const filas: FilaSigno[] = [];

  if (rc.presion) {
    const p = rc.presion;
    const fuera: string[] = [];
    if (p.alto) fuera.push(`promedio por arriba de ${p.meta.sistolica}/${p.meta.diastolica}`);
    if (p.urgentes) fuera.push(`${p.urgentes} ${plural(p.urgentes, 'lectura', 'lecturas')} de 180/110 o más`);
    filas.push({
      etiqueta: 'Presión arterial',
      resumen: `Promedio de la última semana con lecturas: ${p.sistolica}/${p.diastolica} mmHg (${p.n} ${plural(p.n, 'lectura', 'lecturas')}, ${f(p.desde)} a ${f(p.hasta)})`,
      fuera: fuera.join(' · '),
      alerta: p.alto || p.urgentes > 0,
    });
  }
  if (rc.glucosa) {
    const g = rc.glucosa;
    const momentos = g.porMomento.map((m) => `${m.etiqueta.toLowerCase()} ${m.promedio} (${m.n})`);
    if (g.sinMomento && g.porMomento.length) momentos.push(`sin momento ${g.sinMomento}`);
    const fuera: string[] = [];
    if (g.bajas) fuera.push(`${g.bajas} por debajo de ${u.glucosaBaja}`);
    if (g.altas) {
      fuera.push(`${g.altas} por arriba de ${u.glucosaAlta}${g.muyAltas ? ` (${g.muyAltas} de más de ${u.glucosaMuyAlta})` : ''}`);
    }
    filas.push({
      etiqueta: 'Glucosa',
      resumen: `Promedio ${g.promedio} mg/dL (${g.n} ${plural(g.n, 'lectura', 'lecturas')})${momentos.length ? `: ${momentos.join(', ')}` : ''}`,
      fuera: fuera.join(' · '),
      alerta: g.bajas > 0 || g.muyAltas > 0,
    });
  }
  if (rc.peso) {
    const p = rc.peso;
    const signo = p.kg > 0 ? '+' : '';
    const perdida = -p.porcentaje;
    const fuera =
      perdida >= u.perdidaPesoPorcentaje
        ? `pérdida de ${perdida} % en el periodo`
        : perdida >= u.perdidaPesoAviso
          ? `tendencia a la baja (${perdida} %)`
          : '';
    filas.push({
      etiqueta: 'Peso',
      resumen: `${p.inicial} → ${p.final} kg (${signo}${p.kg} kg, ${signo}${p.porcentaje} %; ${f(p.fechaInicial)} a ${f(p.fechaFinal)})`,
      fuera,
      alerta: perdida >= u.perdidaPesoPorcentaje,
    });
  } else if (rc.pesoUnico) {
    filas.push({
      etiqueta: 'Peso',
      resumen: `${rc.pesoUnico.valor} kg (un solo registro; con dos se ve la tendencia)`,
      fuera: '',
      alerta: false,
    });
  }
  const simple = (r: ResumenSimple | null, etiqueta: string, resumen: (r: ResumenSimple) => string, queFuera: string) => {
    if (!r) return;
    filas.push({
      etiqueta,
      resumen: resumen(r),
      fuera: r.fuera ? `${r.fuera} ${queFuera}` : '',
      alerta: r.fuera > 0,
    });
  };
  simple(rc.temperatura, 'Temperatura', (r) => `Máxima ${r.max} °C, promedio ${r.promedio} (${r.n})`, `de ${u.fiebre} °C o más`);
  simple(rc.oxigenacion, 'Oxigenación', (r) => `Mínima ${r.min} %, promedio ${r.promedio} (${r.n})`, `por debajo de ${u.oxigenacionBaja} %`);
  simple(rc.pulso, 'Pulso', (r) => `Promedio ${r.promedio} lpm, de ${r.min} a ${r.max} (${r.n})`, `fuera de ${u.pulso.min}–${u.pulso.max}`);
  return filas;
}

// ---------------------------------------------------------------------------
// Cambios respecto a la propia persona, leídos con la zona clínica (31/10/2026)
//
// Una lectura se juzga en tres pasos:
//   1. Zona clínica fija (guías): peligro, baja, sana o alta. Lo peligroso se avisa siempre.
//   2. Lo habitual de la persona (mediana de sus lecturas anteriores) y hacia dónde va el cambio:
//      salir de lo sano o alejarse más es un aviso; volver a lo sano es una buena noticia, nunca una
//      alarma (alguien que llegó con 160 y hoy tiene 122 mejoró, no "está más bajo de lo habitual").
//   3. Si cambió el tratamiento (medicamento nuevo o editado, indicación del médico), lo habitual
//      se vuelve a calcular desde esa fecha: el cambio busca justo mover los números.
// Lo habitual usa mediana y desviación absoluta mediana (MAD), que una sola lectura mal tomada no
// mueve. Aparte, la tendencia compara el promedio de presión de la última semana con el de tres
// semanas antes para ver un empeoramiento lento.
// Rangos: presión en casa 135/85 (145/85 desde los 80 años) y peligro de NEWS2 (≤ 90 sistólica,
// pulso ≤ 40 o ≥ 131, oxigenación ≤ 91 %); glucosa ADA (en ayunas 70–130; hipoglucemia < 70).
// ---------------------------------------------------------------------------
export type ZonaClinica = 'peligro_bajo' | 'baja' | 'sana' | 'alta' | 'peligro_alto';
export type TipoCambio = 'presion' | 'glucosa' | 'pulso' | 'oxigenacion';

export const CAMBIOS = {
  /** Días previos al periodo que pueden formar lo habitual */
  diasLineaBase: 60,
  /** Lecturas recientes que se revisan: las de la última semana del periodo */
  diasRecientes: 7,
  /** Lecturas mínimas para saber qué es lo habitual */
  minLecturas: 5,
  /** Desviaciones (robustas) a partir de las cuales un cambio es importante */
  z: 2.5,
  /** Por tipo: variación mínima que se supone y diferencia mínima en sus unidades */
  tipos: {
    presion: { piso: 5, minDiferencia: 15 },
    glucosa: { piso: 10, minDiferencia: 30 },
    pulso: { piso: 4, minDiferencia: 15 },
    oxigenacion: { piso: 1, minDiferencia: 3 },
  },
  /** Tendencia de presión: subida o bajada sostenida entre la última semana y tres semanas antes */
  tendencia: { minDiferencia: 10, minLecturas: 3 },
} as const;

/** Meta de presión en casa: 135/85; desde los 80 años, 145/85 (algunas guías la suben en esa edad). */
export function metaPresion(edad: number | null | undefined): { sistolica: number; diastolica: number } {
  return { sistolica: edad != null && edad >= 80 ? 145 : 135, diastolica: 85 };
}

/** Zona clínica de un valor (para la glucosa, según el momento en que se midió). */
export function zonaClinica(
  tipo: TipoCambio,
  valor: number,
  opciones: { edad?: number | null; momento?: MomentoGlucosa | null } = {},
): ZonaClinica {
  switch (tipo) {
    case 'presion': {
      const meta = metaPresion(opciones.edad).sistolica;
      if (valor <= 90) return 'peligro_bajo';
      if (valor >= 180) return 'peligro_alto';
      if (valor <= 100) return 'baja';
      return valor >= meta ? 'alta' : 'sana';
    }
    case 'glucosa': {
      if (valor < 54) return 'peligro_bajo';
      if (valor > 250) return 'peligro_alto';
      if (valor < 70) return 'baja';
      const tope = opciones.momento === 'ayunas' ? 130 : 180;
      return valor > tope ? 'alta' : 'sana';
    }
    case 'pulso':
      if (valor <= 40) return 'peligro_bajo';
      if (valor >= 131) return 'peligro_alto';
      if (valor < 50) return 'baja';
      return valor > 100 ? 'alta' : 'sana';
    case 'oxigenacion':
      if (valor <= 91) return 'peligro_bajo';
      return valor <= 93 ? 'baja' : 'sana';
  }
}

const ORDEN_ZONA: Record<ZonaClinica, number> = { peligro_bajo: -2, baja: -1, sana: 0, alta: 1, peligro_alto: 2 };

export type ClaseCambio = 'salio_del_rango' | 'empeoro' | 'mejoro';

export interface CambioPersonal {
  tipo: TipoCambio;
  clase: ClaseCambio;
  fecha: Date;
  /** "158/96 mmHg", "160 mg/dL en ayunas" */
  valor: string;
  /** "121/78 mmHg": lo habitual (mediana de la línea base), mismo formato */
  habitual: string;
  /** Lecturas que forman lo habitual */
  n: number;
  /** Desviaciones robustas respecto a lo habitual (con signo) */
  z: number;
  direccion: 'alta' | 'baja';
  zona: ZonaClinica;
  zonaHabitual: ZonaClinica;
}

const ETIQUETA_CAMBIO: Record<TipoCambio, string> = {
  presion: 'Presión',
  glucosa: 'Glucosa',
  pulso: 'Pulso',
  oxigenacion: 'Oxigenación',
};

function mediana(xs: number[]): number {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Variación robusta: 1.4826 × la mediana de las distancias a la mediana (equivale a la desviación estándar). */
function variacionRobusta(xs: number[], centro: number): number {
  return 1.4826 * mediana(xs.map((x) => Math.abs(x - centro)));
}

export interface OpcionesCambios {
  edad?: number | null;
  /** Último cambio de tratamiento: lo habitual se calcula solo con lecturas desde esta fecha */
  reinicio?: Date | null;
}

/**
 * Para cada tipo de signo, el cambio más importante de las lecturas recientes respecto a lo habitual
 * en esta persona, leído con su zona clínica. Un empeoramiento o una salida del rango sano gana a
 * una mejoría; entre iguales, el más alejado.
 */
export function cambiosPersonales(
  lineaBase: SignoVital[],
  recientes: SignoVital[],
  opciones: OpcionesCambios = {},
): CambioPersonal[] {
  const desde = opciones.reinicio?.getTime() ?? -Infinity;
  const base = lineaBase.filter((x) => x.fecha.toMillis() >= desde);
  const salida: CambioPersonal[] = [];
  for (const tipo of Object.keys(CAMBIOS.tipos) as TipoCambio[]) {
    const conf = CAMBIOS.tipos[tipo];
    const clave = (x: SignoVital) => (tipo === 'glucosa' ? (x.momento ?? 'sin_momento') : tipo);
    const grupos = new Map<string, { base: SignoVital[]; recientes: SignoVital[] }>();
    const agregar = (x: SignoVital, campo: 'base' | 'recientes') => {
      if (x.tipo !== tipo || typeof x.valor !== 'number') return;
      const g = grupos.get(clave(x)) ?? { base: [], recientes: [] };
      g[campo].push(x);
      grupos.set(clave(x), g);
    };
    base.forEach((x) => agregar(x, 'base'));
    recientes.forEach((x) => agregar(x, 'recientes'));

    let elegido: CambioPersonal | null = null;
    const peso = (c: CambioPersonal) => (c.clase === 'mejoro' ? 0 : 1);
    for (const [grupo, g] of grupos) {
      if (g.base.length < CAMBIOS.minLecturas || !g.recientes.length) continue;
      const momento = tipo === 'glucosa' && grupo !== 'sin_momento' ? (grupo as MomentoGlucosa) : null;
      const xs = g.base.map((x) => x.valor);
      const centro = mediana(xs);
      const escala = Math.max(variacionRobusta(xs, centro), conf.piso);
      const diast = g.base.map((x) => x.valorSecundario).filter((v): v is number => typeof v === 'number');
      const centroDiast = diast.length ? mediana(diast) : null;
      const zonaHabitual = zonaClinica(tipo, centro, { edad: opciones.edad, momento });
      const fmt = (v: number, d: number | null) =>
        tipo === 'presion' && d !== null ? `${Math.round(v)}/${Math.round(d)}` : `${redondear(v, tipo === 'oxigenacion' ? 1 : 0)}`;
      const etiquetaMomento = momento ? ` ${(MOMENTO_GLUCOSA_ETIQUETA[momento] ?? '').toLowerCase()}`.trimEnd() : '';

      for (const x of g.recientes) {
        const diferencia = x.valor - centro;
        if (Math.abs(diferencia) < conf.minDiferencia) continue;
        const z = diferencia / escala;
        const zona = zonaClinica(tipo, x.valor, { edad: opciones.edad, momento });
        const nivel = ORDEN_ZONA[zona];
        const nivelHabitual = ORDEN_ZONA[zonaHabitual];
        let clase: ClaseCambio | null = null;
        if (nivelHabitual !== 0 && nivel === 0) {
          // Lo habitual estaba fuera de lo sano y esta lectura volvió al rango: mejoría
          clase = 'mejoro';
        } else if (Math.abs(z) >= CAMBIOS.z) {
          if (nivelHabitual === 0 && nivel !== 0) clase = 'salio_del_rango';
          // Ya estaba fuera y se alejó más en la misma dirección (más alta si era alta, más baja si era baja)
          else if (nivelHabitual !== 0 && Math.sign(nivel) === Math.sign(nivelHabitual) && Math.sign(diferencia) === Math.sign(nivelHabitual)) {
            clase = 'empeoro';
          }
        }
        if (!clase) continue;
        const candidato: CambioPersonal = {
          tipo,
          clase,
          fecha: x.fecha.toDate(),
          valor: `${fmt(x.valor, x.valorSecundario ?? null)} ${x.unidad}${etiquetaMomento}`,
          habitual: `${fmt(centro, centroDiast)} ${x.unidad}`,
          n: xs.length,
          z: redondear(z, 1),
          direccion: diferencia >= 0 ? 'alta' : 'baja',
          zona,
          zonaHabitual,
        };
        if (
          !elegido ||
          peso(candidato) > peso(elegido) ||
          (peso(candidato) === peso(elegido) && Math.abs(candidato.z) > Math.abs(elegido.z))
        ) {
          elegido = candidato;
        }
      }
    }
    if (elegido) salida.push(elegido);
  }
  return salida;
}

/** Texto de la bandera de un cambio personal. */
export function textoCambio(c: CambioPersonal): string {
  const cuando = formatDate(c.fecha, 'd MMM', 'es');
  const nombre = ETIQUETA_CAMBIO[c.tipo];
  const masculino = c.tipo === 'pulso';
  const sube = c.direccion === 'alta';
  const comparado = sube ? (masculino ? 'más alto' : 'más alta') : masculino ? 'más bajo' : 'más baja';
  const habitual = `(lo habitual en esta persona: ${c.habitual}, ${c.n} lecturas)`;
  switch (c.clase) {
    case 'mejoro':
      return `${nombre} ${c.valor} el ${cuando}: volvió al rango recomendado ${habitual}`;
    case 'empeoro':
      return `${nombre} ${c.valor} el ${cuando}: empeoró, ${comparado} que lo habitual ${habitual}`;
    default:
      return `${nombre} ${c.valor} el ${cuando}: ${comparado} de lo habitual y fuera del rango recomendado ${habitual}`;
  }
}

export interface TendenciaPresion {
  /** Promedio sistólico/diastólico de la última semana */
  reciente: { sistolica: number; diastolica: number; n: number };
  /** Promedio de la semana de hace tres semanas */
  anterior: { sistolica: number; diastolica: number; n: number };
  direccion: 'sube' | 'baja';
}

/**
 * Tendencia de la presión: promedio de la última semana (hasta `hasta`) contra el de la semana de
 * 21 a 28 días antes. Se informa si la sistólica cambió 10 mmHg o más y el promedio reciente quedó
 * fuera de lo sano en esa dirección (subió y está alta, o bajó y está baja). Si hubo un cambio de
 * tratamiento en medio, no se compara: se espera que los números cambien.
 */
export function tendenciaPresion(signos: SignoVital[], hasta: Date, opciones: OpcionesCambios = {}): TendenciaPresion | null {
  const t = hasta.getTime();
  const dia = 86_400_000;
  const presiones = signos.filter((x) => x.tipo === 'presion' && typeof x.valor === 'number' && x.valorSecundario != null);
  const entre = (a: number, b: number) => presiones.filter((x) => x.fecha.toMillis() >= a && x.fecha.toMillis() < b);
  const reciente = entre(t - 7 * dia, t);
  const anterior = entre(t - 28 * dia, t - 21 * dia);
  const minimo = CAMBIOS.tendencia.minLecturas;
  if (reciente.length < minimo || anterior.length < minimo) return null;
  if (opciones.reinicio && opciones.reinicio.getTime() > t - 28 * dia) return null;
  const prom = (xs: SignoVital[]) => ({
    sistolica: promedio(xs.map((x) => x.valor)),
    diastolica: promedio(xs.map((x) => x.valorSecundario as number)),
    n: xs.length,
  });
  const r = prom(reciente);
  const a = prom(anterior);
  const cambio = r.sistolica - a.sistolica;
  if (Math.abs(cambio) < CAMBIOS.tendencia.minDiferencia) return null;
  const zona = ORDEN_ZONA[zonaClinica('presion', r.sistolica, { edad: opciones.edad })];
  if (cambio > 0 && zona <= 0) return null;
  if (cambio < 0 && zona >= 0) return null;
  return { reciente: r, anterior: a, direccion: cambio > 0 ? 'sube' : 'baja' };
}

export function textoTendencia(t: TendenciaPresion): string {
  const verbo = t.direccion === 'sube' ? 'subió' : 'bajó';
  return `La presión promedio ${verbo} de ${t.anterior.sistolica}/${t.anterior.diastolica} a ${t.reciente.sistolica}/${t.reciente.diastolica} mmHg en las últimas 4 semanas`;
}

// ---------------------------------------------------------------------------
// Banderas: lo que conviene comentar con el médico, de lo más delicado a lo menos
// ---------------------------------------------------------------------------
export interface Bandera {
  /** alta = urgente; media = para comentar; buena = mejoría que conviene comentar */
  nivel: 'alta' | 'media' | 'buena';
  texto: string;
}

export interface MedicamentoParaBanderas {
  nombre: string;
  adherencia: number | null;
  omisiones: Omisiones;
}

export function banderasHoja(datos: {
  resumen: ResumenClinico;
  caidas: ResumenCaidas;
  medicamentos: MedicamentoParaBanderas[];
  /** Cambios respecto a lo habitual en esta persona (cambiosPersonales) */
  cambios?: CambioPersonal[];
  /** Tendencia sostenida de la presión (tendenciaPresion) */
  tendencia?: TendenciaPresion | null;
}): Bandera[] {
  const u = UMBRALES_HOJA;
  const { resumen: rc, caidas } = datos;
  const lista: Bandera[] = [];
  const alta = (texto: string) => lista.push({ nivel: 'alta', texto });
  const media = (texto: string) => lista.push({ nivel: 'media', texto });
  const buena = (texto: string) => lista.push({ nivel: 'buena', texto });

  if (caidas.total) {
    alta(`${caidas.total} ${plural(caidas.total, 'caída', 'caídas')} en el periodo${caidas.conLesion ? `, ${caidas.conLesion} con lesión` : ''}`);
  }
  if (caidas.posibles) media(`${caidas.posibles} ${plural(caidas.posibles, 'incidente que parece', 'incidentes que parecen')} una caída (revisar)`);

  if (rc.peso) {
    const perdida = -rc.peso.porcentaje;
    if (perdida >= u.perdidaPesoPorcentaje) alta(`Pérdida de peso de ${perdida} % (${rc.peso.inicial} → ${rc.peso.final} kg)`);
    else if (perdida >= u.perdidaPesoAviso) media(`Peso a la baja: ${rc.peso.inicial} → ${rc.peso.final} kg (${perdida} %)`);
  }
  if (rc.glucosa) {
    const g = rc.glucosa;
    if (g.bajas) alta(`${g.bajas} ${plural(g.bajas, 'glucosa', 'glucosas')} por debajo de ${u.glucosaBaja} mg/dL`);
    if (g.muyAltas) alta(`${g.muyAltas} ${plural(g.muyAltas, 'glucosa', 'glucosas')} de más de ${u.glucosaMuyAlta} mg/dL`);
    else if (g.altas) media(`${g.altas} ${plural(g.altas, 'glucosa', 'glucosas')} por arriba de ${u.glucosaAlta} mg/dL`);
  }
  if (rc.presion) {
    const p = rc.presion;
    if (p.bajas) alta(`${p.bajas} ${plural(p.bajas, 'lectura', 'lecturas')} de presión sistólica de 90 o menos`);
    if (p.urgentes) alta(`${p.urgentes} ${plural(p.urgentes, 'lectura', 'lecturas')} de presión de 180/110 o más`);
    if (p.alto) media(`Presión promedio ${p.sistolica}/${p.diastolica} mmHg (meta en casa menor de ${p.meta.sistolica}/${p.meta.diastolica})`);
  }
  if (rc.temperatura?.fuera) alta(`${rc.temperatura.fuera} ${plural(rc.temperatura.fuera, 'registro', 'registros')} de fiebre (${u.fiebre} °C o más)`);
  if (rc.oxigenacion?.fuera) alta(`${rc.oxigenacion.fuera} ${plural(rc.oxigenacion.fuera, 'oxigenación', 'oxigenaciones')} por debajo de ${u.oxigenacionBaja} %`);
  if (rc.pulso?.fuera) media(`${rc.pulso.fuera} ${plural(rc.pulso.fuera, 'pulso', 'pulsos')} fuera de ${u.pulso.min}–${u.pulso.max} lpm`);

  if (datos.tendencia) media(textoTendencia(datos.tendencia));
  for (const c of datos.cambios ?? []) (c.clase === 'mejoro' ? buena : media)(textoCambio(c));

  for (const m of datos.medicamentos) {
    const { omitidas, patron } = m.omisiones;
    if (m.adherencia !== null && m.adherencia < u.adherenciaMinima) {
      media(`${m.nombre}: adherencia ${m.adherencia} % (${omitidas} ${plural(omitidas, 'dosis omitida', 'dosis omitidas')}${patron ? `, ${patron}` : ''})`);
    } else if (patron) {
      media(`${m.nombre}: se omite casi siempre la misma dosis (${patron})`);
    }
  }
  const orden = { alta: 0, media: 1, buena: 2 } as const;
  return lista.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}
