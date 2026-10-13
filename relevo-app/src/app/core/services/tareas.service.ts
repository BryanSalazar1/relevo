import { Injectable, inject } from '@angular/core';
import { NOTA_MAX } from '../utils/notas';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { RegistroTarea, Tarea, TipoSigno, TipoTarea } from '../models';
import { inicioDeDia, sumarDias, tareaEnDia } from '../utils/fechas';
import { AuthService } from './auth.service';
import { fechaDe, idToma } from './medicamentos.service';

export interface DatosTarea {
  tipo: TipoTarea;
  nombre: string;
  horarios: string[];
  avisarMin: number;
  /** Días de la semana (Date.getDay()); vacío = todos */
  dias?: number[];
  /** Duración de cada horario en minutos; 0 = solo hora de inicio */
  duracionMin?: number;
  /** Solo tipo 'signos': qué se mide; vacío = todos */
  signos?: TipoSigno[];
  notas?: string;
}

/** Una tarea en un horario de un día concreto, con su registro (si existe). */
export interface TareaProgramada {
  tarea: Tarea;
  horario: string;
  hora: Date;
  idRegistro: string;
  registro?: RegistroTarea;
}

export type EstadoRegistro = 'hecha' | 'omitida' | 'quitar';

/** Registro de tarea junto con su tarea, para la bitácora. */
export interface RegistroReciente {
  tarea: Tarea;
  registro: RegistroTarea;
  /** Cuándo se registró (ordena la bitácora); en registros antiguos, la hora real o la programada. */
  fecha: Date;
}

/**
 * Rutina diaria de la persona cuidada: tareas con horario (comidas, baño, ejercicio…).
 * Mismo esquema que los medicamentos: el id del registro es yyyyMMdd-HHmm de la hora programada,
 * así corregir un registro no crea duplicados. Las Cloud Functions avisan antes de cada horario.
 */
