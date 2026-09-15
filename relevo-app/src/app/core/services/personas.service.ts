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
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { PersonaCuidada } from '../models';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PersonasService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  /** Personas cuidadas a las que el usuario actual tiene acceso, en tiempo real. */
  misPersonas(): Observable<PersonaCuidada[]> {
    return this.authSvc.user$.pipe(
      switchMap((user) => {
        if (!user) return of([] as PersonaCuidada[]);
        const q = query(
          collection(this.db, 'personas_cuidadas'),
          where('miembrosUids', 'array-contains', user.uid),
        );
        return (collectionData(q, { idField: 'id' }) as Observable<PersonaCuidada[]>).pipe(
          map((lista) => [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre))),
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
   * Da de alta a una persona cuidada. Solo lo permiten las rules a cuentas de tipo familiar,
   * que quedan como responsables (cuidador_principal). Persona + miembro + perfil van en un
   * batch para que queden consistentes.
   */
  /**
   * Actualiza los datos básicos (solo el responsable, según las rules). Un valor `undefined`
   * borra el campo, para poder quitar la fecha o la descripción.
   */
  async actualizar(
    id: string,
    datos: Partial<Pick<PersonaCuidada, 'nombre' | 'fechaNacimiento' | 'descripcion'>>,
  ): Promise<void> {
    const cambios: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(datos)) {
      cambios[clave] = valor === undefined ? deleteField() : valor;
    }
    await updateDoc(doc(this.db, 'personas_cuidadas', id), cambios);
  }

  async crearPersona(datos: Pick<PersonaCuidada, 'nombre'> & Partial<PersonaCuidada>): Promise<string> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    if (this.authSvc.tipoActual !== 'familiar') {
      throw new Error('Solo una cuenta de familiar puede dar de alta a una persona cuidada');
    }

    const personaRef = doc(collection(this.db, 'personas_cuidadas'));
    const batch = writeBatch(this.db);

    batch.set(personaRef, {
      alergias: [],
      condiciones: [],
      contactosEmergencia: [],
      ...datos,
      miembrosUids: [uid],
      creadoPor: uid,
      creadoEn: serverTimestamp(),
    });
    batch.set(doc(personaRef, 'miembros', uid), {
      uid,
      rol: 'cuidador_principal',
      nombre: this.authSvc.nombreActual,
      agregadoEn: serverTimestamp(),
    });
    batch.update(doc(this.db, 'usuarios', uid), { personas: arrayUnion(personaRef.id) });

    await batch.commit();
    return personaRef.id;
  }
}
