/**
 * Cloud Functions de Relevo: avisos al equipo de cuidado.
 *
 * Destinatarios (functions/logica.js):
 *   - Recordatorios de rutina (tomas pendientes, avisos previos) → quien está de guardia según los
 *     turnos de cada miembro; sin turnos definidos, todos los que registran; nadie de guardia, el responsable.
 *   - Avisos del equipo (bitácora, tomas omitidas, según necesidad, tareas no hechas, inventario) → todos
 *     menos el autor, según las preferencias de cada miembro (avisos: todos | importantes | ninguno,
 *     soloEnTurno). Lo importante: incidentes, síntomas, tomas no tomadas y medicamentos agotados.
 *
 * Canales:
 *   - Push (FCM) a quien tiene la app en el teléfono (usuarios/{uid}.fcmTokens).
 *   - Correo a quien no tiene token, es decir, usa Relevo desde la web. Solo si CORREO_USUARIO y el
 *     secreto CORREO_CONTRASENA están definidos; mientras estén vacíos, el correo se omite.
 *
 * Disparadores:
 *   - notificarEntradaBitacora: alguien escribe en la bitácora → los demás miembros.
 *   - notificarToma: una toma se marca "no tomada", o se registra una según necesidad (o "tomada"
 *     si NOTIFICAR_TOMAS_REALIZADAS) → los demás.
 *   - recordarTomasPendientes: cada 10 min, dosis ya pasadas de su hora sin registro → quienes registran tomas.
 *   - eliminarPersona: el responsable borra a una persona cuidada con todo su historial (callable).
 *   - avisarProximas: cada 5 min, tareas de la rutina y medicamentos cuya hora se acerca → quienes cuidan;
 *     citas del calendario que se acercan → quien acompaña, familia y quien está de guardia.
 *   - notificarRegistroTarea: una tarea de la rutina se marca "no hecha" → los demás (alerta).
 *   - avisarInventarioBajo: el inventario de un medicamento baja a "queda poco" o se agota → responsables
 *     y familiares (una vez por nivel; resurtir o corregir el inventario a mano rearma el aviso). Si ya
 *     estaba en 0, el "se acabó" sale desde notificarToma, porque esas tomas no cambian el medicamento.
 *   - limpiarUsuarioEliminado: al borrar una cuenta en Auth, borra su perfil y lo quita de cada equipo.
 *   - resumirReporte (invocable): resumen narrativo de un periodo para el reporte PDF, con el mismo contexto.
 *   - preguntarAsistente (invocable): el asistente de IA; recibe el contexto que arma la app y llama a Gemini
 *     con la clave del servidor. Exige sesión iniciada y ser miembro de la persona; no depende de App Check.
 *
 * Parámetros en functions/.env (ver .env.example). Requiere plan Blaze (Cloud Functions).
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import * as logger from 'firebase-functions/logger';
import { defineBoolean, defineInt, defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { GoogleGenAI } from '@google/genai';
import { auth as authV1 } from 'firebase-functions/v1';
import nodemailer from 'nodemailer';
import {
  INSTRUCCIONES_ASISTENTE,
  INSTRUCCIONES_RESUMEN,
  AVISO_CITAS_MAX_MIN,
  avisoInventario,
  citasProximas,
  correoHtml,
  correoTexto,
  deGuardia,
  destinatariosAlertas,
  destinatariosCita,
  destinatariosInventario,
  entradaImportante,
  dosisVencidas,
  elementosAgenda,
  estadoInventario,
  historialGemini,
  horarioDe,
  mensajeCita,
  mensajeEntrada,
  mensajeInventario,
  mensajeProximo,
  mensajeRecordatorio,
  mensajeTarea,
  mensajeToma,
  partesEnZona,
  proximos,
  tokensInvalidos,
} from './logica.js';

initializeApp();
setGlobalOptions({ maxInstances: 10 });

// ---------------------------------------------------------------------------
// Parámetros (functions/.env) y secreto (firebase functions:secrets:set CORREO_CONTRASENA)
// ---------------------------------------------------------------------------
const APP_URL = defineString('APP_URL', {
  default: 'https://relevo-e5eaf.web.app',
});
const ZONA_HORARIA = defineString('ZONA_HORARIA', {
  default: 'America/Mexico_City',
});
/** Vacío = no se envían correos (queda pendiente crear la cuenta de la app). */
const CORREO_USUARIO = defineString('CORREO_USUARIO', { default: '' });
const CORREO_SMTP_HOST = defineString('CORREO_SMTP_HOST', {
  default: 'smtp.gmail.com',
});
const CORREO_SMTP_PUERTO = defineInt('CORREO_SMTP_PUERTO', { default: 465 });
const CORREO_CONTRASENA = defineSecret('CORREO_CONTRASENA');
const NOTIFICAR_TOMAS_REALIZADAS = defineBoolean('NOTIFICAR_TOMAS_REALIZADAS', {
  default: false,
});
/** Minutos antes de cada toma en que se avisa (las tareas de la rutina traen el suyo: `avisarMin`). */
const AVISO_MEDICAMENTOS_MIN = defineInt('AVISO_MEDICAMENTOS_MIN', {
  default: 15,
});

