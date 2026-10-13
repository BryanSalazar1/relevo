import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  Firestore,
  Query,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of } from 'rxjs';
import { AVISO_CITA_MIN_POR_DEFECTO, EventoCalendario, TipoEvento } from '../models';
import { textoDuracion } from '../utils/fechas';
import { AuthService } from './auth.service';

/** Lo que captura el formulario de una cita (pages/citas/cita.modal.ts). */
export interface DatosEvento {
  tipo: TipoEvento;
  titulo: string;
  inicio: Date;
  fin: Date;
  lugar?: string;
  notas?: string;
  responsableUid?: string | null;
  /** Minutos antes del inicio en que se avisa; 0 = sin aviso */
  avisarMin: number;
}

/** Duración de una cita en minutos (0 si los datos no cuadran). */
export function duracionCita(ev: EventoCalendario): number {
  const min = Math.round((ev.fin.toDate().getTime() - ev.inicio.toDate().getTime()) / 60000);
  return min > 0 ? min : 0;
}

/** "1 h · Hospital Ángeles · acompaña Sofía", para listar una cita (sin las notas). */
export function detalleCita(
  ev: EventoCalendario,
  nombreDe: (uid: string) => string | undefined,
): string {
  const partes: string[] = [];
  const min = duracionCita(ev);
  if (min > 0) partes.push(textoDuracion(min));
  if (ev.lugar) partes.push(ev.lugar);
  const quien = ev.responsableUid ? nombreDe(ev.responsableUid) : undefined;
  if (quien) partes.push(`acompaña ${quien}`);
  return partes.join(' · ');
}

/**
 * Citas, terapias y estudios de una sola vez (eventos_calendario). Los agendan el responsable y
 * los familiares (PUEDE_EDITAR_CITAS); todo el equipo los ve en Hoy y en Plan › Citas. Las Cloud
 * Functions avisan antes de cada uno. Los turnos de versiones anteriores se guardan en la misma
 * colección y aquí se omiten.
 */
@Injectable({ providedIn: 'root' })
export class EventosService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  private ref(personaId: string) {
    return collection(this.db, `personas_cuidadas/${personaId}/eventos_calendario`);
  }

  /** Citas desde `desde` (normalmente el inicio de hoy), de la más cercana en adelante. */
  proximos(personaId: string, desde: Date, maximo = 50): Observable<EventoCalendario[]> {
    const q = query(
      this.ref(personaId),
      where('inicio', '>=', Timestamp.fromDate(desde)),
      orderBy('inicio', 'asc'),
      limit(maximo),
    );
    return this.leer(q);
  }

  /** Citas anteriores a `hasta`, de la más reciente a la más antigua. */
  anteriores(personaId: string, hasta: Date, maximo = 10): Observable<EventoCalendario[]> {
    const q = query(
      this.ref(personaId),
      where('inicio', '<', Timestamp.fromDate(hasta)),
      orderBy('inicio', 'desc'),
      limit(maximo),
    );
    return this.leer(q);
  }

  private leer(q: Query<DocumentData>): Observable<EventoCalendario[]> {
    return (collectionData(q, { idField: 'id' }) as Observable<EventoCalendario[]>).pipe(
      map((lista) => lista.filter((e) => e.tipo !== 'turno' && !!e.inicio && !!e.fin)),
      catchError(() => of([] as EventoCalendario[])),
    );
  }

  async crear(personaId: string, datos: DatosEvento): Promise<string> {
    const ref = await addDoc(this.ref(personaId), {
      ...this.limpiar(datos),
      creadoPor: this.authSvc.uid,
      creadoEn: serverTimestamp(),
    });
    return ref.id;
  }

  async actualizar(personaId: string, id: string, datos: DatosEvento): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), this.limpiar(datos));
  }

  async eliminar(personaId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.ref(personaId), id));
  }

  /** Lo que se guarda, con los mismos topes que firestore.rules (eventoValido). */
  private limpiar(d: DatosEvento) {
    return {
      tipo: d.tipo,
      titulo: d.titulo.trim().slice(0, 80),
      inicio: Timestamp.fromDate(d.inicio),
      fin: Timestamp.fromDate(d.fin),
      lugar: (d.lugar ?? '').trim().slice(0, 120),
      notas: (d.notas ?? '').trim().slice(0, 300),
      responsableUid: d.responsableUid || null,
      avisarMin: Number.isFinite(d.avisarMin)
        ? Math.max(0, Math.round(d.avisarMin))
        : AVISO_CITA_MIN_POR_DEFECTO,
    };
  }
}
