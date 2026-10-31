import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  arrayUnion,
  collection,
  collectionData,
  doc,
  docData,
  query,
  deleteField,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { AVISOS_POR_DEFECTO, PersonaCuidada } from '../models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PersonasService {
  private readonly db = inject(Firestore);
  private readonly fns = inject(Functions);
  private readonly authSvc = inject(AuthService);

  /**
   * Elimina a la persona con todo su historial. Lo hace la Cloud Function `eliminarPersona`
   * (solo el responsable): borra las subcolecciones, las invitaciones y la quita del perfil de
   * cada miembro. No se puede deshacer.
   */
  async eliminar(personaId: string): Promise<void> {
    const llamar = httpsCallable<{ personaId: string }, { eliminada: boolean }>(this.fns, 'eliminarPersona');
    await llamar({ personaId });
  }

  /** Personas cuidadas a las que el usuario actual tiene acceso, en tiempo real. */
  /**
   * Personas de las que este usuario dejó de ser miembro durante la sesión (lo quitaron del equipo).
   * La consulta en vivo puede conservar la versión anterior del documento, que ya no se puede leer;
   * se ocultan de la lista hasta la próxima vez que se abra la app.
   */
  private readonly sinAcceso$ = new BehaviorSubject<ReadonlySet<string>>(new Set());

  marcarSinAcceso(personaId: string) {
    this.sinAcceso$.next(new Set([...this.sinAcceso$.value, personaId]));
  }

  misPersonas(): Observable<PersonaCuidada[]> {
    return this.authSvc.user$.pipe(
      switchMap((user) => {
        if (!user) return of([] as PersonaCuidada[]);
        const q = query(
          collection(this.db, 'personas_cuidadas'),
          where('miembrosUids', 'array-contains', user.uid),
        );
        return combineLatest([
          collectionData(q, { idField: 'id' }) as Observable<PersonaCuidada[]>,
          this.sinAcceso$,
        ]).pipe(
          map(([lista, fuera]) =>
            lista.filter((p) => !p.id || !fuera.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
          ),
          // Al cerrar sesión el listener puede recibir permission-denied antes de cancelarse
          catchError(() => of([] as PersonaCuidada[])),
        );
      }),
    );
  }

  /** Una persona cuidada en tiempo real (undefined si no existe o no hay permiso). */
  persona(id: string): Observable<PersonaCuidada | undefined> {
    return (
      docData(doc(this.db, 'personas_cuidadas', id), { idField: 'id' }) as Observable<
        PersonaCuidada | undefined
      >
    ).pipe(catchError(() => of(undefined)));
  }

  /**
   * Actualiza datos básicos o de la ficha médica (solo el responsable, según las rules). Un valor
   * `undefined` borra el campo, para poder quitar la fecha, la descripción, el seguro, etc.
   */
  async actualizar(
    id: string,
    datos: Partial<Omit<PersonaCuidada, 'id' | 'miembrosUids' | 'creadoPor' | 'creadoEn'>>,
  ): Promise<void> {
    const cambios: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(datos)) {
      cambios[clave] = valor === undefined ? deleteField() : valor;
    }
    await updateDoc(doc(this.db, 'personas_cuidadas', id), cambios);
  }

  /**
   * Da de alta a una persona cuidada (datos básicos y, si se capturó, su ficha médica). Solo lo
   * permiten las rules a cuentas de tipo familiar, que quedan como responsables
   * (cuidador_principal). Persona + miembro + perfil van en un batch para que queden consistentes.
   */
  async crearPersona(datos: Pick<PersonaCuidada, 'nombre'> & Partial<PersonaCuidada>): Promise<string> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    if (this.authSvc.tipoActual !== 'familiar') {
      throw new Error('Solo una cuenta de familiar puede dar de alta a una persona cuidada');
    }

    const personaRef = doc(collection(this.db, 'personas_cuidadas'));
    const batch = writeBatch(this.db);
    // Los campos opcionales sin llenar llegan como undefined, y Firestore no los acepta
    const capturado = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined));

    batch.set(personaRef, {
      alergias: [],
      condiciones: [],
      contactosEmergencia: [],
      ...capturado,
      miembrosUids: [uid],
      creadoPor: uid,
      creadoEn: serverTimestamp(),
    });
    batch.set(doc(personaRef, 'miembros', uid), {
      uid,
      rol: 'cuidador_principal',
      nombre: this.authSvc.nombreActual,
      avisos: AVISOS_POR_DEFECTO.cuidador_principal,
      agregadoEn: serverTimestamp(),
    });
    batch.update(doc(this.db, 'usuarios', uid), { personas: arrayUnion(personaRef.id) });

    await batch.commit();
    return personaRef.id;
  }
}