/** Clave de la Gemini API para el asistente (firebase functions:secrets:set GEMINI_API_KEY). */
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
/** Modelo de Gemini del asistente */
const MODELO_IA = defineString('MODELO_IA', { default: 'gemini-3.6-flash' });
/**
 * Cómo se llama a Gemini: 'vertex' = Vertex AI con la identidad de la función (se factura al proyecto
 * de Google Cloud, sin clave); 'gemini' = Gemini Developer API con el secreto GEMINI_API_KEY (AI Studio).
 */
const IA_BACKEND = defineString('IA_BACKEND', { default: 'vertex' });
const VERTEX_UBICACION = defineString('VERTEX_UBICACION', { default: 'us-central1' });

/** Canal de Android que crea la app (NotificacionesService.CANAL_ANDROID). */
const CANAL_ANDROID = 'relevo';
const opciones = { secrets: [CORREO_CONTRASENA] };

/**
 * Firestore se inicializa al primer uso, no al cargar el módulo: la CLI analiza el código con un
 * límite de 10 s al desplegar y la conexión inicial puede tardar más que eso.
 */
let firestore = null;
function db() {
  firestore ??= getFirestore();
  return firestore;
}

// ---------------------------------------------------------------------------
// Lecturas de apoyo
// ---------------------------------------------------------------------------
async function persona(personaId) {
  const snap = await db().doc(`personas_cuidadas/${personaId}`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function miembros(personaId) {
  const snap = await db().collection(`personas_cuidadas/${personaId}/miembros`).get();
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

/**
 * Manda `mensaje` ({ titulo, cuerpo, url, personaId }) a cada uid: push si tiene tokens
 * registrados; si no, correo (cuando está configurado).
 */
async function notificar(uids, mensaje) {
  if (!uids.length) return;
  const snaps = await db().getAll(...uids.map((uid) => db().doc(`usuarios/${uid}`)));
  const resumen = { push: 0, correo: 0, sinCanal: 0 };
  await Promise.all(
    snaps.map(async (snap) => {
      if (!snap.exists) return;
      const usuario = snap.data();
      const tokens = (usuario.fcmTokens ?? []).filter((t) => typeof t === 'string' && t);
      if (tokens.length) {
        resumen.push += await enviarPush(snap.ref, tokens, mensaje);
        return;
      }
      if (usuario.email && (await enviarCorreo(usuario, mensaje))) {
        resumen.correo += 1;
        return;
      }
      resumen.sinCanal += 1;
    }),
  );
  logger.info('Aviso enviado', {
    titulo: mensaje.titulo,
    destinatarios: uids.length,
    ...resumen,
  });
}

async function enviarPush(usuarioRef, tokens, mensaje) {
  const respuesta = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: mensaje.titulo, body: mensaje.cuerpo },
    data: { url: mensaje.url, personaId: mensaje.personaId ?? '' },
    android: { priority: 'high', notification: { channelId: CANAL_ANDROID } },
    apns: { payload: { aps: { sound: 'default' } } },
  });
  const invalidos = tokensInvalidos(tokens, respuesta.responses);
  if (invalidos.length) {
    await usuarioRef.update({
      fcmTokens: FieldValue.arrayRemove(...invalidos),
    });
    logger.debug('Tokens inválidos retirados', {
      usuario: usuarioRef.id,
      cantidad: invalidos.length,
    });
  }
  return respuesta.successCount;
}

function contrasenaCorreo() {
  try {
    return CORREO_CONTRASENA.value() ?? '';
  } catch {
    return ''; // en el emulador sin .secret.local
  }
}

