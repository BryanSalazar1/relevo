import { formatDate } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  EntradaBitacora,
  EventoCalendario,
  Medicamento,
  Miembro,
  PersonaCuidada,
  ROL_ETIQUETA,
  RegistroTarea,
  SignoVital,
  TIPO_ENTRADA_INFO,
  TIPO_SIGNO_ETIQUETA,
  TIPO_TAREA_INFO,
  Tarea,
  Toma,
} from '../models';
import { edad, etiquetaRango, sumarDias, textoDias } from '../utils/fechas';
import { textoIndicacion } from '../utils/segun-necesidad';
import { unidadesRestantes } from './medicamentos.service';

export interface MensajeChat {
  rol: 'usuario' | 'asistente';
  texto: string;
  fecha: Date;
  error?: boolean;
}

/** Ventana de datos que se le entrega al modelo */
const DIAS_CONTEXTO = 30;
const MAX_ENTRADAS = 400;

/** Lo que se envía a la Cloud Function `preguntarAsistente` (functions/index.js). */
interface PeticionAsistente {
  personaId: string;
  pregunta: string;
  hoy: string;
  contexto: string;
  historial: { rol: 'usuario' | 'asistente'; texto: string }[];
}

/**
 * Asistente en lenguaje natural sobre la bitácora. Arma un contexto compacto con los datos de
 * Firestore de la persona (con los permisos del usuario) y se lo manda a la Cloud Function
 * `preguntarAsistente`, que llama a Gemini con la clave del servidor. Así no depende de App Check.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private readonly db = inject(Firestore);
  private readonly fns = inject(Functions);

  async preguntar(personaId: string, pregunta: string, historial: MensajeChat[]): Promise<string> {
    const contexto = await this.armarContexto(personaId);
    const hoy = formatDate(new Date(), "EEEE d 'de' MMMM 'de' y, HH:mm", 'es');
    const llamar = httpsCallable<PeticionAsistente, { texto: string }>(this.fns, 'preguntarAsistente');
    const { data } = await llamar({
      personaId,
      pregunta,
      hoy,
      contexto,
      historial: historial
        .filter((m) => !m.error)
        .slice(-8)
        .map((m) => ({ rol: m.rol, texto: m.texto })),
    });
    const texto = data?.texto?.trim();
    if (!texto) throw new Error('El modelo no devolvió respuesta');
    return texto;
  }

  /** Mensaje amigable según el tipo de fallo. */
  mensajeError(error: unknown): string {
    const code = String((error as { code?: string })?.code ?? '');
    const texto = String((error as { message?: string })?.message ?? error);
    if (code.endsWith('failed-precondition')) {
      // El servidor explica qué falta (clave, créditos, API de Vertex AI, permiso…)
      return `El asistente no está listo en el servidor: ${texto.replace(/^FirebaseError:\s*/, '')}`;
    }
    if (code.endsWith('permission-denied')) return 'No tienes acceso a los datos de esta persona.';
    if (code.endsWith('unauthenticated')) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    const detalles = (error as { details?: { motivo?: string; limite?: number } } | null)?.details;
    if (detalles?.motivo === 'limite_diario') {
      return `Llegaste al límite de ${detalles.limite ?? 30} consultas al asistente por hoy. Vuelve a intentarlo mañana.`;
    }
    if (code.endsWith('resource-exhausted') || /quota|RESOURCE_EXHAUSTED|429/i.test(texto)) {
      return 'Se alcanzó el límite de consultas del asistente por ahora. Intenta en unos minutos.';
    }
    if (/network|fetch|Failed to fetch|offline/i.test(texto)) {
      return 'Sin conexión. El asistente necesita internet para responder.';
    }
    return 'No se pudo obtener respuesta del asistente. Intenta de nuevo.';
  }

  // ---------------------------------------------------------------------------
  // Contexto
  // ---------------------------------------------------------------------------

  /** Resumen narrativo de un periodo (para el reporte PDF), generado por la Cloud Function `resumirReporte`. */
  async resumirPeriodo(personaId: string, desde: Date, hasta: Date): Promise<string> {
    const contexto = await this.armarContexto(personaId, { desde, hasta });
    const hoy = formatDate(new Date(), "EEEE d 'de' MMMM 'de' y, HH:mm", 'es');
    const llamar = httpsCallable<
      { personaId: string; contexto: string; rango: string; hoy: string },
      { texto: string }
    >(this.fns, 'resumirReporte');
    const { data } = await llamar({ personaId, contexto, rango: etiquetaRango(desde, hasta), hoy });
    const texto = data?.texto?.trim();
    if (!texto) throw new Error('El modelo no devolvió resumen');
    return texto;
  }

  /**
   * Datos de la persona en texto compacto. Sin `rango`, los últimos DIAS_CONTEXTO días (chat);
   * con `rango` ([desde, hasta)), solo ese periodo (resumen del reporte).
   */
  private async armarContexto(personaId: string, rango?: { desde: Date; hasta: Date }): Promise<string> {
    const base = `personas_cuidadas/${personaId}`;
    const ahora = new Date();
    const desdeFecha = rango?.desde ?? sumarDias(ahora, -DIAS_CONTEXTO);
    const hastaFecha = rango?.hasta ?? sumarDias(ahora, 1);
    const desde = Timestamp.fromDate(desdeFecha);
    const hasta = Timestamp.fromDate(hastaFecha);
    const hastaEventos = Timestamp.fromDate(rango ? rango.hasta : sumarDias(ahora, 60));
    const periodo = rango
      ? `del ${formatDate(desdeFecha, 'd MMM y', 'es')} al ${formatDate(sumarDias(hastaFecha, -1), 'd MMM y', 'es')}`
      : `últimos ${DIAS_CONTEXTO} días`;

    const [personaSnap, miembrosSnap, entradasSnap, medsSnap, signosSnap, eventosSnap] =
      await Promise.all([
        getDoc(doc(this.db, base)),
        getDocs(collection(this.db, `${base}/miembros`)),
        getDocs(
          query(
            collection(this.db, `${base}/entradas_bitacora`),
            where('fecha', '>=', desde),
            where('fecha', '<', hasta),
            orderBy('fecha', 'asc'),
            limit(MAX_ENTRADAS),
          ),
        ),
        getDocs(collection(this.db, `${base}/medicamentos`)),
        getDocs(
          query(
            collection(this.db, `${base}/signos_vitales`),
            where('fecha', '>=', desde),
            where('fecha', '<', hasta),
            orderBy('fecha', 'asc'),
          ),
        ),
        getDocs(
          query(
            collection(this.db, `${base}/eventos_calendario`),
            where('inicio', '>=', desde),
            where('inicio', '<=', hastaEventos),
            orderBy('inicio', 'asc'),
          ),
        ),
      ]);
    if (!personaSnap.exists()) throw new Error('La persona no existe o no tienes acceso');

    const persona = personaSnap.data() as PersonaCuidada;
    const miembros = miembrosSnap.docs.map((d) => d.data() as Miembro);
    const nombreDe = (uid?: string | null) => miembros.find((m) => m.uid === uid)?.nombre ?? 'alguien del equipo';
    const f = (t: Timestamp) => formatDate(t.toDate(), 'yyyy-MM-dd HH:mm', 'es');

    const medicamentos = medsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Medicamento) }));
    const tomasPorMed = await Promise.all(
      medicamentos.map(async (m) => {
        const snap = await getDocs(
          query(
            collection(this.db, `${base}/medicamentos/${m.id}/tomas`),
            where('horaProgramada', '>=', desde),
            where('horaProgramada', '<', hasta),
            orderBy('horaProgramada', 'asc'),
          ),
        );
        return snap.docs.map((d) => d.data() as Toma);
      }),
    );

    const lineas: string[] = [];
    const anios = edad(persona.fechaNacimiento);
    lineas.push(
      `PERSONA CUIDADA: ${persona.nombre}${anios !== null ? `, ${anios} años` : ''}` +
        `${persona.tipoSangre ? `, tipo de sangre ${persona.tipoSangre}` : ''}.` +
        ` Condiciones: ${persona.condiciones?.join(', ') || 'ninguna registrada'}.` +
        ` Alergias: ${persona.alergias?.join(', ') || 'ninguna registrada'}.` +
        `${persona.medicoTratante ? ` Médico tratante: ${persona.medicoTratante}${persona.telefonoMedico ? ` (${persona.telefonoMedico})` : ''}.` : ''}` +
        `${persona.seguro ? ` Seguro: ${persona.seguro}.` : ''}${persona.hospital ? ` Hospital: ${persona.hospital}.` : ''}` +
        `${persona.notasMedicas ? ` Notas médicas: ${persona.notasMedicas}` : ''}` +
        `${persona.contactosEmergencia?.length ? ` Contactos de emergencia: ${persona.contactosEmergencia.map((c) => `${c.nombre}${c.relacion ? ` (${c.relacion})` : ''} ${c.telefono}`).join(', ')}.` : ''}` +
        `${persona.descripcion ? ` Descripción del responsable: ${persona.descripcion}` : ''}`,
    );
    lineas.push(
      `EQUIPO DE CUIDADO: ${miembros.map((m) => `${m.nombre} (${ROL_ETIQUETA[m.rol] ?? m.rol})`).join(', ') || 'sin miembros'}.`,
    );

    lineas.push(`\nBITÁCORA (${periodo}, de más antiguo a más reciente; ${entradasSnap.size} registros):`);
    if (entradasSnap.empty) lineas.push('- (sin registros en este periodo)');
    for (const d of entradasSnap.docs) {
      const e = d.data() as EntradaBitacora;
      lineas.push(`- ${f(e.fecha)} [${TIPO_ENTRADA_INFO[e.tipo]?.etiqueta ?? e.tipo}] (${e.autorNombre}): ${e.texto}`);
    }

    lineas.push(`\nMEDICAMENTOS Y TOMAS (${periodo}):`);
    if (!medicamentos.length) lineas.push('- (sin medicamentos registrados)');
    medicamentos.forEach((m, i) => {
      const tomas = tomasPorMed[i];
      const omitidas = tomas.filter((t) => !t.tomado).length;
      lineas.push(
        `- ${m.nombre} ${m.dosis}, ${m.segunNecesidad ? `según necesidad (sin horario fijo${textoIndicacion(m) ? `; indicación del médico: ${textoIndicacion(m)}` : ''})` : `horarios ${m.horarios?.join(', ') || 'sin horario'}`}, inventario ${unidadesRestantes(m) ?? '?'}` +
          `${m.activo === false ? ' (suspendido)' : ''}. Tomas registradas: ${tomas.length}, omitidas: ${omitidas}.`,
      );
      for (const t of tomas) {
        lineas.push(
          `   · ${f(t.horaProgramada)} ${t.tomado ? 'TOMADA' : 'NO TOMADA'}` +
            `${t.tomado && t.horaReal ? ` a las ${formatDate(t.horaReal.toDate(), 'HH:mm', 'es')}` : ''} (registró ${nombreDe(t.registradoPor)})` +
            `${t.motivo ? ` · motivo: ${t.motivo}${typeof t.intensidad === 'number' ? ` (intensidad ${t.intensidad}/10)` : ''}` : ''}${t.nota ? ` · nota: ${t.nota}` : ''}`,
        );
      }
    });

    lineas.push(`\nSIGNOS VITALES (${periodo}):`);
    if (signosSnap.empty) lineas.push('- (sin mediciones)');
    for (const d of signosSnap.docs) {
      const s = d.data() as SignoVital;
      const valor = s.tipo === 'presion' && s.valorSecundario != null ? `${s.valor}/${s.valorSecundario}` : `${s.valor}`;
      lineas.push(`- ${f(s.fecha)} ${TIPO_SIGNO_ETIQUETA[s.tipo] ?? s.tipo}: ${valor} ${s.unidad} (registró ${nombreDe(s.autorUid)})`);
    }

    const tareasSnap = await getDocs(collection(this.db, `${base}/tareas`));
    const tareas = tareasSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Tarea) }));
    const registrosPorTarea = await Promise.all(
      tareas.map(async (t) => {
        const snap = await getDocs(
          query(
            collection(this.db, `${base}/tareas/${t.id}/registros`),
            where('horaProgramada', '>=', desde),
            where('horaProgramada', '<', hasta),
            orderBy('horaProgramada', 'asc'),
          ),
        );
        return snap.docs.map((d) => d.data() as RegistroTarea);
      }),
    );
    lineas.push(`\nRUTINA: comidas, baño, ejercicio y otras tareas (${periodo}):`);
    if (!tareas.length) lineas.push('- (sin tareas en la rutina)');
    tareas.forEach((t, i) => {
      const regs = registrosPorTarea[i];
      const noHechas = regs.filter((r) => !r.hecha).length;
      lineas.push(
        `- ${t.nombre} [${TIPO_TAREA_INFO[t.tipo]?.etiqueta ?? t.tipo}], ${textoDias(t.dias)}, horarios ${t.horarios?.join(', ') || 'sin horario'}` +
          `${t.activo === false ? ' (suspendida)' : ''}. Registros: ${regs.length}, no hechas: ${noHechas}.`,
      );
      for (const r of regs) {
        lineas.push(
          `   · ${f(r.horaProgramada)} ${r.hecha ? 'HECHA' : 'NO HECHA'} (registró ${nombreDe(r.registradoPor)})${r.nota ? ` · nota: ${r.nota}` : ''}`,
        );
      }
    });

    lineas.push('\nCITAS, TERAPIAS Y TURNOS (pasados recientes y próximos):');
    if (eventosSnap.empty) lineas.push('- (sin eventos)');
    for (const d of eventosSnap.docs) {
      const ev = d.data() as EventoCalendario;
      lineas.push(
        `- ${f(ev.inicio)} a ${formatDate(ev.fin.toDate(), 'HH:mm', 'es')} [${ev.tipo}] ${ev.titulo}` +
          `${ev.responsableUid ? ` (responsable: ${nombreDe(ev.responsableUid)})` : ''}${ev.notas ? `. Notas: ${ev.notas}` : ''}`,
      );
    }

    return lineas.join('\n');
  }
}
