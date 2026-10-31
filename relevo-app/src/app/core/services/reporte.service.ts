import { Injectable, inject } from '@angular/core';
import { formatDate } from '@angular/common';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Capacitor } from '@capacitor/core';
import {
  EntradaBitacora,
  Medicamento,
  PersonaCuidada,
  SignoVital,
  TIPOS_ENTRADA_TODOS,
  TIPO_ENTRADA_INFO,
  TIPO_SIGNO_ETIQUETA,
  TipoEntradaInfo,
  TipoSigno,
  Toma,
} from '../models';
import { edad, etiquetaRango, sumarDias } from '../utils/fechas';
import {
  Bandera,
  FilaSigno,
  ResumenCaidas,
  ResumenClinico,
  CAMBIOS,
  cambiosPersonales,
  tendenciaPresion,
  banderasHoja,
  filasSignos,
  patronOmisiones,
  resumenCaidas,
  resumenClinico,
} from '../utils/hoja-consulta';
import { AuthService } from './auth.service';
import { BitacoraService } from './bitacora.service';

export interface ResumenSigno {
  tipo: TipoSigno;
  etiqueta: string;
  unidad: string;
  n: number;
  min: number;
  max: number;
  promedio: number;
  ultimo: SignoVital;
}

export interface ResumenMedicamento {
  nombre: string;
  dosis: string;
  horarios: string[];
  /** Sin horario fijo: las tomas se registran cuando hacen falta; no aplica la adherencia */
  segunNecesidad: boolean;
  programadas: number;
  tomadas: number;
  /** 0-100, null si no hubo tomas programadas */
  adherencia: number | null;
  /** Dosis programadas que se marcaron como no tomadas */
  omitidas: number;
  /** "3 de 4 a las 20:00" cuando casi siempre se omite la misma dosis */
  patronOmision: string | null;
  /** Se dio de alta dentro del periodo */
  nuevo: boolean;
}

/** Días hacia atrás en los que se buscan indicaciones médicas previas al periodo */
const DIAS_INDICACIONES_PREVIAS = 90;

/** Lo que la hoja para la consulta agrega al reporte (core/utils/hoja-consulta.ts). */
export interface HojaConsulta {
  resumen: ResumenClinico;
  filasSignos: FilaSigno[];
  caidas: ResumenCaidas;
  banderas: Bandera[];
  /** Las últimas indicaciones del médico (hasta 3, del periodo o de los 90 días anteriores) */
  indicaciones: EntradaBitacora[];
  /** Preguntas de la familia (consulta/preguntas) */
  preguntas: string;
  incidentes: number;
  sintomas: number;
}

/** Qué anexos lleva la hoja para la consulta después de la primera página */
export interface AnexosHoja {
  sintomas: boolean;
  resumenIA: boolean;
  bitacora: boolean;
}

export interface Reporte {
  persona: PersonaCuidada;
  desde: Date;
  /** exclusivo */
  hasta: Date;
  rango: string;
  generadoEn: Date;
  generadoPor: string;
  entradas: EntradaBitacora[];
  conteoPorTipo: { tipo: TipoEntradaInfo; cantidad: number }[];
  alertas: EntradaBitacora[];
  signos: ResumenSigno[];
  medicamentos: ResumenMedicamento[];
  /** Resumen narrativo generado con IA (opcional; lo pide el usuario en la pantalla de reporte) */
  resumenIA?: string;
  hoja: HojaConsulta;
}

