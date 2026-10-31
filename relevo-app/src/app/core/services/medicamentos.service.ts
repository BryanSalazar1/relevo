import { formatDate } from '@angular/common';
import { Injectable, inject } from '@angular/core';
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
  increment,
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
import { Medicamento, MotivoToma, Toma } from '../models';
import { claveDia, inicioDeDia, sumarDias } from '../utils/fechas';
import { NOTA_MAX } from '../utils/notas';
import { LIMITES_SEGUN_NECESIDAD } from '../utils/segun-necesidad';
import { AuthService } from './auth.service';

export interface DatosMedicamento {
  nombre: string;
  dosis: string;
  horarios: string[];
  /** true = sin horario fijo; se registra cada toma en el momento */
  segunNecesidad?: boolean;
  /** Primer día del tratamiento (yyyy-mm-dd) */
  inicio?: string;
  /** Días que dura; null = hasta que el médico lo indique */
  duracionDias?: number | null;
  inventario: number | null;
  notas?: string;
  /** Al editar: cambió el nombre, la dosis, los horarios o "según necesidad" (no solo notas o inventario) */
  cambioTratamiento?: boolean;
  /** Según necesidad: indicación del médico (core/utils/segun-necesidad.ts) */
  condicion?: string;
  maxAlDia?: number | null;
  horasEntreTomas?: number | null;
}

/** Motivo e intensidad de una toma según necesidad (opcionales). */
export interface DetalleToma {
  motivo?: MotivoToma;
  intensidad?: number;
}

/** Una dosis programada de un día concreto, con su registro (si existe). */
export interface DosisProgramada {
  medicamento: Medicamento;
  horario: string;
  hora: Date;
  idToma: string;
  toma?: Toma;
  /** Toma según necesidad: no venía de un horario, se registró en el momento */
  aDemanda?: boolean;
}

export type EstadoToma = 'tomada' | 'omitida' | 'quitar';

/** Toma registrada junto con su medicamento, para mostrarla fuera de la agenda (p. ej. en la bitácora). */
export interface TomaRegistrada {
  medicamento: Medicamento;
  toma: Toma;
  /** Cuándo se registró la toma (ordena la bitácora); en tomas antiguas, la hora real o la programada. */
  fecha: Date;
}

/** Límites de un medicamento (los mismos que validan el formulario y firestore.rules). */
export const LIMITES_MEDICAMENTO = {
  nombre: 60,
  dosis: 40,
  notas: 300,
  horarios: 12,
  duracionDias: 365,
  inventario: 9999,
};

/** Horario válido "HH:mm" (00:00–23:59). */
export const HORARIO_VALIDO = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * La toma no se puede registrar por el estado del medicamento (suspendido, o un tratamiento que no
 * aplica ese día porque aún no empieza o ya terminó). El mensaje se le muestra tal cual a quien registra.
 */
export class TomaNoPermitida extends Error {}

/** Lanza TomaNoPermitida si el medicamento no admite una toma en `dia`. */
export function comprobarTomaPermitida(m: Medicamento, dia: Date): void {
  if (m.activo === false) {
    throw new TomaNoPermitida('Este medicamento está suspendido: reactívalo para registrar tomas.');
  }
  if (!vigenteEnDia(m, dia)) {
    const fin = finTratamiento(m);
    const terminado = !!fin && claveDia(dia) >= claveDia(fin);
    throw new TomaNoPermitida(
      terminado
        ? 'Este tratamiento ya terminó: no se registran más tomas. Si el médico lo extendió, edita el medicamento.'
        : 'Este tratamiento todavía no empieza: no se registran tomas antes de la fecha de inicio.',
    );
  }
}

/** Unidades restantes para mostrar: nunca negativas (datos antiguos pudieron quedar en -1); null si no se controla. */
export function unidadesRestantes(m: Pick<Medicamento, 'inventario'>): number | null {
  return m.inventario === null || m.inventario === undefined ? null : Math.max(0, m.inventario);
}

/** Se controla el inventario y ya no queda ninguna unidad. */
export function agotado(m: Pick<Medicamento, 'inventario'>): boolean {
  return unidadesRestantes(m) === 0;
}

/** Id determinista de la toma: la misma hora programada siempre apunta al mismo documento. */
export function idToma(hora: Date): string {
  return formatDate(hora, 'yyyyMMdd-HHmm', 'es');
}

/** Día siguiente al último del tratamiento (exclusivo), o null si no tiene fin definido. */
export function finTratamiento(m: Pick<Medicamento, 'inicio' | 'duracionDias'>): Date | null {
  if (!m.inicio || !m.duracionDias || m.duracionDias <= 0) return null;
  return sumarDias(new Date(`${m.inicio}T00:00:00`), m.duracionDias);
}