let transporte = null;
function obtenerTransporte() {
  if (!transporte) {
    const puerto = CORREO_SMTP_PUERTO.value();
    transporte = nodemailer.createTransport({
      host: CORREO_SMTP_HOST.value(),
      port: puerto,
      secure: puerto === 465,
      auth: { user: CORREO_USUARIO.value(), pass: contrasenaCorreo() },
    });
  }
  return transporte;
}

async function enviarCorreo(usuario, mensaje) {
  if (!CORREO_USUARIO.value() || !contrasenaCorreo()) {
    logger.debug('Correo no configurado; aviso omitido', {
      para: usuario.email,
    });
    return false;
  }
  const datos = { ...mensaje, enlace: `${APP_URL.value()}${mensaje.url}` };
  try {
    await obtenerTransporte().sendMail({
      from: `"Relevo" <${CORREO_USUARIO.value()}>`,
      to: usuario.email,
      subject: `Relevo · ${mensaje.titulo}`,
      text: correoTexto(datos),
      html: correoHtml(datos),
    });
    return true;
  } catch (error) {
    logger.error('No se pudo enviar el correo', {
      para: usuario.email,
      error: String(error),
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Disparadores
// ---------------------------------------------------------------------------

/** Alguien escribió en la bitácora → avisa a los demás miembros de la persona. */
export const notificarEntradaBitacora = onDocumentCreated(
  {
    document: 'personas_cuidadas/{personaId}/entradas_bitacora/{entradaId}',
    ...opciones,
  },
  async (event) => {
    const entrada = event.data?.data();
    if (!entrada || entrada.semilla) return; // los datos de demostración no avisan
    const { personaId } = event.params;
    const [p, ms] = await Promise.all([persona(personaId), miembros(personaId)]);
    if (!p) return;
    const ahora = partesEnZona(new Date(), ZONA_HORARIA.value());
    await notificar(
      destinatariosAlertas(ms, {
        excluir: entrada.autorUid,
        importante: entradaImportante(entrada),
        ahora,
      }),
      {
        ...mensajeEntrada({ personaNombre: p.nombre, entrada }),
        url: `/personas/${personaId}/bitacora`,
        personaId,
      },
    );
  },
);

/**
 * Se registró o corrigió una toma. Avisa cuando se marca "no tomada"; las realizadas solo si
 * NOTIFICAR_TOMAS_REALIZADAS=true. Quitar el registro no avisa.
 */
export const notificarToma = onDocumentWritten(
  {
    document: 'personas_cuidadas/{personaId}/medicamentos/{medicamentoId}/tomas/{tomaId}',
    ...opciones,
  },
  async (event) => {
    const antes = event.data?.before?.data();
    const despues = event.data?.after?.data();
    if (!despues || despues.semilla) return;
    if (antes && antes.tomado === despues.tomado) return;
    const { personaId, medicamentoId } = event.params;
    // Toma que no tuvo de dónde descontarse (inventario en 0): el medicamento no cambia, así que
    // avisarInventarioBajo no se entera; el aviso de "se acabó" sale de aquí, una sola vez
    if (despues.tomado && despues.sinDescuento) {
      const agotado = (m) => typeof m?.inventario === 'number' && m.inventario <= 0;
      await revisarInventario(personaId, medicamentoId, (actual) =>
        agotado(actual) ? { ...actual, inventario: 1 } : actual,
      ).catch(() => {}); // ya quedó en el log; que no impida el aviso de la toma
    }
    // Las tomas según necesidad no tenían horario: avisar que se dio es lo importante
    if (despues.tomado && !despues.aDemanda && !NOTIFICAR_TOMAS_REALIZADAS.value()) return;

    const [p, ms, medSnap] = await Promise.all([
      persona(personaId),
      miembros(personaId),
      db().doc(`personas_cuidadas/${personaId}/medicamentos/${medicamentoId}`).get(),
    ]);
    if (!p || !medSnap.exists) return;
    const horario = despues.horaProgramada
      ? horarioDe(despues.horaProgramada.toDate(), ZONA_HORARIA.value())
      : '--:--';
    const ahora = partesEnZona(new Date(), ZONA_HORARIA.value());
    // Una toma no tomada es lo delicado; las realizadas o según necesidad son solo informativas
    await notificar(
      destinatariosAlertas(ms, { excluir: despues.registradoPor, importante: !despues.tomado, ahora }),
      {
        ...mensajeToma({
          personaNombre: p.nombre,
          medicamento: medSnap.data(),
          horario,
          toma: despues,
        }),
        url: `/personas/${personaId}/hoy`,
        personaId,
      },
    );
  },
);

/** Una tarea de la rutina se marcó como no hecha → alerta a los demás miembros (con la nota, si la hay). */
export const notificarRegistroTarea = onDocumentWritten(
  {
    document: 'personas_cuidadas/{personaId}/tareas/{tareaId}/registros/{registroId}',
    ...opciones,
  },
  async (event) => {
    const antes = event.data?.before?.data();
    const despues = event.data?.after?.data();
    if (!despues || despues.semilla) return;
    if (antes && antes.hecha === despues.hecha) return;
    if (despues.hecha) return;

    const { personaId, tareaId } = event.params;
    const [p, ms, tareaSnap] = await Promise.all([
      persona(personaId),
      miembros(personaId),
      db().doc(`personas_cuidadas/${personaId}/tareas/${tareaId}`).get(),
    ]);
    if (!p || !tareaSnap.exists) return;
    const horario = despues.horaProgramada
      ? horarioDe(despues.horaProgramada.toDate(), ZONA_HORARIA.value())
      : '--:--';
    const ahora = partesEnZona(new Date(), ZONA_HORARIA.value());
    // Una tarea no hecha no cuenta como importante: quien eligió "solo importantes" no la recibe
    await notificar(
      destinatariosAlertas(ms, { excluir: despues.registradoPor, importante: false, ahora }),
      {
        ...mensajeTarea({
          personaNombre: p.nombre,
          tarea: tareaSnap.data(),
          horario,
          registro: despues,
        }),
        url: `/personas/${personaId}/hoy`,
        personaId,
      },
    );
  },
);

/** Campos del medicamento de los que depende el aviso de inventario. */
const CAMPOS_INVENTARIO = [
  'inventario',
  'horarios',
  'segunNecesidad',
  'activo',
  'inicio',
  'duracionDias',
];

/**
 * El inventario de un medicamento bajó a "queda poco" o se agotó → avisa a responsables y familiares.
 * Una sola vez por nivel: el último aviso se anota en `recordatorios/inventario-{medicamentoId}` y
 * se borra al resurtir o al corregir el inventario desde el formulario (o al suspender, terminar o
 * borrar el medicamento) para que vuelva a avisar.
 */
export const avisarInventarioBajo = onDocumentWritten(
  {
    document: 'personas_cuidadas/{personaId}/medicamentos/{medicamentoId}',
    ...opciones,
  },
  async (event) => {
    const antes = event.data?.before?.data();
    const despues = event.data?.after?.data();
    // Editar el nombre o las notas no cuesta lecturas
    if (
      antes &&
      despues &&
      CAMPOS_INVENTARIO.every((c) => JSON.stringify(antes[c]) === JSON.stringify(despues[c]))
    ) {
      return;
    }

    const { personaId, medicamentoId } = event.params;
    await revisarInventario(personaId, medicamentoId, () => antes);
  },
);

/**
 * Decide y envía el aviso de inventario de un medicamento. `antesDe(actual)` da los datos previos al
 * cambio. Se decide con el documento ACTUAL, no con la foto del evento: los eventos pueden llegar
 * repetidos o fuera de orden (p. ej. la última toma hecha sin conexión, después del resurtido).
 */
async function revisarInventario(personaId, medicamentoId, antesDe) {
  const hoyIso = partesEnZona(new Date(), ZONA_HORARIA.value()).fecha;
  const medRef = db().doc(`personas_cuidadas/${personaId}/medicamentos/${medicamentoId}`);
  const estadoRef = db().doc(
    `personas_cuidadas/${personaId}/recordatorios/inventario-${medicamentoId}`,
  );
  const guardar = (tx, existe, nivel) => {
    if (nivel === null) {
      if (existe) tx.delete(estadoRef);
    } else {
      tx.set(estadoRef, { medicamentoId, nivel, actualizadoEn: FieldValue.serverTimestamp() });
    }
  };

  // En transacción: dos tomas casi simultáneas no deben duplicar el aviso
  const { avisar, actual, guardado, escrito } = await db().runTransaction(async (tx) => {
    const [snap, medSnap] = await tx.getAll(estadoRef, medRef);
    const actual = medSnap.data(); // undefined si ya se borró
    const guardado = snap.data()?.nivel ?? null;
    const r = avisoInventario({ antes: antesDe(actual), despues: actual, estado: guardado, hoyIso });
    if (r.estado !== guardado) guardar(tx, snap.exists, r.estado);
    return { avisar: r.avisar, actual, guardado, escrito: r.estado };
  });
  if (!avisar) return;

  try {
    const [p, ms] = await Promise.all([persona(personaId), miembros(personaId)]);
    if (!p) return;
    const estado = estadoInventario(actual, hoyIso);
    const ahora = partesEnZona(new Date(), ZONA_HORARIA.value());
    // Agotado es importante; "queda poco" solo lo reciben quienes quieren todos los avisos
    await notificar(destinatariosInventario(ms, { importante: estado?.nivel === 'agotado', ahora }), {
      ...mensajeInventario({
        personaNombre: p.nombre,
        medicamento: actual,
        estado,
      }),
      url: `/personas/${personaId}/plan/medicamentos`,
      personaId,
    });
  } catch (error) {
    // El aviso no salió: se deshace la anotación (si nadie la cambió) para que la siguiente baja reintente
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(estadoRef);
      if ((snap.data()?.nivel ?? null) === escrito) guardar(tx, snap.exists, guardado);
    });
    logger.error('No se pudo avisar del inventario', { personaId, medicamentoId, error: String(error) });
    throw error;
  }
}

/**
 * Cada 10 minutos revisa las dosis de hoy que ya pasaron de su hora y no tienen registro, y
 * recuerda una sola vez a quienes pueden registrarlas (se anota en `recordatorios`).
 */
export const recordarTomasPendientes = onSchedule(
  { schedule: 'every 10 minutes', ...opciones },
  async () => {
    const ahora = partesEnZona(new Date(), ZONA_HORARIA.value());
    const personas = await db().collection('personas_cuidadas').get();
    let enviados = 0;

    for (const pSnap of personas.docs) {
      const medsSnap = await pSnap.ref.collection('medicamentos').get();
      const vencidas = dosisVencidas(
        medsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        ahora,
      );
      if (!vencidas.length) continue;

      // Por cada dosis: ¿ya hay toma registrada? ¿ya se recordó?
      const refs = vencidas.flatMap((v) => [
        pSnap.ref
          .collection('medicamentos')
          .doc(v.medicamento.id)
          .collection('tomas')
          .doc(v.idToma),
        pSnap.ref.collection('recordatorios').doc(`${v.medicamento.id}-${v.idToma}`),
      ]);
      const snaps = await db().getAll(...refs);
      const pendientes = vencidas.filter(
        (_, i) => !snaps[2 * i].exists && !snaps[2 * i + 1].exists,
      );
      if (!pendientes.length) continue;

      const p = { id: pSnap.id, ...pSnap.data() };
      const uids = deGuardia(await miembros(p.id), ahora);
      for (const v of pendientes) {
        await notificar(uids, {
          ...mensajeRecordatorio({
            personaNombre: p.nombre,
            medicamento: v.medicamento,
            horario: v.horario,
          }),
          url: `/personas/${p.id}/hoy`,
          personaId: p.id,
        });
        await pSnap.ref.collection('recordatorios').doc(`${v.medicamento.id}-${v.idToma}`).set({
          medicamentoId: v.medicamento.id,
          idToma: v.idToma,
          horario: v.horario,
          enviadoEn: FieldValue.serverTimestamp(),
        });
        enviados += 1;
      }
    }
    logger.info('Recordatorios de tomas', { enviados });
  },
);

/**
 * Cada 5 minutos avisa a quienes cuidan que se acerca una tarea de la rutina o una toma de
 * medicamento (tareas: `avisarMin` de cada una; medicamentos: AVISO_MEDICAMENTOS_MIN), y al equipo
 * que se acerca una cita del calendario (`avisarMin` de la cita; 1 h si no dice). Una sola vez por
 * horario o cita y, en la rutina, solo si todavía no se registró (se anota en `recordatorios`).
 */
export const avisarProximas = onSchedule({ schedule: 'every 5 minutes', ...opciones }, async () => {
  const instante = new Date();
  const ahora = partesEnZona(instante, ZONA_HORARIA.value());
  const personas = await db().collection('personas_cuidadas').get();
  let enviados = 0;
  let citas = 0;

  for (const pSnap of personas.docs) {
    enviados += await avisarRutinaDe(pSnap, ahora);
    citas += await avisarCitasDe(pSnap, instante, ahora);
  }
  logger.info('Avisos previos', { enviados, citas });
});

/** Tomas y tareas de la rutina de una persona cuya hora se acerca. Devuelve cuántos avisos mandó. */
async function avisarRutinaDe(pSnap, ahora) {
  const [medsSnap, tareasSnap] = await Promise.all([
    pSnap.ref.collection('medicamentos').get(),
    pSnap.ref.collection('tareas').get(),
  ]);
  const elementos = elementosAgenda(
    medsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    tareasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    AVISO_MEDICAMENTOS_MIN.value(),
  );
  const candidatos = proximos(elementos, ahora);
  if (!candidatos.length) return 0;

  // Por cada horario próximo: ¿ya se registró? ¿ya se avisó?
  const coleccionDe = (c) => (c.elemento.clase === 'medicamento' ? 'medicamentos' : 'tareas');
  const registrosDe = (c) => (c.elemento.clase === 'medicamento' ? 'tomas' : 'registros');
  const idAviso = (c) => `prox-${c.elemento.clase}-${c.elemento.id}-${c.idHorario}`;
  const refs = candidatos.flatMap((c) => [
    pSnap.ref
      .collection(coleccionDe(c))
      .doc(c.elemento.id)
      .collection(registrosDe(c))
      .doc(c.idHorario),
    pSnap.ref.collection('recordatorios').doc(idAviso(c)),
  ]);
  const snaps = await db().getAll(...refs);
  const pendientes = candidatos.filter(
    (_, i) => !snaps[2 * i].exists && !snaps[2 * i + 1].exists,
  );
  if (!pendientes.length) return 0;

  const p = { id: pSnap.id, ...pSnap.data() };
  const uids = deGuardia(await miembros(p.id), ahora);
  let enviados = 0;
  for (const c of pendientes) {
    await notificar(uids, {
      ...mensajeProximo({ personaNombre: p.nombre, ...c }),
      url: `/personas/${p.id}/hoy`,
      personaId: p.id,
    });
    await pSnap.ref.collection('recordatorios').doc(idAviso(c)).set({
      clase: c.elemento.clase,
      elementoId: c.elemento.id,
      idHorario: c.idHorario,
      horario: c.horario,
      enviadoEn: FieldValue.serverTimestamp(),
    });
    enviados += 1;
  }
  return enviados;
}

/**
 * Citas y terapias del calendario que se acercan: `avisarMin` minutos antes (1 h si la cita no
 * dice; 0 = sin aviso), una sola vez por cita y hora de inicio (si la mueven, vuelve a avisar).
 * Reciben el aviso quien acompaña, el responsable y los familiares que quieren avisos, y quien
 * está de guardia (destinatariosCita). Devuelve cuántos avisos mandó.
 */
async function avisarCitasDe(pSnap, instante, ahora) {
  const hasta = new Date(instante.getTime() + AVISO_CITAS_MAX_MIN * 60_000);
  const snap = await pSnap.ref
    .collection('eventos_calendario')
    .where('inicio', '>', Timestamp.fromDate(instante))
    .where('inicio', '<=', Timestamp.fromDate(hasta))
    .get();
  if (snap.empty) return 0;
  const candidatos = citasProximas(
    snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    instante.getTime(),
  );
  if (!candidatos.length) return 0;

  const idAviso = (c) => `prox-evento-${c.evento.id}-${c.evento.inicio.toMillis()}`;
  const avisos = await db().getAll(
    ...candidatos.map((c) => pSnap.ref.collection('recordatorios').doc(idAviso(c))),
  );
  const pendientes = candidatos.filter((_, i) => !avisos[i].exists);
  if (!pendientes.length) return 0;

  const p = { id: pSnap.id, ...pSnap.data() };
  const equipo = await miembros(p.id);
  const zona = ZONA_HORARIA.value();
  let enviados = 0;
  for (const c of pendientes) {
    const acompana = equipo.find((m) => m.uid === c.evento.responsableUid)?.nombre;
    await notificar(destinatariosCita(equipo, c.evento, ahora), {
      ...mensajeCita({
        personaNombre: p.nombre,
        evento: c.evento,
        faltanMin: c.faltanMin,
        inicio: partesEnZona(c.evento.inicio.toDate(), zona),
        ahora,
        acompana,
      }),
      url: `/personas/${p.id}/hoy`,
      personaId: p.id,
    });
    await pSnap.ref.collection('recordatorios').doc(idAviso(c)).set({
      clase: 'evento',
      elementoId: c.evento.id,
      inicio: c.evento.inicio,
      enviadoEn: FieldValue.serverTimestamp(),
    });
    enviados += 1;
  }
  return enviados;
}

/**
 * Al eliminar una cuenta en Firebase Auth (desde "Mi perfil"): quita al usuario de cada equipo y
 * borra su perfil. Si era la única persona en la bitácora de alguien, esa persona cuidada se borra
 * con todo su historial (nadie más podría verla). Disparador de 1.ª generación: Auth no tiene v2.
 */
export const limpiarUsuarioEliminado = authV1.user().onDelete(async (user) => {
  const uid = user.uid;
  const equipos = await db()
    .collection('personas_cuidadas')
    .where('miembrosUids', 'array-contains', uid)
    .get();
  let personasBorradas = 0;
  for (const pSnap of equipos.docs) {
    const restantes = (pSnap.data().miembrosUids ?? []).filter((u) => u !== uid);
    if (restantes.length === 0) {
      await db().recursiveDelete(pSnap.ref);
      personasBorradas += 1;
      continue;
    }
    const batch = db().batch();
    batch.delete(pSnap.ref.collection('miembros').doc(uid));
    batch.update(pSnap.ref, { miembrosUids: FieldValue.arrayRemove(uid) });
    await batch.commit();
  }
  await db().doc(`usuarios/${uid}`).delete();
  logger.info('Cuenta eliminada: datos limpiados', {
    uid,
    equipos: equipos.size,
    personasBorradas,
  });
});

/**
 * El responsable elimina a una persona cuidada con todo su historial. Va por Admin SDK porque las
 * reglas no dejan borrar subcolecciones desde la app: borra las invitaciones de la persona, la quita
 * del perfil de cada miembro y elimina el documento con todas sus subcolecciones. No se deshace.
 */
export const eliminarPersona = onCall({ cors: true }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para eliminar a la persona.');
  const personaId = req.data?.personaId;
  if (typeof personaId !== 'string' || !personaId) {
    throw new HttpsError('invalid-argument', 'Falta la persona.');
  }
  const ref = db().doc(`personas_cuidadas/${personaId}`);
  const [pSnap, miembroSnap] = await Promise.all([ref.get(), ref.collection('miembros').doc(uid).get()]);
  if (!pSnap.exists) throw new HttpsError('not-found', 'La persona ya no existe.');
  if (miembroSnap.data()?.rol !== 'cuidador_principal') {
    throw new HttpsError('permission-denied', 'Solo el responsable puede eliminar a la persona.');
  }
  const uids = pSnap.data().miembrosUids ?? [];
  const invitaciones = await db().collection('invitaciones').where('personaId', '==', personaId).get();
  const batch = db().batch();
  for (const inv of invitaciones.docs) batch.delete(inv.ref);
  for (const u of uids) {
    batch.set(db().doc(`usuarios/${u}`), { personas: FieldValue.arrayRemove(personaId) }, { merge: true });
  }
  await batch.commit();
  await db().recursiveDelete(ref);
  logger.info('Persona eliminada por su responsable', { personaId, uid, miembros: uids.length });
  return { eliminada: true };
});

/** Cliente de Gemini según IA_BACKEND (ver arriba). */
function clienteIA() {
  if (IA_BACKEND.value() === 'vertex') {
    return new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT,
      location: VERTEX_UBICACION.value(),
    });
  }
  const clave = claveGemini();
  if (!clave) {
    throw new HttpsError(
      'failed-precondition',
      'El asistente no está configurado: falta la clave de Gemini.',
    );
  }
  return new GoogleGenAI({ apiKey: clave });
}

