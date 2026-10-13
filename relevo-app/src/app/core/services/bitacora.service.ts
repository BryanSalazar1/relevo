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
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { EntradaBitacora, SignoVital, TipoEntrada } from '../models';
import { AuthService } from './auth.service';
import { MedicamentosService, TomaRegistrada } from './medicamentos.service';
import { SignosService } from './signos.service';
import { RegistroReciente, TareasService } from './tareas.service';

export interface DatosEntrada {
  tipo: TipoEntrada;
  texto: string;
  fecha: Date;
}

/** Un elemento de la línea de tiempo: algo que alguien escribió o una toma de medicamento registrada. */
export type ItemBitacora =
  | { clase: 'entrada'; id: string; fecha: Date; entrada: EntradaBitacora }
  | { clase: 'toma'; id: string; fecha: Date; toma: TomaRegistrada }
  | { clase: 'tarea'; id: string; fecha: Date; registro: RegistroReciente }
  /** Mediciones sueltas tomadas en el mismo momento (las de una tarea van en su registro) */
  | { clase: 'signo'; id: string; fecha: Date; signos: SignoVital[] };

/** Agrupa las mediciones sueltas por instante y autor: una línea por cada vez que se midió. */
export function agruparSignosSueltos(signos: SignoVital[]): ItemBitacora[] {
  const grupos = new Map<string, SignoVital[]>();
  for (const s of signos) {
    if (s.tareaId) continue;
    const clave = `${s.fecha.toMillis()}-${s.autorUid}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), s]);
  }
  return [...grupos.entries()].map(([clave, lista]) => ({
    clase: 'signo',
    id: `s-${clave}`,
    fecha: lista[0].fecha.toDate(),
    signos: lista,
  }));
}

@Injectable({ providedIn: 'root' })
export class BitacoraService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);
  private readonly medsSvc = inject(MedicamentosService);
  private readonly tareasSvc = inject(TareasService);
  private readonly signosSvc = inject(SignosService);

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

  /**
   * Entradas escritas, tomas de medicamentos y tareas de la rutina en una sola línea de tiempo, de lo más reciente
   * a lo más antiguo, ordenadas por el momento en que se registraron (no por la hora del evento
   * ni por la hora programada de la dosis).
   */
  lineaDeTiempo(personaId: string): Observable<ItemBitacora[]> {
    return combineLatest([
      this.entradas(personaId),
      this.medsSvc.tomasRecientes(personaId),
      this.tareasSvc.registrosRecientes(personaId),
      this.signosSvc.ultimos(personaId),
    ]).pipe(
      map(([entradas, tomas, registros, signos]) =>
        [
          ...agruparSignosSueltos(signos),
          ...entradas.map((e): ItemBitacora => ({
            clase: 'entrada',
            id: `e-${e.id}`,
            fecha: (e.creadoEn ?? e.fecha).toDate(),
            entrada: e,
          })),
          ...tomas.map((t): ItemBitacora => ({
            clase: 'toma',
            id: `t-${t.medicamento.id}-${t.toma.id}`,
            fecha: t.fecha,
            toma: t,
          })),
          ...registros.map((r): ItemBitacora => ({
            clase: 'tarea',
            id: `r-${r.tarea.id}-${r.registro.id}`,
            fecha: r.fecha,
            registro: r,
          })),
        ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
      ),
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
      autorUid: uid,
      autorNombre: this.authSvc.nombreActual,
      fecha: Timestamp.fromDate(datos.fecha),
      creadoEn: serverTimestamp(),
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
