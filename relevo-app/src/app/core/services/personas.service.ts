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
      agregadoEn: serverTimestamp(),
    });
    batch.update(doc(this.db, 'usuarios', uid), { personas: arrayUnion(personaRef.id) });

    await batch.commit();
    return personaRef.id;
  }
}