function claveGemini() {
  try {
    const v = GEMINI_API_KEY.value() ?? '';
    return v && v !== 'pendiente' ? v : '';
  } catch {
    return '';
  }
}

/**
 * Asistente de IA. La app arma el contexto con los datos que el usuario ya puede leer (Firestore con
 * sus permisos) y esta función solo llama a Gemini con la clave del servidor. Se exige sesión y ser
 * miembro de la persona; así no hace falta App Check (reCAPTCHA / Play Integrity) en el cliente.
 */
/** Comprueba sesión, datos básicos y que el usuario sea miembro de la persona. */
async function verificarAcceso(req) {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión para usar el asistente.');
  const { personaId, contexto } = req.data ?? {};
  if (typeof personaId !== 'string' || !personaId) {
    throw new HttpsError('invalid-argument', 'Falta la persona.');
  }
  if (typeof contexto !== 'string' || contexto.length > 200_000) {
    throw new HttpsError('invalid-argument', 'El contexto no es válido.');
  }
  const pSnap = await db().doc(`personas_cuidadas/${personaId}`).get();
  if (!pSnap.exists || !(pSnap.data().miembrosUids ?? []).includes(uid)) {
    throw new HttpsError('permission-denied', 'No tienes acceso a esta persona.');
  }
  return { uid, personaId, contexto };
}

