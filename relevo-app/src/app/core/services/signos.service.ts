import { Injectable, inject } from '@angular/core';
import { Firestore, Timestamp, doc, writeBatch } from '@angular/fire/firestore';
import { TIPOS_SIGNO, TipoSigno } from '../models';
import { AuthService } from './auth.service';

/** Una medición capturada; en la presión, `valor` es la sistólica y `valorSecundario` la diastólica. */
export interface Medicion {
  tipo: TipoSigno;
  valor: number;
  valorSecundario?: number | null;
}

/** "Presión 130/85 mmHg · Glucosa 110 mg/dL": las mediciones en una línea, para la nota de la tarea. */
export function resumenMediciones(mediciones: Medicion[]): string {
  return mediciones
    .map((m) => {
      const info = TIPOS_SIGNO.find((t) => t.valor === m.tipo);
      const valor = m.valorSecundario != null ? `${m.valor}/${m.valorSecundario}` : `${m.valor}`;
      return `${info?.corto ?? m.tipo} ${valor} ${info?.unidad ?? ''}`.trim();
    })
    .join(' · ');
}

/** Signos vitales: personas_cuidadas/{id}/signos_vitales (los leen el reporte y el asistente). */
@Injectable({ providedIn: 'root' })
export class SignosService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  private ref(personaId: string, id: string) {
    return doc(this.db, `personas_cuidadas/${personaId}/signos_vitales/${id}`);
  }

  /**
   * Guarda las mediciones hechas al marcar una tarea de signos vitales. El id sale de la tarea y su
   * horario (`{tareaId}-{idRegistro}-{tipo}`): si se corrige el registro, las mediciones se
   * reemplazan en vez de duplicarse, y las que ya no vienen se borran (todo en un solo batch).
   */
  async guardarDeTarea(
    personaId: string,
    tareaId: string,
    idRegistro: string,
    mediciones: Medicion[],
    fecha = new Date(),
  ): Promise<void> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    const batch = writeBatch(this.db);
    for (const info of TIPOS_SIGNO) {
      const ref = this.ref(personaId, `${tareaId}-${idRegistro}-${info.valor}`);
      const m = mediciones.find((x) => x.tipo === info.valor);
      if (!m) {
        batch.delete(ref);
        continue;
      }
      batch.set(ref, {
        tipo: m.tipo,
        valor: m.valor,
        valorSecundario: m.valorSecundario ?? null,
        unidad: info.unidad,
        fecha: Timestamp.fromDate(fecha),
        autorUid: uid,
        tareaId,
      });
    }
    await batch.commit();
  }

  /** Borra las mediciones de un registro de tarea (al quitarlo o marcarlo como no hecho). */
  async quitarDeTarea(personaId: string, tareaId: string, idRegistro: string): Promise<void> {
    return this.guardarDeTarea(personaId, tareaId, idRegistro, []);
  }
}
