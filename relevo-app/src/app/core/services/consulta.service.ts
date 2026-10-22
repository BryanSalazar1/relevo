import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Observable, catchError, map, of } from 'rxjs';
import { PREGUNTAS_MEDICO_MAX, PreguntasMedico } from '../models';
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

  preguntas(personaId: string): Observable<PreguntasMedico | null> {
    return (docData(this.ref(personaId)) as Observable<PreguntasMedico | undefined>).pipe(
      map((d) => d ?? null),
      catchError(() => of(null)),
    );
  }

  /** El texto actual (vacío si no hay documento o no se puede leer). */
  async leerPreguntas(personaId: string): Promise<string> {
    try {
      const snap = await getDoc(this.ref(personaId));
      return snap.exists() ? ((snap.data() as PreguntasMedico).texto ?? '') : '';
    } catch {
      return '';
    }
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