function fechaHoy(hoy) {
  return typeof hoy === 'string' && hoy ? hoy : new Date().toISOString();
}

/**
 * Resumen narrativo de un periodo para el reporte PDF. Recibe el mismo contexto que el chat pero
 * acotado al periodo, y devuelve texto plano con secciones fijas (INSTRUCCIONES_RESUMEN).
 */
export const resumirReporte = onCall({ secrets: [GEMINI_API_KEY], cors: true }, async (req) => {
  const { uid, personaId, contexto } = await verificarAcceso(req);
  const { rango, hoy } = req.data ?? {};
  const periodo = typeof rango === 'string' && rango ? rango : 'indicado';
  return generarConGemini({
    uid,
    personaId,
    contents: [
      {
        role: 'user',
        parts: [{ text: `Escribe el resumen del periodo ${periodo} para el reporte.` }],
      },
    ],
    systemInstruction: [
      INSTRUCCIONES_RESUMEN,
      `Hoy es ${fechaHoy(hoy)}.`,
      'DATOS DEL PERIODO:',
      contexto,
    ].join(`

`),
  });
});

export const preguntarAsistente = onCall({ secrets: [GEMINI_API_KEY], cors: true }, async (req) => {
  const { uid, personaId, contexto } = await verificarAcceso(req);
  const { pregunta, hoy, historial } = req.data ?? {};
  if (typeof pregunta !== 'string' || !pregunta.trim()) {
    throw new HttpsError('invalid-argument', 'Falta la pregunta.');
  }
  return generarConGemini({
    uid,
    personaId,
    contents: [
      ...historialGemini(historial),
      { role: 'user', parts: [{ text: pregunta.slice(0, 2000) }] },
    ],
    systemInstruction: [INSTRUCCIONES_ASISTENTE, `Hoy es ${fechaHoy(hoy)}.`, contexto].join(`

`),
  });
});

