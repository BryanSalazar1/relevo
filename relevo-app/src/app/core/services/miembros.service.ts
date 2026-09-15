import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  arrayRemove,
  collection,
  collectionData,
  doc,
  docData,
  getDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { Miembro, ROLES, Rol, TipoUsuario, Usuario } from '../models';
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

  /** Tipo de cuenta de otro usuario (para saber qué roles puede tener). */
  async tipoDe(uid: string): Promise<TipoUsuario | undefined> {
    const snap = await getDoc(doc(this.db, 'usuarios', uid));
    return (snap.data() as Usuario | undefined)?.tipo;
  }

  /** Cambia el rol de un miembro (solo el responsable; las rules validan que sea compatible). */
  async cambiarRol(personaId: string, uid: string, rol: Rol): Promise<void> {
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/miembros/${uid}`), { rol });
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
}