/** ¿El medicamento se toma ese día? (aún no empieza o ya terminó → no) */
export function vigenteEnDia(m: Pick<Medicamento, 'inicio' | 'duracionDias'>, dia: Date): boolean {
  const clave = claveDia(dia);
  if (m.inicio && clave < m.inicio) return false;
  const fin = finTratamiento(m);
  return !fin || clave < claveDia(fin);
}

/** Se avisa cuando el inventario alcanza para estos días o menos. */
export const DIAS_AVISO_INVENTARIO = 5;
/** Mínimo absoluto de unidades para avisar, y umbral de los medicamentos según necesidad. */
export const UNIDADES_AVISO_INVENTARIO = 5;

/** Cómo va el inventario de un medicamento que lo controla. */
export interface EstadoInventario {
  nivel: 'ok' | 'bajo' | 'agotado';
  /** Unidades restantes (nunca negativas) */
  unidades: number;
  /** Tomas con horario al día; 0 si es según necesidad */
  alDia: number;
  /** Días completos para los que alcanza; null si no tiene tomas con horario */
  dias: number | null;
}

/**
 * Estado del inventario hoy, o null si no aplica: no se controla, está suspendido o el tratamiento
 * ya terminó. Si lo que queda alcanza para terminar el tratamiento no se avisa, aunque sean pocas.
 * Misma regla que functions/logica.js (estadoInventario): si cambias una, cambia la otra.
 */
export function estadoInventario(
  m: Pick<Medicamento, 'inventario' | 'activo' | 'segunNecesidad' | 'horarios' | 'inicio' | 'duracionDias'>,
  hoy: Date = new Date(),
): EstadoInventario | null {
  if (typeof m.inventario !== 'number' || !Number.isFinite(m.inventario)) return null;
  if (m.activo === false) return null;
  const hoyIso = claveDia(hoy);
  const fin = finTratamiento(m);
  if (fin && hoyIso >= claveDia(fin)) return null;

  const unidades = Math.max(0, m.inventario);
  const alDia = m.segunNecesidad ? 0 : (m.horarios ?? []).length;
  const dias = alDia > 0 ? Math.floor(unidades / alDia) : null;

  // Tratamiento con fin: si lo que hay alcanza para los días que faltan, no hace falta resurtir.
  // Hoy no se cuenta: parte de sus dosis ya se descontó y aquí no se sabe cuáles (contarlo completo
  // daba avisos falsos con un surtido exacto, p. ej. 21 pastillas para 7 días de 3 al día).
  if (fin && m.inicio && alDia > 0) {
    const desde = hoyIso >= m.inicio ? sumarDias(inicioDeDia(hoy), 1) : new Date(`${m.inicio}T00:00:00`);
    const diasRestantes = Math.max(0, Math.round((fin.getTime() - desde.getTime()) / 86_400_000));
    if (unidades >= diasRestantes * alDia) return { nivel: 'ok', unidades, alDia, dias };
  }

  const umbral = Math.max(UNIDADES_AVISO_INVENTARIO, alDia * DIAS_AVISO_INVENTARIO);
  const nivel = unidades === 0 ? 'agotado' : unidades <= umbral ? 'bajo' : 'ok';
  return { nivel, unidades, alDia, dias };
}

/** "Quedan 5: alcanza para 5 días", "Quedan 5 (según necesidad)" o "Agotado: ya no quedan unidades". */
export function textoInventario(e: EstadoInventario): string {
  if (e.unidades === 0) return 'Agotado: ya no quedan unidades';
  const quedan = e.unidades === 1 ? 'Queda 1' : `Quedan ${e.unidades}`;
  if (e.dias === null) return `${quedan} (según necesidad)`;
  if (e.dias === 0) return `${quedan}: no alcanza para un día completo`;
  return `${quedan}: alcanza para ${e.dias === 1 ? '1 día' : `${e.dias} días`}`;
}

/** Id de una toma según necesidad: con segundos, para que dos tomas seguidas no choquen. */
export function idTomaAhora(hora: Date): string {
  return formatDate(hora, 'yyyyMMdd-HHmmss', 'es');
}

