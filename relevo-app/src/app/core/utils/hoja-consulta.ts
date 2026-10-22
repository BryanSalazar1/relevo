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
  /** Promedio en casa a partir del cual se habla de hipertensión (ESH) */
  presionPromedio: { sistolica: 135, diastolica: 85 },
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
  /** El promedio está por arriba de 135/85 */
  alto: boolean;
}

export function promedioPresion(signos: SignoVital[], dias = UMBRALES_HOJA.diasPresion): ResumenPresion | null {
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
    alto: sistolica >= u.presionPromedio.sistolica || diastolica >= u.presionPromedio.diastolica,
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

export function resumenClinico(signos: SignoVital[]): ResumenClinico {
  const pesos = signos.filter((s) => s.tipo === 'peso');
  return {
    presion: promedioPresion(signos),
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
    if (p.alto) fuera.push(`promedio por arriba de ${u.presionPromedio.sistolica}/${u.presionPromedio.diastolica}`);
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
// Banderas: lo que conviene comentar con el médico, de lo más delicado a lo menos
// ---------------------------------------------------------------------------
export interface Bandera {
  nivel: 'alta' | 'media';
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
}): Bandera[] {
  const u = UMBRALES_HOJA;
  const { resumen: rc, caidas } = datos;
  const lista: Bandera[] = [];
  const alta = (texto: string) => lista.push({ nivel: 'alta', texto });
  const media = (texto: string) => lista.push({ nivel: 'media', texto });

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
    if (p.urgentes) alta(`${p.urgentes} ${plural(p.urgentes, 'lectura', 'lecturas')} de presión de 180/110 o más`);
    if (p.alto) media(`Presión promedio ${p.sistolica}/${p.diastolica} mmHg (meta en casa menor de ${u.presionPromedio.sistolica}/${u.presionPromedio.diastolica})`);
  }
  if (rc.temperatura?.fuera) alta(`${rc.temperatura.fuera} ${plural(rc.temperatura.fuera, 'registro', 'registros')} de fiebre (${u.fiebre} °C o más)`);
  if (rc.oxigenacion?.fuera) alta(`${rc.oxigenacion.fuera} ${plural(rc.oxigenacion.fuera, 'oxigenación', 'oxigenaciones')} por debajo de ${u.oxigenacionBaja} %`);
  if (rc.pulso?.fuera) media(`${rc.pulso.fuera} ${plural(rc.pulso.fuera, 'pulso', 'pulsos')} fuera de ${u.pulso.min}–${u.pulso.max} lpm`);

  for (const m of datos.medicamentos) {
    const { omitidas, patron } = m.omisiones;
    if (m.adherencia !== null && m.adherencia < u.adherenciaMinima) {
      media(`${m.nombre}: adherencia ${m.adherencia} % (${omitidas} ${plural(omitidas, 'dosis omitida', 'dosis omitidas')}${patron ? `, ${patron}` : ''})`);
    } else if (patron) {
      media(`${m.nombre}: se omite casi siempre la misma dosis (${patron})`);
    }
  }
  return lista.sort((a, b) => Number(b.nivel === 'alta') - Number(a.nivel === 'alta'));
}
