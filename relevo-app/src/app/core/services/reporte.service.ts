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
import { edad, etiquetaRango } from '../utils/fechas';
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
}

@Injectable({ providedIn: 'root' })
export class ReporteService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);
  private readonly bitacoraSvc = inject(BitacoraService);

  async generar(personaId: string, desde: Date, hasta: Date): Promise<Reporte> {
    const base = `personas_cuidadas/${personaId}`;
    const [personaSnap, entradas, signosSnap, medsSnap] = await Promise.all([
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
      medicamentos: medicamentos
        .filter((m) => m.activo !== false)
        .map((m, i) => this.resumirMedicamento(m, tomasPorMed[i])),
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

  private resumirMedicamento(m: Medicamento, tomas: Toma[]): ResumenMedicamento {
    const tomadas = tomas.filter((t) => t.tomado).length;
    const segunNecesidad = m.segunNecesidad === true;
    return {
      nombre: m.nombre,
      dosis: m.dosis,
      horarios: m.horarios ?? [],
      segunNecesidad,
      programadas: segunNecesidad ? 0 : tomas.length,
      tomadas,
      adherencia: !segunNecesidad && tomas.length ? Math.round((tomadas / tomas.length) * 100) : null,
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