@Injectable({ providedIn: 'root' })
export class ReporteService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);
  private readonly bitacoraSvc = inject(BitacoraService);

  async generar(personaId: string, desde: Date, hasta: Date): Promise<Reporte> {
    const base = `personas_cuidadas/${personaId}`;
    const [personaSnap, entradas, signosSnap, medsSnap, entradasPrevias, preguntasSnap, signosPreviosSnap] =
      await Promise.all([
      getDoc(doc(this.db, base)),
      this.bitacoraSvc.entre(personaId, desde, hasta),
      getDocs(
        query(
          collection(this.db, `${base}/signos_vitales`),
          where('fecha', '>=', Timestamp.fromDate(desde)),
          where('fecha', '<', Timestamp.fromDate(hasta)),
          orderBy('fecha', 'asc'),
        ),
      ),
      getDocs(collection(this.db, `${base}/medicamentos`)),
      // Indicaciones del médico anteriores al periodo, para "qué pasó con lo que indicó"
      this.bitacoraSvc.entre(personaId, sumarDias(desde, -DIAS_INDICACIONES_PREVIAS), desde),
      // Las preguntas no detienen el reporte: si no se pueden leer (reglas sin publicar, sin red), van vacías
      getDoc(doc(this.db, `${base}/consulta/preguntas`)).catch((error: unknown) => {
        console.warn('No se pudieron leer las preguntas para el médico', error);
        return null;
      }),
      // Línea base de los signos (días previos al periodo) para detectar lo inusual en esta persona
      getDocs(
        query(
          collection(this.db, `${base}/signos_vitales`),
          where('fecha', '>=', Timestamp.fromDate(sumarDias(desde, -CAMBIOS.diasLineaBase))),
          where('fecha', '<', Timestamp.fromDate(desde)),
          orderBy('fecha', 'asc'),
        ),
      ).catch(() => null),
    ]);
    if (!personaSnap.exists()) throw new Error('La persona no existe o no tienes acceso');
    const persona = { id: personaSnap.id, ...(personaSnap.data() as PersonaCuidada) };

    const signos = signosSnap.docs.map((d) => d.data() as SignoVital);
    const medicamentos = medsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Medicamento) }));

    const tomasPorMed = await Promise.all(
      medicamentos.map(async (m) => {
        const snap = await getDocs(
          query(
            collection(this.db, `${base}/medicamentos/${m.id}/tomas`),
            where('horaProgramada', '>=', Timestamp.fromDate(desde)),
            where('horaProgramada', '<', Timestamp.fromDate(hasta)),
          ),
        );
        return snap.docs.map((d) => d.data() as Toma);
      }),
    );

    // Las tomas van por índice del medicamento: se emparejan antes de filtrar los suspendidos
    const resumenMeds = medicamentos
      .map((m, i) => ({ m, tomas: tomasPorMed[i] }))
      .filter((x) => x.m.activo !== false)
      .map((x) => this.resumirMedicamento(x.m, x.tomas, desde));

    // Lo reciente = la última semana del periodo; lo habitual = lo anterior (hasta 60 días antes del
    // periodo), desde el último cambio de tratamiento. Así funciona igual en el reporte semanal que
    // en Seguimiento de 30 o 90 días.
    const anios = edad(persona.fechaNacimiento);
    const corte = sumarDias(hasta, -CAMBIOS.diasRecientes).getTime();
    const todos = [...(signosPreviosSnap?.docs.map((d) => d.data() as SignoVital) ?? []), ...signos];
    const reinicio = ultimoCambioTratamiento(medicamentos, hasta);
    const cambios = cambiosPersonales(
      todos.filter((x) => x.fecha.toMillis() < corte),
      todos.filter((x) => x.fecha.toMillis() >= corte),
      { edad: anios, reinicio },
    );
    const tendencia = tendenciaPresion(todos, hasta, { edad: anios, reinicio });
    const resumen = resumenClinico(signos, anios);
    const caidas = resumenCaidas(entradas);
    const indicaciones = [...entradasPrevias, ...entradas]
      .filter((e) => e.tipo === 'indicacion')
      .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
      .slice(0, 3);
    const hoja: HojaConsulta = {
      resumen,
      filasSignos: filasSignos(resumen),
      caidas,
      banderas: banderasHoja({
        resumen,
        caidas,
        medicamentos: resumenMeds.map((m) => ({
          nombre: m.nombre,
          adherencia: m.adherencia,
          omisiones: { omitidas: m.omitidas, patron: m.patronOmision },
        })),
        cambios,
        tendencia,
      }),
      indicaciones,
      preguntas: preguntasSnap?.exists() ? String(preguntasSnap.get('texto') ?? '') : '',
      incidentes: entradas.filter((e) => e.tipo === 'incidente').length,
      sintomas: entradas.filter((e) => e.tipo === 'sintoma').length,
    };

    return {
      persona,
      desde,
      hasta,
      rango: etiquetaRango(desde, hasta),
      generadoEn: new Date(),
      generadoPor: this.authSvc.nombreActual,
      entradas,
      conteoPorTipo: TIPOS_ENTRADA_TODOS.map((tipo) => ({
        tipo,
        cantidad: entradas.filter((e) => e.tipo === tipo.valor).length,
      })).filter((c) => c.cantidad > 0),
      alertas: entradas.filter((e) => e.tipo === 'incidente' || e.tipo === 'sintoma'),
      signos: this.resumirSignos(signos),
      medicamentos: resumenMeds,
      hoja,
    };
  }

  private resumirSignos(signos: SignoVital[]): ResumenSigno[] {
    const porTipo = new Map<TipoSigno, SignoVital[]>();
    for (const s of signos) porTipo.set(s.tipo, [...(porTipo.get(s.tipo) ?? []), s]);
    return [...porTipo.entries()].map(([tipo, lista]) => {
      const valores = lista.map((s) => s.valor);
      return {
        tipo,
        etiqueta: TIPO_SIGNO_ETIQUETA[tipo] ?? tipo,
        unidad: lista[0].unidad,
        n: lista.length,
        min: Math.min(...valores),
        max: Math.max(...valores),
        promedio: Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10,
        ultimo: lista[lista.length - 1],
      };
    });
  }

  private resumirMedicamento(m: Medicamento, tomas: Toma[], desde: Date): ResumenMedicamento {
    const tomadas = tomas.filter((t) => t.tomado).length;
    const segunNecesidad = m.segunNecesidad === true;
    const omisiones = segunNecesidad ? { omitidas: 0, patron: null } : patronOmisiones(tomas);
    return {
      nombre: m.nombre,
      dosis: m.dosis,
      horarios: m.horarios ?? [],
      segunNecesidad,
      programadas: segunNecesidad ? 0 : tomas.length,
      tomadas,
      adherencia: !segunNecesidad && tomas.length ? Math.round((tomadas / tomas.length) * 100) : null,
      omitidas: omisiones.omitidas,
      patronOmision: omisiones.patron,
      nuevo: !!m.creadoEn && m.creadoEn.toDate().getTime() >= desde.getTime(),
    };
  }

  // ---------------------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------------------

  nombreArchivo(r: Reporte): string {
    const persona = r.persona.nombre.normalize('NFD').replace(/[^\w]+/g, '_');
    return `Relevo_${persona}_${formatDate(r.desde, 'yyyyMMdd', 'es')}-${formatDate(
      r.hasta,
      'yyyyMMdd',
      'es',
    )}.pdf`;
  }

  nombreArchivoHoja(r: Reporte): string {
    return this.nombreArchivo(r).replace('Relevo_', 'Relevo_consulta_');
  }

  /**
   * Hoja para la consulta: una página con lo que el médico usa en una consulta corta (preguntas de
   * la familia y banderas, medicamentos vigentes con sus omisiones, signos resumidos, caídas e
   * indicaciones previas) y, en páginas aparte, los anexos que se pidan.
   */
  async exportarHojaPdf(r: Reporte, anexos: AnexosHoja): Promise<Blob> {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const teal: [number, number, number] = [15, 157, 138];
    const rojo: [number, number, number] = [200, 56, 56];
    const verde: [number, number, number] = [30, 130, 80];
    const gris = 110;
    const ancho = 182;
    const f = (d: Date, fmt = 'dd/MM/yyyy') => formatDate(d, fmt, 'es');
    const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
    const p = r.persona;
    const h = r.hoja;
    const anios = edad(p.fechaNacimiento);
    let y = 15;

    const salto = (alto: number) => {
      if (y + alto > 282) {
        pdf.addPage();
        y = 18;
      }
    };
    const seccion = (titulo: string) => {
      salto(14);
      y += 3;
      pdf.setFontSize(10.5);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(...teal);
      pdf.text(titulo.toUpperCase(), 14, y);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0);
      y += 4.5;
    };
    const linea = (
      texto: string,
      opciones: { tam?: number; color?: number | [number, number, number]; negrita?: boolean; sangria?: number } = {},
    ) => {
      const tam = opciones.tam ?? 9;
      const sangria = opciones.sangria ?? 0;
      pdf.setFontSize(tam);
      pdf.setFont('helvetica', opciones.negrita ? 'bold' : 'normal');
      if (Array.isArray(opciones.color)) pdf.setTextColor(...opciones.color);
      else pdf.setTextColor(opciones.color ?? 0);
      for (const parte of pdf.splitTextToSize(texto, ancho - sangria) as string[]) {
        salto(5);
        pdf.text(parte, 14 + sangria, y);
        y += tam * 0.5;
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0);
    };
    const vineta = (texto: string, color?: [number, number, number]) => {
      salto(5);
      pdf.setFontSize(9);
      if (color) pdf.setTextColor(...color);
      pdf.text('•', 15, y);
      pdf.setTextColor(0);
      linea(texto, { sangria: 5, color });
    };
    const tabla = (head: string[], body: (string | number)[][], columnStyles = {}) => {
      autoTable(pdf, {
        startY: y,
        head: [head],
        body: body.length ? body : [['—']],
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: teal, fontSize: 8.5 },
        columnStyles,
        margin: { left: 14, right: 14 },
      });
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    };
    const nuevaPagina = (titulo: string) => {
      pdf.addPage();
      y = 18;
      seccion(titulo);
    };

    // Encabezado
    pdf.setFontSize(15);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...teal);
    pdf.text('Hoja para la consulta', 14, y);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(gris);
    pdf.text(`Relevo · ${r.rango} · preparada por ${r.generadoPor} el ${f(r.generadoEn)}`, 196, y, { align: 'right' });
    y += 7;
    pdf.setTextColor(0);
    linea(`${p.nombre}${anios !== null ? ` · ${anios} años` : ''}`, { tam: 12, negrita: true });
    linea(
      [
        p.condiciones?.length ? `Condiciones: ${p.condiciones.join(', ')}` : '',
        `Alergias: ${p.alergias?.length ? p.alergias.join(', ') : 'ninguna registrada'}`,
        p.tipoSangre ? `Sangre: ${p.tipoSangre}` : '',
        p.medicoTratante ? `Médico: ${p.medicoTratante}` : '',
      ]
        .filter(Boolean)
        .join('  ·  '),
      { color: 60 },
    );

    // Lo primero: qué comentar
    seccion('Para comentar con el médico');
    const preguntas = h.preguntas
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!preguntas.length && !h.banderas.length) {
      linea('Sin banderas en el periodo según los registros; la familia no dejó preguntas.', { color: gris });
    }
    for (const b of h.banderas) vineta(b.texto, b.nivel === 'alta' ? rojo : b.nivel === 'buena' ? verde : undefined);
    for (const q of preguntas) vineta(`Pregunta de la familia: ${q}`);

    seccion('Medicamentos vigentes');
    tabla(
      ['Medicamento', 'Dosis y horario', 'Tomas del periodo', 'Omitidas'],
      r.medicamentos.map((m) => [
        `${m.nombre}${m.nuevo ? ' (nuevo en el periodo)' : ''}`,
        `${m.dosis} · ${m.segunNecesidad ? 'según necesidad' : m.horarios.join(', ') || 'sin horario'}`,
        m.segunNecesidad
          ? plural(m.tomadas, 'uso', 'usos')
          : `${m.tomadas} de ${m.programadas}${m.adherencia !== null ? ` (${m.adherencia} %)` : ''}`,
        m.segunNecesidad ? '—' : m.omitidas ? `${m.omitidas}${m.patronOmision ? ` · ${m.patronOmision}` : ''}` : '0',
      ]),
      { 0: { cellWidth: 46, fontStyle: 'bold' }, 3: { cellWidth: 40 } },
    );

    seccion('Signos vitales del periodo');
    if (h.filasSignos.length) {
      tabla(
        ['Medición', 'Resumen', 'Fuera de rango'],
        h.filasSignos.map((fila) => [fila.etiqueta, fila.resumen, fila.fuera || '—']),
        { 0: { cellWidth: 30, fontStyle: 'bold' }, 2: { cellWidth: 52 } },
      );
    } else {
      linea('Sin mediciones en el periodo.', { color: gris });
    }

    seccion('Caídas, incidentes y síntomas');
    const c = h.caidas;
    linea(
      [
        `${plural(c.total, 'caída', 'caídas')}${c.conLesion ? ` (${c.conLesion} con lesión)` : ''}`,
        c.posibles ? `${plural(c.posibles, 'posible caída', 'posibles caídas')} por el texto` : '',
        plural(h.incidentes, 'incidente', 'incidentes'),
        plural(h.sintomas, 'síntoma', 'síntomas'),
      ]
        .filter(Boolean)
        .join(' · ') + (anexos.sintomas && h.incidentes + h.sintomas > 0 ? ' · detalle en el anexo' : ''),
    );

    seccion('Indicaciones médicas previas');
    if (!h.indicaciones.length) {
      linea(`Sin indicaciones registradas en los últimos ${DIAS_INDICACIONES_PREVIAS} días.`, { color: gris });
    }
    for (const e of h.indicaciones) vineta(`${f(e.fecha.toDate())} · ${e.autorNombre}: ${e.texto}`);
    if (h.indicaciones.length) linea('Comentar en la consulta si se cumplieron y cómo le fue.', { color: gris, tam: 8 });

    // Anexos
    const tipoAlerta = (e: EntradaBitacora) =>
      e.tipo === 'sintoma' ? 'Síntoma' : e.caida ? (e.lesion ? 'Caída con lesión' : 'Caída') : 'Incidente';
    if (anexos.sintomas && r.alertas.length) {
      nuevaPagina('Anexo: síntomas e incidentes');
      tabla(
        ['Fecha', 'Tipo', 'Descripción', 'Registró'],
        r.alertas.map((e) => [f(e.fecha.toDate(), 'dd/MM HH:mm'), tipoAlerta(e), e.texto, e.autorNombre]),
        { 0: { cellWidth: 24 }, 1: { cellWidth: 28 }, 3: { cellWidth: 30 } },
      );
    }
    if (anexos.resumenIA && r.resumenIA) {
      nuevaPagina('Anexo: resumen con IA');
      for (const cruda of r.resumenIA.split(/\r?\n/)) {
        const l = cruda.trim();
        if (!l) {
          y += 2;
          continue;
        }
        const esTitulo = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 ,:]{2,}$/.test(l);
        linea(l, { negrita: esTitulo, tam: 9.5 });
      }
      linea('Resumen generado con inteligencia artificial a partir de los registros. No sustituye el criterio médico.', { tam: 8, color: gris });
    }
    if (anexos.bitacora && r.entradas.length) {
      nuevaPagina('Anexo: bitácora completa');
      tabla(
        ['Fecha', 'Tipo', 'Registro', 'Autor'],
        r.entradas.map((e) => [
          f(e.fecha.toDate(), 'dd/MM HH:mm'),
          TIPO_ENTRADA_INFO[e.tipo]?.etiqueta ?? e.tipo,
          e.texto,
          e.autorNombre,
        ]),
        { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 3: { cellWidth: 30 } },
      );
    }

    const paginas = pdf.getNumberOfPages();
    for (let i = 1; i <= paginas; i++) {
      pdf.setPage(i);
      pdf.setFontSize(7.5);
      pdf.setTextColor(130);
      // El pie cabe en el ancho de la página (182 mm): si no, se parte en dos líneas
      const pie = pdf.splitTextToSize(
        `Relevo · Hoja para la consulta de ${p.nombre} · página ${i} de ${paginas} · Preparada por ${r.generadoPor} con los registros del equipo de cuidado; no sustituye el expediente clínico.`,
        182,
      ) as string[];
      pdf.text(pie, 14, pie.length > 1 ? 287 : 291);
    }
    return pdf.output('blob');
  }

  async exportarPdf(r: Reporte): Promise<Blob> {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const azul: [number, number, number] = [56, 128, 255];
    const f = (d: Date, fmt = 'dd/MM/yyyy HH:mm') => formatDate(d, fmt, 'es');
    const p = r.persona;
    const anios = edad(p.fechaNacimiento);

    pdf.setFontSize(18);
    pdf.setTextColor(...azul);
    pdf.text('Relevo — Reporte de cuidado', 14, 18);
    pdf.setTextColor(0);
    pdf.setFontSize(12);
    pdf.text(`${p.nombre}${anios !== null ? ` · ${anios} años` : ''}`, 14, 27);
    pdf.setFontSize(10);
    pdf.setTextColor(90);
    pdf.text(`Periodo: ${r.rango}`, 14, 33);
    pdf.text(`Generado el ${f(r.generadoEn)} por ${r.generadoPor}`, 14, 38);
    pdf.setTextColor(0);

    let y = 44;
    const seccion = (titulo: string) => {
      if (y > 265) {
        pdf.addPage();
        y = 20;
      }
      pdf.setFontSize(12);
      pdf.setTextColor(...azul);
      pdf.text(titulo, 14, y);
      pdf.setTextColor(0);
      y += 3;
    };
    /** Texto plano en párrafos; las líneas en MAYÚSCULAS (secciones del resumen con IA) van en negrita. */
    const parrafos = (texto: string) => {
      pdf.setFontSize(9.5);
      for (const cruda of texto.split(/\r?\n/)) {
        const linea = cruda.trim();
        if (!linea) {
          y += 2;
          continue;
        }
        const esTitulo = /^[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 ,:]{2,}$/.test(linea);
        pdf.setFont('helvetica', esTitulo ? 'bold' : 'normal');
        if (esTitulo) y += 1.5;
        for (const parte of pdf.splitTextToSize(linea, 182) as string[]) {
          if (y > 280) {
            pdf.addPage();
            y = 20;
          }
          pdf.text(parte, 14, y);
          y += 4.6;
        }
      }
      pdf.setFont('helvetica', 'normal');
      y += 3;
    };
    const tabla = (head: string[], body: (string | number)[][], columnStyles = {}) => {
      autoTable(pdf, {
        startY: y,
        head: [head],
        body: body.length ? body : [['—']],
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: azul },
        columnStyles,
        margin: { left: 14, right: 14 },
      });
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
    };

    seccion('Datos de la persona');
    tabla(
      ['Campo', 'Valor'],
      [
        ['Descripción', p.descripcion || '—'],
        ['Tipo de sangre', p.tipoSangre || '—'],
        ['Condiciones', p.condiciones?.join(', ') || '—'],
        ['Alergias', p.alergias?.join(', ') || 'Ninguna registrada'],
        ['Médico tratante', [p.medicoTratante, p.telefonoMedico].filter(Boolean).join(' · ') || '—'],
        ['Seguro médico', p.seguro || '—'],
        ['Hospital o clínica', p.hospital || '—'],
        ['Notas médicas', p.notasMedicas || '—'],
        [
          'Contactos de emergencia',
          p.contactosEmergencia?.map((c) => `${c.nombre} (${c.telefono})`).join(', ') || '—',
        ],
      ],
      { 0: { fontStyle: 'bold', cellWidth: 45 } },
    );

    if (r.resumenIA) {
      seccion('Resumen con IA');
      parrafos(r.resumenIA);
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        'Resumen generado con inteligencia artificial a partir de los registros de Relevo. No sustituye el criterio médico.',
        14,
        y,
      );
      pdf.setTextColor(0);
      y += 9;
    }

    seccion('Resumen de la bitácora');
    tabla(
      ['Tipo de registro', 'Cantidad'],
      r.conteoPorTipo.map((c) => [c.tipo.etiqueta, c.cantidad]),
    );

    seccion('Síntomas e incidentes');
    tabla(
      ['Fecha', 'Tipo', 'Descripción', 'Registró'],
      r.alertas.map((e) => [
        f(e.fecha.toDate()),
        e.tipo === 'incidente' ? 'Incidente' : 'Síntoma',
        e.texto,
        e.autorNombre,
      ]),
      { 0: { cellWidth: 30 }, 1: { cellWidth: 22 }, 3: { cellWidth: 30 } },
    );

    seccion('Signos vitales');
    tabla(
      ['Medición', 'Registros', 'Mín.', 'Prom.', 'Máx.', 'Última'],
      r.signos.map((s) => [
        s.etiqueta,
        s.n,
        this.valorSigno(s, s.min),
        this.valorSigno(s, s.promedio),
        this.valorSigno(s, s.max),
        `${this.textoSigno(s.ultimo)} (${f(s.ultimo.fecha.toDate(), 'dd/MM')})`,
      ]),
    );

    seccion('Medicamentos y adherencia');
    tabla(
      ['Medicamento', 'Dosis', 'Horarios', 'Programadas', 'Tomadas', 'Adherencia'],
      r.medicamentos.map((m) => [
        m.nombre,
        m.dosis,
        m.segunNecesidad ? 'Según necesidad' : m.horarios.join(', '),
        m.segunNecesidad ? '—' : m.programadas,
        m.tomadas,
        m.adherencia === null ? '—' : `${m.adherencia} %`,
      ]),
    );

    seccion('Bitácora completa');
    tabla(
      ['Fecha', 'Tipo', 'Registro', 'Autor'],
      r.entradas.map((e) => [
        f(e.fecha.toDate()),
        TIPO_ENTRADA_INFO[e.tipo]?.etiqueta ?? e.tipo,
        e.texto,
        e.autorNombre,
      ]),
      { 0: { cellWidth: 30 }, 1: { cellWidth: 22 }, 3: { cellWidth: 30 } },
    );

    const paginas = pdf.getNumberOfPages();
    for (let i = 1; i <= paginas; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(130);
      pdf.text(`Relevo · ${p.nombre} · página ${i} de ${paginas}`, 14, 290);
    }
    return pdf.output('blob');
  }

  private valorSigno(s: ResumenSigno, v: number): string {
    return `${v} ${s.unidad}`;
  }

  private textoSigno(s: SignoVital): string {
    return s.tipo === 'presion' && s.valorSecundario != null
      ? `${s.valor}/${s.valorSecundario} ${s.unidad}`
      : `${s.valor} ${s.unidad}`;
  }

  /** Android: guarda en caché y abre la hoja de compartir. Web: comparte o descarga. */
  async compartirPdf(blob: Blob, nombre: string): Promise<'compartido' | 'descargado'> {
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const base64 = await this.aBase64(blob);
      const archivo = await Filesystem.writeFile({
        path: nombre,
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({ title: nombre, files: [archivo.uri] });
      return 'compartido';
    }
    const file = new File([blob], nombre, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: nombre, files: [file] });
        return 'compartido';
      } catch {
        /* el usuario canceló: caemos a la descarga */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'descargado';
  }

  private aBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(',')[1]);
      lector.onerror = reject;
      lector.readAsDataURL(blob);
    });
  }
}

/**
 * El último cambio de tratamiento hasta `hasta`: un medicamento nuevo o editado en su nombre, dosis,
 * horarios o "según necesidad". Las indicaciones del médico son texto libre y no cuentan.
 */
export function ultimoCambioTratamiento(medicamentos: Medicamento[], hasta: Date): Date | null {
  const fechas = medicamentos
    .flatMap((m) => [m.creadoEn, m.tratamientoCambiadoEn])
    .map((t) => (t && typeof t.toDate === 'function' ? t.toDate() : null))
    .filter((d): d is Date => !!d && d.getTime() <= hasta.getTime());
  return fechas.length ? new Date(Math.max(...fechas.map((d) => d.getTime()))) : null;
}
