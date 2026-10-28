import { Injectable, inject } from '@angular/core';
import { Firestore, doc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { PREGUNTAS_MEDICO_MAX } from '../models';
import { AuthService } from './auth.service';

/**
 * Preguntas de la familia para el médico (personas_cuidadas/{id}/consulta/preguntas): un solo
 * texto compartido que se escribe durante el periodo y encabeza la hoja para la consulta.
 */
@Injectable({ providedIn: 'root' })
export class ConsultaService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  private ref(personaId: string) {
    return doc(this.db, `personas_cuidadas/${personaId}/consulta/preguntas`);
  }

  async guardarPreguntas(personaId: string, texto: string): Promise<void> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    await setDoc(this.ref(personaId), {
      texto: texto.trim().slice(0, PREGUNTAS_MEDICO_MAX),
      actualizadoPor: uid,
      actualizadoNombre: this.authSvc.nombreActual,
      actualizadoEn: serverTimestamp(),
    });
  }
}