/** Llama a Gemini (según IA_BACKEND) y traduce los fallos a errores con mensaje para el usuario. */
async function generarConGemini({ uid, personaId, contents, systemInstruction }) {
  const ai = clienteIA();
  try {
    const respuesta = await ai.models.generateContent({
      model: MODELO_IA.value(),
      contents,
      config: {
        systemInstruction,
        temperature: 0.3,
        // Los modelos con razonamiento gastan parte del presupuesto en pensar; margen amplio
        maxOutputTokens: 4096,
      },
    });
    const texto = (respuesta.text ?? '').trim();
    if (!texto) throw new HttpsError('internal', 'El modelo no devolvió respuesta.');
    return { texto };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    const mensaje = String(error?.message ?? error);
    logger.error('Gemini falló', { uid, personaId, error: mensaje.slice(0, 500) });
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(mensaje)) {
      throw new HttpsError(
        'resource-exhausted',
        'Se alcanzó el límite de consultas del asistente.',
      );
    }
    if (/prepayment credits|billing/i.test(mensaje)) {
      throw new HttpsError(
        'failed-precondition',
        'La Gemini API del proyecto no tiene créditos (AI Studio → proyecto → facturación).',
      );
    }
    if (/aiplatform/i.test(mensaje) && /not been used|disabled|SERVICE_DISABLED/i.test(mensaje)) {
      throw new HttpsError(
        'failed-precondition',
        'Falta habilitar la API de Vertex AI en el proyecto de Google Cloud (aiplatform.googleapis.com).',
      );
    }
    if (/API key not valid|API_KEY_INVALID/i.test(mensaje)) {
      throw new HttpsError('failed-precondition', 'La clave de Gemini no es válida.');
    }
    if (/PERMISSION_DENIED|permission/i.test(mensaje)) {
      throw new HttpsError(
        'failed-precondition',
        'La función no tiene permiso para usar Vertex AI: asigna el rol "Usuario de Vertex AI" a la cuenta de servicio de Cloud Functions.',
      );
    }
    throw new HttpsError('internal', 'No se pudo obtener respuesta del modelo.');
  }
}
