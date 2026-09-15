import { formatDate } from '@angular/common';
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
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { Medicamento, Toma } from '../models';
import { inicioDeDia, sumarDias } from '../utils/fechas';
import { AuthService } from './auth.service';

export interface DatosMedicamento {
  nombre: string;
  dosis: string;
  horarios: string[];
  inventario: number | null;
  notas?: string;
}

/** Una dosis programada de un día concreto, con su registro (si existe). */
export interface DosisProgramada {
  medicamento: Medicamento;
  horario: string;
  hora: Date;
  idToma: string;
  toma?: Toma;
}

export type EstadoToma = 'tomada' | 'omitida' | 'quitar';

/** Toma registrada junto con su medicamento, para mostrarla fuera de la agenda (p. ej. en la bitácora). */
export interface TomaRegistrada {
  medicamento: Medicamento;
  toma: Toma;
  /** Hora programada de la dosis; es la que ordena la línea de tiempo. */
  fecha: Date;
}

/** Id determinista de la toma: la misma hora programada siempre apunta al mismo documento. */
export function idToma(hora: Date): string {
  return formatDate(hora, 'yyyyMMdd-HHmm', 'es');
}

/** Fecha concreta de un horario "HH:mm" en un día dado. */
export function fechaDe(dia: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = inicioDeDia(dia);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

@Injectable({ providedIn: 'root' })
export class MedicamentosService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  private ref(personaId: string) {
    return collection(this.db, `personas_cuidadas/${personaId}/medicamentos`);
  }

  /** Medicamentos de la persona: activos primero, por nombre. */
  medicamentos(personaId: string): Observable<Medicamento[]> {
    return (collectionData(this.ref(personaId), { idField: 'id' }) as Observable<Medicamento[]>).pipe(
      map((lista) =>
        [...lista].sort(
          (a, b) =>
            Number(b.activo !== false) - Number(a.activo !== false) || a.nombre.localeCompare(b.nombre),
        ),
      ),
      catchError(() => of([] as Medicamento[])),
    );
  }

  /** Tomas registradas de un medicamento en un día. */
  tomasDelDia(personaId: string, medicamentoId: string, dia: Date): Observable<Toma[]> {
    const inicio = inicioDeDia(dia);
    const q = query(
      collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${medicamentoId}/tomas`),
      where('horaProgramada', '>=', Timestamp.fromDate(inicio)),
      where('horaProgramada', '<', Timestamp.fromDate(sumarDias(inicio, 1))),
    );
    return (collectionData(q, { idField: 'id' }) as Observable<Toma[]>).pipe(
      catchError(() => of([] as Toma[])),
    );
  }

  /** Agenda del día: cada horario de cada medicamento activo, cruzado con su toma registrada. */
  agendaDelDia(personaId: string, dia: Date): Observable<DosisProgramada[]> {
    return this.medicamentos(personaId).pipe(
      switchMap((meds) => {
        const activos = meds.filter((m) => m.activo !== false && m.id);
        if (!activos.length) return of([] as DosisProgramada[]);
        return combineLatest(
          activos.map((m) =>
            this.tomasDelDia(personaId, m.id!, dia).pipe(map((tomas) => ({ m, tomas }))),
          ),
        ).pipe(
          map((pares) =>
            pares
              .flatMap(({ m, tomas }) =>
                (m.horarios ?? []).map((horario) => {
                  const hora = fechaDe(dia, horario);
                  const id = idToma(hora);
                  return { medicamento: m, horario, hora, idToma: id, toma: tomas.find((t) => t.id === id) };
                }),
              )
              .sort((a, b) => a.hora.getTime() - b.hora.getTime()),
          ),
        );
      }),
    );
  }

  /**
   * Las `maximo` tomas registradas más recientes (tomadas u omitidas) de todos los medicamentos,
   * incluidos los suspendidos, de la más reciente a la más antigua. Alimenta la bitácora.
   */
  tomasRecientes(personaId: string, maximo = 300): Observable<TomaRegistrada[]> {
    return this.medicamentos(personaId).pipe(
      switchMap((meds) => {
        const conId = meds.filter((m) => m.id);
        if (!conId.length) return of([] as TomaRegistrada[]);
        return combineLatest(
          conId.map((m) => {
            const q = query(
              collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${m.id}/tomas`),
              orderBy('horaProgramada', 'desc'),
              limit(maximo),
            );
            return (collectionData(q, { idField: 'id' }) as Observable<Toma[]>).pipe(
              catchError(() => of([] as Toma[])),
              map((tomas) =>
                tomas.map((toma): TomaRegistrada => ({
                  medicamento: m,
                  toma,
                  fecha: toma.horaProgramada.toDate(),
                })),
              ),
            );
          }),
        ).pipe(
          map((listas) =>
            listas
              .flat()
              .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
              .slice(0, maximo),
          ),
        );
      }),
    );
  }

  async crear(personaId: string, datos: DatosMedicamento): Promise<string> {
    const ref = await addDoc(this.ref(personaId), {
      ...this.limpiar(datos),
      activo: true,
      creadoEn: serverTimestamp(),
    });
    return ref.id;
  }

  async actualizar(personaId: string, id: string, datos: Partial<DatosMedicamento>): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), this.limpiar(datos));
  }

  async cambiarActivo(personaId: string, id: string, activo: boolean): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), { activo });
  }

  /** Borra el medicamento y sus tomas (hasta 500 por lote). */
  async eliminar(personaId: string, id: string): Promise<void> {
    const tomas = await getDocs(collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${id}/tomas`));
    const batch = writeBatch(this.db);
    tomas.docs.slice(0, 499).forEach((d) => batch.delete(d.ref));
    batch.delete(doc(this.ref(personaId), id));
    await batch.commit();
  }

  /**
   * Registra (o corrige) una toma y ajusta el inventario en el mismo batch:
   * marcar tomada resta 1; deshacerla suma 1.
   */
  async registrarToma(personaId: string, dosis: DosisProgramada, estado: EstadoToma): Promise<void> {
    const uid = this.authSvc.uid;
    const med = dosis.medicamento;
    if (!uid || !med.id) throw new Error('Datos incompletos');
    const tomaRef = doc(this.db, `personas_cuidadas/${personaId}/medicamentos/${med.id}/tomas/${dosis.idToma}`);
    const batch = writeBatch(this.db);

    if (estado === 'quitar') {
      if (dosis.toma) batch.delete(tomaRef);
    } else {
      const tomado = estado === 'tomada';
      batch.set(tomaRef, {
        horaProgramada: Timestamp.fromDate(dosis.hora),
        horaReal: tomado ? Timestamp.now() : null,
        tomado,
        registradoPor: uid,
        registradoNombre: this.authSvc.nombreActual,
      });
    }

    const antes = dosis.toma?.tomado ? 1 : 0;
    const despues = estado === 'tomada' ? 1 : 0;
    const delta = antes - despues;
    if (delta !== 0 && med.inventario !== null && med.inventario !== undefined) {
      batch.update(doc(this.ref(personaId), med.id), { inventario: increment(delta) });
    }
    await batch.commit();
  }

  private limpiar(datos: Partial<DatosMedicamento>) {
    const salida: Record<string, unknown> = {};
    if (datos.nombre !== undefined) salida['nombre'] = datos.nombre.trim();
    if (datos.dosis !== undefined) salida['dosis'] = datos.dosis.trim();
    if (datos.horarios !== undefined) salida['horarios'] = [...new Set(datos.horarios)].sort();
    if (datos.inventario !== undefined) salida['inventario'] = datos.inventario;
    if (datos.notas !== undefined) salida['notas'] = datos.notas.trim();
    return salida;
  }
}
