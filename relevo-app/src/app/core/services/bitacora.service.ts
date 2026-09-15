import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, catchError, of } from 'rxjs';
import { EntradaBitacora, TipoEntrada } from '../models';
import { AuthService } from './auth.service';

export interface DatosEntrada {
  tipo: TipoEntrada;
  texto: string;
  fecha: Date;
}

@Injectable({ providedIn: 'root' })
export class BitacoraService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  private ref(personaId: string) {
    return collection(this.db, `personas_cuidadas/${personaId}/entradas_bitacora`);
  }

  /** Feed en tiempo real, de la más reciente a la más antigua. */
  entradas(personaId: string, maximo = 300): Observable<EntradaBitacora[]> {
    const q = query(this.ref(personaId), orderBy('fecha', 'desc'), limit(maximo));
    return (collectionData(q, { idField: 'id' }) as Observable<EntradaBitacora[]>).pipe(
      catchError(() => of([] as EntradaBitacora[])),
    );
  }

  /** Entradas en un rango [desde, hasta) en orden cronológico (para el reporte). */
  async entre(personaId: string, desde: Date, hasta: Date): Promise<EntradaBitacora[]> {
    const q = query(
      this.ref(personaId),
      where('fecha', '>=', Timestamp.fromDate(desde)),
      where('fecha', '<', Timestamp.fromDate(hasta)),
      orderBy('fecha', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EntradaBitacora, 'id'>) }));
  }

  async crear(personaId: string, datos: DatosEntrada): Promise<string> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    const ref = await addDoc(this.ref(personaId), {
      tipo: datos.tipo,
      texto: datos.texto,
      fotos: [],
      notaVozUrl: null,
      autorUid: uid,
      autorNombre: this.authSvc.nombreActual,
      fecha: Timestamp.fromDate(datos.fecha),
    });
    return ref.id;
  }

  async actualizar(personaId: string, id: string, datos: DatosEntrada): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), {
      tipo: datos.tipo,
      texto: datos.texto,
      fecha: Timestamp.fromDate(datos.fecha),
    });
  }

  async eliminar(personaId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.ref(personaId), id));
  }
}