@Injectable({ providedIn: 'root' })
export class TareasService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  private ref(personaId: string) {
    return collection(this.db, `personas_cuidadas/${personaId}/tareas`);
  }

  private registrosRef(personaId: string, tareaId: string) {
    return collection(this.db, `personas_cuidadas/${personaId}/tareas/${tareaId}/registros`);
  }

  /** Tareas de la persona: activas primero, luego por su primer horario y nombre. */
  tareas(personaId: string): Observable<Tarea[]> {
    return (collectionData(this.ref(personaId), { idField: 'id' }) as Observable<Tarea[]>).pipe(
      map((lista) =>
        [...lista].sort(
          (a, b) =>
            Number(b.activo !== false) - Number(a.activo !== false) ||
            (a.horarios?.[0] ?? '').localeCompare(b.horarios?.[0] ?? '') ||
            a.nombre.localeCompare(b.nombre),
        ),
      ),
      catchError(() => of([] as Tarea[])),
    );
  }

  /** Registros de una tarea en un día. */
  registrosDelDia(personaId: string, tareaId: string, dia: Date): Observable<RegistroTarea[]> {
    const inicio = inicioDeDia(dia);
    const q = query(
      this.registrosRef(personaId, tareaId),
      where('horaProgramada', '>=', Timestamp.fromDate(inicio)),
      where('horaProgramada', '<', Timestamp.fromDate(sumarDias(inicio, 1))),
    );
    return (collectionData(q, { idField: 'id' }) as Observable<RegistroTarea[]>).pipe(
      catchError(() => of([] as RegistroTarea[])),
    );
  }

  /** Agenda del día: cada horario de cada tarea activa, cruzado con su registro. */
  agendaDelDia(personaId: string, dia: Date): Observable<TareaProgramada[]> {
    return this.tareas(personaId).pipe(
      switchMap((tareas) => {
        const activas = tareas.filter((t) => t.activo !== false && t.id && tareaEnDia(t.dias, dia));
        if (!activas.length) return of([] as TareaProgramada[]);
        return combineLatest(
          activas.map((t) =>
            this.registrosDelDia(personaId, t.id!, dia).pipe(
              map((registros) => ({ t, registros })),
            ),
          ),
        ).pipe(
          map((pares) =>
            pares
              .flatMap(({ t, registros }) =>
                (t.horarios ?? []).map((horario) => {
                  const hora = fechaDe(dia, horario);
                  const id = idToma(hora);
                  return {
                    tarea: t,
                    horario,
                    hora,
                    idRegistro: id,
                    registro: registros.find((r) => r.id === id),
                  };
                }),
              )
              .sort((a, b) => a.hora.getTime() - b.hora.getTime()),
          ),
        );
      }),
    );
  }

  async crear(personaId: string, datos: DatosTarea): Promise<string> {
    const ref = await addDoc(this.ref(personaId), {
      ...this.limpiar(datos),
      activo: true,
      creadoEn: serverTimestamp(),
    });
    return ref.id;
  }

  async actualizar(personaId: string, id: string, datos: Partial<DatosTarea>): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), this.limpiar(datos));
  }

  async cambiarActivo(personaId: string, id: string, activo: boolean): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), { activo });
  }

  /** Borra la tarea y sus registros (hasta 500 por lote). */
  async eliminar(personaId: string, id: string): Promise<void> {
    const registros = await getDocs(this.registrosRef(personaId, id));
    const batch = writeBatch(this.db);
    registros.docs.slice(0, 499).forEach((d) => batch.delete(d.ref));
    batch.delete(doc(this.ref(personaId), id));
    await batch.commit();
  }

  /** Los `maximo` registros más recientes de todas las tareas (hechas o no), para la bitácora. */
  registrosRecientes(personaId: string, maximo = 300): Observable<RegistroReciente[]> {
    return this.tareas(personaId).pipe(
      switchMap((tareas) => {
        const conId = tareas.filter((t) => t.id);
        if (!conId.length) return of([] as RegistroReciente[]);
        return combineLatest(
          conId.map((t) => {
            const q = query(
              this.registrosRef(personaId, t.id!),
              orderBy('horaProgramada', 'desc'),
              limit(maximo),
            );
            return (collectionData(q, { idField: 'id' }) as Observable<RegistroTarea[]>).pipe(
              catchError(() => of([] as RegistroTarea[])),
              map((registros) =>
                registros.map((registro): RegistroReciente => ({
                  tarea: t,
                  registro,
                  fecha: (
                    registro.registradoEn ??
                    registro.horaReal ??
                    registro.horaProgramada
                  ).toDate(),
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

  /** Cambia (o borra, si viene vacía) la nota de un registro ya hecho. */
  async actualizarNota(
    personaId: string,
    tareaId: string,
    registroId: string,
    nota?: string,
  ): Promise<void> {
    await updateDoc(doc(this.registrosRef(personaId, tareaId), registroId), {
      nota: nota?.trim() ? nota.trim().slice(0, NOTA_MAX) : deleteField(),
    });
  }

  /** Marca una tarea programada como hecha / no hecha (con nota opcional), o quita el registro. */
  async registrar(
    personaId: string,
    programada: TareaProgramada,
    estado: EstadoRegistro,
    nota?: string,
  ): Promise<void> {
    const uid = this.authSvc.uid;
    const tarea = programada.tarea;
    if (!uid || !tarea.id) throw new Error('Datos incompletos');
    const ref = doc(this.registrosRef(personaId, tarea.id), programada.idRegistro);
    if (estado === 'quitar') {
      if (programada.registro) await deleteDoc(ref);
      return;
    }
    const hecha = estado === 'hecha';
    await setDoc(ref, {
      horaProgramada: Timestamp.fromDate(programada.hora),
      horaReal: hecha ? Timestamp.now() : null,
      hecha,
      registradoPor: uid,
      registradoNombre: this.authSvc.nombreActual,
      registradoEn: serverTimestamp(),
      ...(nota?.trim() ? { nota: nota.trim().slice(0, NOTA_MAX) } : {}),
    });
  }

  private limpiar(datos: Partial<DatosTarea>) {
    const salida: Record<string, unknown> = {};
    if (datos.tipo !== undefined) salida['tipo'] = datos.tipo;
    if (datos.nombre !== undefined) salida['nombre'] = datos.nombre.trim();
    if (datos.horarios !== undefined) salida['horarios'] = [...new Set(datos.horarios)].sort();
    if (datos.avisarMin !== undefined)
      salida['avisarMin'] = Math.max(0, Math.round(datos.avisarMin));
    if (datos.dias !== undefined) salida['dias'] = [...new Set(datos.dias)].sort((a, b) => a - b);
    if (datos.duracionMin !== undefined)
      salida['duracionMin'] = Math.max(0, Math.round(datos.duracionMin));
    if (datos.signos !== undefined) salida['signos'] = [...new Set(datos.signos)];
    if (datos.notas !== undefined) salida['notas'] = datos.notas.trim();
    return salida;
  }
}
