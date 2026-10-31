import { Injectable, inject } from '@angular/core';
import { Firestore, Timestamp, doc, serverTimestamp, writeBatch } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { appUrl } from '../../../environments/firebase.config';
import { Medicamento, PersonaCuidada, RegistroTarea, Tarea, TipoTarea, Toma } from '../models';
import { inicioDeDia, sumarDias } from '../utils/fechas';
import { AuthService } from './auth.service';
import { DosisProgramada, dosisDelDia, medicamentoDelDia } from './medicamentos.service';
import { TareaProgramada, tareaDelDia, tareasDelDia } from './tareas.service';

/** Bytes aleatorios del token (24 bytes = 32 caracteres en base64url). */
const BYTES_TOKEN = 24;

/** Lo que devuelve la Cloud Function semaforoCompartido (functions/logica.js, datosSemaforo). */
export interface DatosSemaforoCompartido {
  nombre: string;
  medicamentos: {
    id: string;
    nombre: string;
    dosis: string;
    notas: string;
    horarios: string[];
    segunNecesidad: boolean;
    inicio: string | null;
    duracionDias: number | null;
    creadoEn: number | null;
  }[];
  tomas: { medicamentoId: string; id: string; tomado: boolean; horaProgramada: number | null }[];
  tareas: {
    id: string;
    tipo: string;
    nombre: string;
    notas: string;
    horarios: string[];
    dias: number[];
    duracionMin: number;
    avisarMin: number;
    creadoEn: number | null;
  }[];
  registros: { tareaId: string; id: string; hecha: boolean }[];
}

const marca = (ms: number | null) => (ms === null ? undefined : Timestamp.fromMillis(ms));

/**
 * Convierte lo que devuelve la función en la misma agenda del día que arma la app en tiempo real
 * (dosisDelDia / tareasDelDia), para que el semáforo compartido se calcule exactamente igual.
 */
export function agendaCompartida(
  datos: DatosSemaforoCompartido,
  dia: Date,
): { dosis: DosisProgramada[]; tareas: TareaProgramada[] } {
  const meds = datos.medicamentos
    .map(
      (m): Medicamento => ({
        id: m.id,
        nombre: m.nombre,
        dosis: m.dosis,
        notas: m.notas,
        horarios: m.horarios,
        segunNecesidad: m.segunNecesidad,
        inicio: m.inicio ?? undefined,
        duracionDias: m.duracionDias,
        creadoEn: marca(m.creadoEn),
        inventario: null,
        activo: true,
      }),
    )
    .filter((m) => medicamentoDelDia(m, dia));
  const tareas = datos.tareas
    .map(
      (t): Tarea => ({
        id: t.id,
        tipo: t.tipo as TipoTarea,
        nombre: t.nombre,
        notas: t.notas,
        horarios: t.horarios,
        dias: t.dias,
        duracionMin: t.duracionMin,
        avisarMin: t.avisarMin,
        creadoEn: marca(t.creadoEn),
        activo: true,
      }),
    )
    .filter((t) => tareaDelDia(t, dia));

  const tomas = (medId: string): Toma[] =>
    datos.tomas
      .filter((t) => t.medicamentoId === medId && t.horaProgramada !== null)
      .map((t) => ({
        id: t.id,
        tomado: t.tomado,
        horaProgramada: Timestamp.fromMillis(t.horaProgramada!),
        registradoPor: '',
      }));
  const registros = (tareaId: string): RegistroTarea[] =>
    datos.registros
      .filter((r) => r.tareaId === tareaId)
      .map((r) => ({ id: r.id, hecha: r.hecha, horaProgramada: Timestamp.fromMillis(0), registradoPor: '' }));

  return {
    dosis: dosisDelDia(meds.map((m) => ({ m, tomas: tomas(m.id!) })), dia),
    tareas: tareasDelDia(tareas.map((t) => ({ t, registros: registros(t.id!) })), dia),
  };
}

/** Token aleatorio en base64url (sin relleno), del formato que aceptan las reglas y la función. */
export function nuevoTokenSemaforo(): string {
  const bytes = new Uint8Array(BYTES_TOKEN);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Semáforo compartido por enlace: cualquiera con el enlace (https://<app>/s/<token>) ve el semáforo
 * del día de la persona sin iniciar sesión, solo lectura. El token no vence; el responsable lo crea
 * la primera vez que se comparte y puede cambiarlo, con lo que el anterior deja de funcionar.
 */
@Injectable({ providedIn: 'root' })
export class SemaforoCompartidoService {
  private readonly db = inject(Firestore);
  private readonly fns = inject(Functions);
  private readonly authSvc = inject(AuthService);

  enlace(token: string): string {
    return `${appUrl}/s/${token}`;
  }

  /**
   * Crea (o cambia) el token de la persona en un solo batch: lo guarda en la persona, crea su
   * documento en semaforos_compartidos y borra el anterior. Solo el responsable (las rules lo exigen).
   */
  async crearToken(persona: PersonaCuidada): Promise<string> {
    const uid = this.authSvc.uid;
    if (!uid || !persona.id) throw new Error('Sin sesión o sin persona');
    const token = nuevoTokenSemaforo();
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, `personas_cuidadas/${persona.id}`), { enlaceSemaforo: token });
    batch.set(doc(this.db, `semaforos_compartidos/${token}`), {
      personaId: persona.id,
      creadoPor: uid,
      creadoEn: serverTimestamp(),
    });
    if (persona.enlaceSemaforo) batch.delete(doc(this.db, `semaforos_compartidos/${persona.enlaceSemaforo}`));
    await batch.commit();
    return token;
  }

  /** Imagen (data URL) del QR con el enlace del semáforo. */
  async qrDataUrl(token: string): Promise<string> {
    // `qrcode` es CommonJS: con import() dinámico el bundler lo expone bajo `default`
    const mod = await import('qrcode');
    const QRCode = mod.default ?? mod;
    return QRCode.toDataURL(this.enlace(token), { width: 512, margin: 1, errorCorrectionLevel: 'M' });
  }

  /** Datos del semáforo de hoy (día local de este dispositivo) para quien abre el enlace. */
  async datos(token: string, dia: Date): Promise<DatosSemaforoCompartido> {
    const desde = inicioDeDia(dia);
    const llamar = httpsCallable<{ token: string; desde: number; hasta: number }, DatosSemaforoCompartido>(
      this.fns,
      'semaforoCompartido',
    );
    const r = await llamar({ token, desde: desde.getTime(), hasta: sumarDias(desde, 1).getTime() });
    return r.data;
  }
}
