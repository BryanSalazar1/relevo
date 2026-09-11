import { formatDate } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { getApp } from '@angular/fire/app';
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
import { modeloIA } from '../../../environments/firebase.config';
import {
  EntradaBitacora,
  EventoCalendario,
  Medicamento,
  Miembro,
  PersonaCuidada,
  ROL_ETIQUETA,
  SignoVital,
  TIPO_ENTRADA_INFO,
  TIPO_SIGNO_ETIQUETA,
  Toma,
} from '../models';
import { edad, sumarDias } from '../utils/fechas';

export interface MensajeChat {
  rol: 'usuario' | 'asistente';
  texto: string;
  fecha: Date;
  error?: boolean;
}

/** Ventana de datos que se le entrega al modelo */
const DIAS_CONTEXTO = 30;
const MAX_ENTRADAS = 400;

const INSTRUCCIONES = `Eres el asistente de Relevo, una bitácora compartida para el cuidado de una persona (adulto mayor, paciente crónico o en recuperación). Respondes en español, de forma breve, cálida y clara, a familiares, enfermeros y médicos.

Reglas:
- Usa EXCLUSIVAMENTE los datos que se te entregan abajo (bitácora, medicamentos y tomas, signos vitales, citas). Si algo no está en los datos, dilo con claridad ("no hay registros de eso"). Nunca inventes.
- Cuando cuentes ocurrencias (por ejemplo, tomas omitidas), da el número y enumera brevemente las fechas como evidencia.
- Cita fechas, horas y quién registró cada cosa cuando ayude.
- No des diagnósticos ni cambies tratamientos. Si detectas algo preocupante (síntomas repetidos, tomas omitidas seguidas, signos fuera de lo habitual), sugiere comentarlo con el médico.
- Responde en texto plano, sin markdown ni asteriscos; usa párrafos cortos o listas con guiones.`;

/**
 * Asistente en lenguaje natural sobre la bitácora. Arma un contexto compacto con los datos de
 * Firestore de la persona y se lo entrega al modelo (Gemini vía Firebase AI Logic) como
 * instrucción de sistema, junto con el historial reciente de la conversación.
 */
@Injectable({ providedIn: 'root' })
export class AsistenteService {
  private readonly db = inject(Firestore);

  async preguntar(personaId: string, pregunta: string, historial: MensajeChat[]): Promise<string> {
    const contexto = await this.armarContexto(personaId);
    const hoy = formatDate(new Date(), "EEEE d 'de' MMMM 'de' y, HH:mm", 'es');

    const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
    const ai = getAI(getApp(), { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      model: modeloIA,
      systemInstruction: `${INSTRUCCIONES}\n\nHoy es ${hoy}.\n\n${contexto}`,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });

    const chat = model.startChat({
      history: historial
        .filter((m) => !m.error)
        .slice(-8)
        .map((m) => ({ role: m.rol === 'usuario' ? 'user' : 'model', parts: [{ text: m.texto }] })),
    });
    const resultado = await chat.sendMessage(pregunta);
    const texto = resultado.response.text().trim();
    if (!texto) throw new Error('El modelo no devolvió respuesta');
    return texto;
  }

  /** Mensaje amigable según el tipo de fallo. */
  mensajeError(error: unknown): string {
    const texto = String((error as { message?: string })?.message ?? error);
    if (/firebasevertexai|not enabled|Get started|API_KEY_SERVICE_BLOCKED|PERMISSION_DENIED/i.test(texto)) {
      return 'El asistente aún no está habilitado en el proyecto de Firebase (Firebase AI Logic). Pide al administrador que lo active en la consola.';
    }
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(texto)) {
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

  private async armarContexto(personaId: string): Promise<string> {
    const base = `personas_cuidadas/${personaId}`;
    const ahora = new Date();
    const desde = Timestamp.fromDate(sumarDias(ahora, -DIAS_CONTEXTO));
    const hastaEventos = Timestamp.fromDate(sumarDias(ahora, 60));

    const [personaSnap, miembrosSnap, entradasSnap, medsSnap, signosSnap, eventosSnap] =
      await Promise.all([
        getDoc(doc(this.db, base)),
        getDocs(collection(this.db, `${base}/miembros`)),
        getDocs(
          query(
            collection(this.db, `${base}/entradas_bitacora`),
            where('fecha', '>=', desde),
            orderBy('fecha', 'asc'),
            limit(MAX_ENTRADAS),
          ),
        ),
        getDocs(collection(this.db, `${base}/medicamentos`)),
        getDocs(
          query(collection(this.db, `${base}/signos_vitales`), where('fecha', '>=', desde), orderBy('fecha', 'asc')),
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
        `${persona.medicoTratante ? ` Médico tratante: ${persona.medicoTratante}.` : ''}`,
    );
    lineas.push(
      `EQUIPO DE CUIDADO: ${miembros.map((m) => `${m.nombre} (${ROL_ETIQUETA[m.rol] ?? m.rol})`).join(', ') || 'sin miembros'}.`,
    );

    lineas.push(`\nBITÁCORA (últimos ${DIAS_CONTEXTO} días, de más antiguo a más reciente; ${entradasSnap.size} registros):`);
    if (entradasSnap.empty) lineas.push('- (sin registros en este periodo)');
    for (const d of entradasSnap.docs) {
      const e = d.data() as EntradaBitacora;
      lineas.push(`- ${f(e.fecha)} [${TIPO_ENTRADA_INFO[e.tipo]?.etiqueta ?? e.tipo}] (${e.autorNombre}): ${e.texto}`);
    }

    lineas.push(`\nMEDICAMENTOS Y TOMAS (últimos ${DIAS_CONTEXTO} días):`);
    if (!medicamentos.length) lineas.push('- (sin medicamentos registrados)');
    medicamentos.forEach((m, i) => {
      const tomas = tomasPorMed[i];
      const omitidas = tomas.filter((t) => !t.tomado).length;
      lineas.push(
        `- ${m.nombre} ${m.dosis}, horarios ${m.horarios?.join(', ') || 'sin horario'}, inventario ${m.inventario ?? '?'}` +
          `${m.activo === false ? ' (suspendido)' : ''}. Tomas registradas: ${tomas.length}, omitidas: ${omitidas}.`,
      );
      for (const t of tomas) {
        lineas.push(
          `   · ${f(t.horaProgramada)} ${t.tomado ? 'TOMADA' : 'NO TOMADA'}` +
            `${t.tomado && t.horaReal ? ` a las ${formatDate(t.horaReal.toDate(), 'HH:mm', 'es')}` : ''} (registró ${nombreDe(t.registradoPor)})`,
        );
      }
    });

    lineas.push(`\nSIGNOS VITALES (últimos ${DIAS_CONTEXTO} días):`);
    if (signosSnap.empty) lineas.push('- (sin mediciones)');
    for (const d of signosSnap.docs) {
      const s = d.data() as SignoVital;
      const valor = s.tipo === 'presion' && s.valorSecundario != null ? `${s.valor}/${s.valorSecundario}` : `${s.valor}`;
      lineas.push(`- ${f(s.fecha)} ${TIPO_SIGNO_ETIQUETA[s.tipo] ?? s.tipo}: ${valor} ${s.unidad} (registró ${nombreDe(s.autorUid)})`);
    }

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