/** Fecha concreta de un horario "HH:mm" en un día dado. */
export function fechaDe(dia: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = inicioDeDia(dia);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** ¿El medicamento entra en la agenda de ese día? (activo y dentro de su tratamiento) */
export function medicamentoDelDia(m: Medicamento, dia: Date): boolean {
  return m.activo !== false && !!m.id && vigenteEnDia(m, dia);
}

/**
 * Agenda del día de los medicamentos: cada horario cruzado con su toma registrada; los según
 * necesidad, una fila por cada toma dada ese día, a la hora en que se dio. Pura: la usan el servicio
 * (en tiempo real) y el semáforo compartido por enlace (con lo que devuelve la función).
 */
export function dosisDelDia(pares: { m: Medicamento; tomas: Toma[] }[], dia: Date): DosisProgramada[] {
  return pares
    .flatMap(({ m, tomas }): DosisProgramada[] => {
      if (m.segunNecesidad) {
        return tomas.map((t) => {
          const hora = t.horaProgramada.toDate();
          return {
            medicamento: m,
            horario: formatDate(hora, 'HH:mm', 'es'),
            hora,
            idToma: t.id ?? idTomaAhora(hora),
            toma: t,
            aDemanda: true,
          };
        });
      }
      return (m.horarios ?? []).map((horario) => {
        const hora = fechaDe(dia, horario);
        const id = idToma(hora);
        return { medicamento: m, horario, hora, idToma: id, toma: tomas.find((t) => t.id === id) };
      });
    })
    .sort((a, b) => a.hora.getTime() - b.hora.getTime());
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
        const activos = meds.filter((m) => medicamentoDelDia(m, dia));
        if (!activos.length) return of([] as DosisProgramada[]);
        return combineLatest(
          activos.map((m) =>
            this.tomasDelDia(personaId, m.id!, dia).pipe(map((tomas) => ({ m, tomas }))),
          ),
        ).pipe(map((pares) => dosisDelDia(pares, dia)));
      }),
    );
  }

  /** Dosis "ahora mismo" de un medicamento según necesidad, lista para registrarToma(). */
  dosisAhora(medicamento: Medicamento): DosisProgramada {
    const hora = new Date();
    return {
      medicamento,
      horario: formatDate(hora, 'HH:mm', 'es'),
      hora,
      idToma: idTomaAhora(hora),
      aDemanda: true,
    };
  }

  /**
   * Tomas de un medicamento desde `desde` (para revisar una toma nueva contra la indicación del
   * médico: las de hoy y las de las últimas horas indicadas).
   */
  async tomasDesde(personaId: string, medicamentoId: string, desde: Date): Promise<Toma[]> {
    const snap = await getDocs(
      query(
        collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${medicamentoId}/tomas`),
        where('horaProgramada', '>=', Timestamp.fromDate(desde)),
        orderBy('horaProgramada', 'asc'),
      ),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Toma) }));
  }

  /** Tomas de hoy de cada medicamento según necesidad (id → tomas), en tiempo real: "hoy van 2 de 3". */
  tomasHoySegunNecesidad(personaId: string, hoy: Date): Observable<Record<string, Toma[]>> {
    return this.medicamentos(personaId).pipe(
      switchMap((meds) => {
        const prn = meds.filter((m) => m.segunNecesidad && m.activo !== false && m.id);
        if (!prn.length) return of({} as Record<string, Toma[]>);
        const desde = Timestamp.fromDate(inicioDeDia(hoy));
        return combineLatest(
          prn.map((m) => {
            const q = query(
              collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${m.id}/tomas`),
              where('horaProgramada', '>=', desde),
            );
            return (collectionData(q, { idField: 'id' }) as Observable<Toma[]>).pipe(
              catchError(() => of([] as Toma[])),
              map((tomas) => [m.id!, tomas] as const),
            );
          }),
        ).pipe(map((pares) => Object.fromEntries(pares)));
      }),
    );
  }

  /** Última toma registrada de cada medicamento según necesidad (id → toma), en tiempo real. */
  ultimasTomasSegunNecesidad(personaId: string): Observable<Record<string, Toma | undefined>> {
    return this.medicamentos(personaId).pipe(
      switchMap((meds) => {
        const prn = meds.filter(
          (m) => m.segunNecesidad && m.activo !== false && m.id && vigenteEnDia(m, new Date()),
        );
        if (!prn.length) return of({} as Record<string, Toma | undefined>);
        return combineLatest(
          prn.map((m) => {
            const q = query(
              collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${m.id}/tomas`),
              orderBy('horaProgramada', 'desc'),
              limit(1),
            );
            return (collectionData(q, { idField: 'id' }) as Observable<Toma[]>).pipe(
              catchError(() => of([] as Toma[])),
              map((tomas) => [m.id!, tomas[0]] as const),
            );
          }),
        ).pipe(map((pares) => Object.fromEntries(pares)));
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
                  fecha: (toma.registradoEn ?? toma.horaReal ?? toma.horaProgramada).toDate(),
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

  /**
   * Guarda los cambios del formulario; si trae el inventario, deja la marca `editadoEn`. Con ella las Cloud Functions
   * distinguen una corrección del inventario hecha a mano (rearma el aviso de inventario bajo)
   * de deshacer una toma, que también suma 1 pero no debe repetir el aviso.
   */
  async actualizar(personaId: string, id: string, datos: Partial<DatosMedicamento>): Promise<void> {
    // La marca solo va cuando el formulario trae inventario: editar las notas no rearma el aviso
    await updateDoc(doc(this.ref(personaId), id), {
      ...this.limpiar(datos),
      ...(datos.inventario !== undefined ? { editadoEn: serverTimestamp() } : {}),
      ...(datos.cambioTratamiento ? { tratamientoCambiadoEn: serverTimestamp() } : {}),
    });
  }

  async cambiarActivo(personaId: string, id: string, activo: boolean): Promise<void> {
    await updateDoc(doc(this.ref(personaId), id), { activo });
  }

  /**
   * Suma al inventario las unidades que se compraron y las recuerda como propuesta del próximo resurtido.
   * Si el medicamento no llevaba inventario (o quedó en negativo), empieza a contarse desde esas unidades.
   */
  async resurtir(personaId: string, med: Medicamento, unidades: number): Promise<void> {
    if (!med.id) throw new Error('Datos incompletos');
    const maximo = LIMITES_MEDICAMENTO.inventario;
    if (!Number.isInteger(unidades) || unidades < 1 || unidades > maximo) {
      throw new Error(`Las unidades deben ser un número entero entre 1 y ${maximo}.`);
    }
    const sinControl = med.inventario === null || med.inventario === undefined || med.inventario < 0;
    if ((sinControl ? 0 : med.inventario!) + unidades > maximo) {
      throw new Error(`El inventario no puede pasar de ${maximo} unidades.`);
    }
    await updateDoc(doc(this.ref(personaId), med.id), {
      inventario: sinControl ? unidades : increment(unidades),
      ultimoResurtido: unidades,
    });
  }

  /** Borra el medicamento y sus tomas (hasta 500 por lote). */
  /** Borra el historial completo (por tandas: un batch admite 500 escrituras) y luego el documento. */
  async eliminar(personaId: string, id: string): Promise<void> {
    const tomas = await getDocs(collection(this.db, `personas_cuidadas/${personaId}/medicamentos/${id}/tomas`));
    for (let i = 0; i < tomas.docs.length; i += 450) {
      const tanda = writeBatch(this.db);
      tomas.docs.slice(i, i + 450).forEach((d) => tanda.delete(d.ref));
      await tanda.commit();
    }
    await deleteDoc(doc(this.ref(personaId), id));
  }


  /**
   * Registra (o corrige) una toma y ajusta el inventario en el mismo batch:
   * marcar tomada resta 1; deshacerla suma 1. El inventario nunca baja de 0: si ya no quedan
   * unidades la toma se registra igual (la persona sí se la tomó), marcada con `sinDescuento`
   * para que deshacerla no devuelva una unidad que nunca se restó.
   */
  async registrarToma(
    personaId: string,
    dosis: DosisProgramada,
    estado: EstadoToma,
    nota?: string,
    detalle: DetalleToma = {},
  ): Promise<void> {
    const uid = this.authSvc.uid;
    const med = dosis.medicamento;
    if (!uid || !med.id) throw new Error('Datos incompletos');
    // Un medicamento suspendido o un tratamiento terminado no admiten tomas nuevas (quitar un registro sí)
    if (estado !== 'quitar') comprobarTomaPermitida(med, dosis.hora);
    const tomaRef = doc(this.db, `personas_cuidadas/${personaId}/medicamentos/${med.id}/tomas/${dosis.idToma}`);
    const batch = writeBatch(this.db);

    const inventario = med.inventario ?? null;
    const yaTomada = dosis.toma?.tomado === true;
    const habiaDescontado = yaTomada && !dosis.toma?.sinDescuento;
    // ¿Esta toma queda descontada del inventario? Volver a marcar una ya tomada no cambia nada.
    const descuenta =
      estado === 'tomada' && (yaTomada ? habiaDescontado : inventario !== null && inventario > 0);

    const tomado = estado === 'tomada';
    const datosToma = (sinDescuento: boolean) => ({
      horaProgramada: Timestamp.fromDate(dosis.hora),
      horaReal: tomado ? Timestamp.now() : null,
      tomado,
      registradoPor: uid,
      registradoNombre: this.authSvc.nombreActual,
      registradoEn: serverTimestamp(),
      ...(dosis.aDemanda ? { aDemanda: true } : {}),
      ...(tomado && sinDescuento ? { sinDescuento: true } : {}),
      ...(nota?.trim() ? { nota: nota.trim().slice(0, NOTA_MAX) } : {}),
      ...(tomado && detalle.motivo ? { motivo: detalle.motivo } : {}),
      ...(tomado && detalle.motivo === 'dolor' && Number.isInteger(detalle.intensidad)
        ? { intensidad: Math.min(10, Math.max(0, detalle.intensidad!)) }
        : {}),
    });
    if (estado === 'quitar') {
      if (dosis.toma) batch.delete(tomaRef);
    } else {
      batch.set(tomaRef, datosToma(!descuenta));
    }

    const delta = (habiaDescontado ? 1 : 0) - (descuenta ? 1 : 0);
    const tocaInventario = inventario !== null && (inventario < 0 || delta !== 0);
    if (tocaInventario) {
      const medRef = doc(this.ref(personaId), med.id);
      // Datos antiguos pudieron quedar en negativo: se reparan a 0 en la primera toma
      if (inventario < 0) batch.update(medRef, { inventario: 0 });
      else batch.update(medRef, { inventario: increment(delta) });
    }
    try {
      await batch.commit();
    } catch (error) {
      // Las rules rechazan el batch completo si el inventario quedaría bajo 0 (otro teléfono registró
      // la última unidad al mismo tiempo). La toma no se pierde: se guarda sola, sin descontar.
      if (!tocaInventario || (error as { code?: string })?.code !== 'permission-denied') throw error;
      if (estado === 'quitar') await deleteDoc(tomaRef);
      else await setDoc(tomaRef, datosToma(true));
    }
  }

  /** Cambia (o borra, si viene vacía) la nota de una toma ya registrada. */
  async actualizarNotaToma(personaId: string, medicamentoId: string, tomaId: string, nota?: string): Promise<void> {
    await updateDoc(doc(this.db, `personas_cuidadas/${personaId}/medicamentos/${medicamentoId}/tomas/${tomaId}`), {
      nota: nota?.trim() ? nota.trim().slice(0, NOTA_MAX) : deleteField(),
    });
  }

  /** Normaliza lo que se guarda: recorta textos, descarta horarios inválidos y acota los números. */
  private limpiar(datos: Partial<DatosMedicamento>) {
    const L = LIMITES_MEDICAMENTO;
    const entero = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));
    const salida: Record<string, unknown> = {};
    if (datos.nombre !== undefined) salida['nombre'] = datos.nombre.trim().slice(0, L.nombre);
    if (datos.dosis !== undefined) salida['dosis'] = datos.dosis.trim().slice(0, L.dosis);
    if (datos.horarios !== undefined) {
      salida['horarios'] = [...new Set(datos.horarios.filter((h) => HORARIO_VALIDO.test(h)))]
        .sort()
        .slice(0, L.horarios);
    }
    if (datos.segunNecesidad !== undefined) salida['segunNecesidad'] = datos.segunNecesidad;
    if (datos.inicio !== undefined) salida['inicio'] = datos.inicio;
    if (datos.duracionDias !== undefined) {
      const d = datos.duracionDias;
      salida['duracionDias'] = d === null || !Number.isFinite(d) ? null : entero(d, 1, L.duracionDias);
    }
    if (datos.inventario !== undefined) {
      const i = datos.inventario;
      salida['inventario'] = i === null || !Number.isFinite(i) ? null : entero(i, 0, L.inventario);
    }
    if (datos.notas !== undefined) salida['notas'] = datos.notas.trim().slice(0, L.notas);
    // Indicación del médico para "según necesidad" (vacía o null = sin ese límite)
    const LP = LIMITES_SEGUN_NECESIDAD;
    if (datos.condicion !== undefined) salida['condicion'] = datos.condicion.trim().slice(0, LP.condicion);
    if (datos.maxAlDia !== undefined) {
      const n = datos.maxAlDia;
      salida['maxAlDia'] = n === null || !Number.isFinite(n) ? null : entero(n, LP.maxAlDia.min, LP.maxAlDia.max);
    }
    if (datos.horasEntreTomas !== undefined) {
      const n = datos.horasEntreTomas;
      salida['horasEntreTomas'] =
        n === null || !Number.isFinite(n) ? null : entero(n, LP.horasEntreTomas.min, LP.horasEntreTomas.max);
    }
    return salida;
  }
}
