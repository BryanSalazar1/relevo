import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  arrayRemove,
  collection,
  collectionData,
  deleteField,
  doc,
  docData,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { Miembro, PreferenciasAvisos, Rol, ROLES, Turno } from '../models';
import { AuthService } from './auth.service';

const ORDEN_ROL: Record<Rol, number> = Object.fromEntries(
  ROLES.map((r, i) => [r.valor, i]),
) as Record<Rol, number>;

@Injectable({ providedIn: 'root' })
export class MiembrosService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  /** Miembros de una persona cuidada, ordenados por rol y nombre. */
  miembros(personaId: string): Observable<Miembro[]> {
    const ref = collection(this.db, `personas_cuidadas/${personaId}/miembros`);
    return (collectionData(ref) as Observable<Miembro[]>).pipe(
      map((lista) =>
        [...lista].sort(
          (a, b) => ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] || a.nombre.localeCompare(b.nombre),
        ),
      ),
      catchError(() => of([] as Miembro[])),
    );
  }

  /** Rol del usuario actual en esa persona (null si no es miembro). */
  miRol(personaId: string): Observable<Rol | null> {
    return this.authSvc.user$.pipe(
      switchMap((user) => {
        if (!user) return of(null);
        const ref = doc(this.db, `personas_cuidadas/${personaId}/miembros/${user.uid}`);
        return (docData(ref) as Observable<Miembro | undefined>).pipe(
          map((m) => m?.rol ?? null),
          catchError(() => of(null)),
        );
      }),
    );
  }

  /** Cambia el rol de un miembro con esta persona (solo el responsable; las rules validan el rol). */
  async cambiarRol(personaId: string, uid: string, rol: Rol): Promise<void> {
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`), { rol });
  }

  /** Mi documento de miembro en esa persona (turnos y preferencias de avisos), en tiempo real. */
  miMembresia(personaId: string): Observable<Miembro | null> {
    return this.authSvc.user$.pipe(
      switchMap((user) => {
        if (!user) return of(null);
        const ref = doc(this.db, `personas_cuidadas/${personaId}/miembros/${user.uid}`);
        return (docData(ref, { idField: 'uid' }) as Observable<Miembro | undefined>).pipe(
          map((m) => m ?? null),
          catchError(() => of(null)),
        );
      }),
    );
  }

  /** Guardias de un miembro (solo el responsable; las rules exigen que uid y rol no cambien). */
  async actualizarTurnos(personaId: string, uid: string, turnos: Turno[]): Promise<void> {
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`), { turnos });
  }

  /** Mis preferencias de avisos en esa persona (cada quien las suyas; las rules solo permiten estos campos). */
  async actualizarPreferencias(personaId: string, prefs: PreferenciasAvisos): Promise<void> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('Sin sesión');
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`), {
      avisos: prefs.avisos,
      recordatorios: prefs.recordatorios,
      soloEnTurno: prefs.soloEnTurno,
    });
  }

  /**
   * Pone en pausa a un enfermero o familiar (solo el responsable): sigue en el equipo y ve todo, pero
   * las rules no le dejan registrar y el servidor no le manda recordatorios ni avisos.
   */
  async pausar(personaId: string, uid: string, motivo: string): Promise<void> {
    const texto = motivo.trim().slice(0, 120);
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`), {
      pausado: true,
      pausadoDesde: serverTimestamp(),
      pausaMotivo: texto ? texto : deleteField(),
    });
  }

  /** Lo reactiva: vuelve a registrar y a recibir avisos como antes. */
  async reactivar(personaId: string, uid: string): Promise<void> {
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`), {
      pausado: deleteField(),
      pausadoDesde: deleteField(),
      pausaMotivo: deleteField(),
    });
  }

  /** Quita a un miembro (solo lo permiten las rules al responsable). */
  async quitar(personaId: string, uid: string): Promise<void> {
    const batch = writeBatch(this.db);
    batch.delete(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`));
    batch.update(doc(this.db, `personas_cuidadas/${personaId}`), {
      miembrosUids: arrayRemove(uid),
    });
    await batch.commit();
  }

  /**
   * Salir de un equipo por cuenta propia: borra mi membresía, me quita de miembrosUids y de mi lista
   * de personas. Las rules no lo permiten al responsable (primero cede el rol o elimina a la persona).
   */
  async salir(personaId: string): Promise<void> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    const batch = writeBatch(this.db);
    batch.delete(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`));
    batch.update(doc(this.db, `personas_cuidadas/${personaId}`), { miembrosUids: arrayRemove(uid) });
    batch.update(doc(this.db, `usuarios/${uid}`), { personas: arrayRemove(personaId) });
    await batch.commit();
  }
}
