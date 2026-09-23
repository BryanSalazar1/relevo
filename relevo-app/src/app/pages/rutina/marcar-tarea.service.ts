import { Injectable, inject } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { SignosService, resumenMediciones } from '../../core/services/signos.service';
import {
  EstadoRegistro,
  TareaProgramada,
  TareasService,
} from '../../core/services/tareas.service';
import { NOTA_MAX, pedirNota } from '../../core/utils/notas';
import { DatosSignos, SignosModal } from './signos.modal';

/**
 * Marcar una tarea de la rutina, igual desde la pestaña Rutina que desde el Semáforo: confirmación
 * con nota opcional y, si la tarea es de signos vitales y se hizo, la captura de las mediciones
 * (que además se guardan en `signos_vitales` para el reporte y el asistente).
 */
@Injectable({ providedIn: 'root' })
export class MarcarTareaService {
  private readonly tareasSvc = inject(TareasService);
  private readonly signosSvc = inject(SignosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);

  /** Devuelve false si se canceló; lanza si no se pudo guardar. */
  async marcar(personaId: string, p: TareaProgramada, estado: EstadoRegistro): Promise<boolean> {
    const tareaId = p.tarea.id;
    if (!tareaId) throw new Error('Datos incompletos');
    const deSignos = p.tarea.tipo === 'signos';

    if (deSignos && estado === 'hecha') {
      const datos = await this.pedirSignos(p);
      if (!datos) return false;
      // Las mediciones van primero: si el registro fallara, al reintentar se reescriben las mismas
      await this.signosSvc.guardarDeTarea(personaId, tareaId, p.idRegistro, datos.mediciones);
      const nota = [resumenMediciones(datos.mediciones), datos.nota].filter(Boolean).join(' — ');
      await this.tareasSvc.registrar(personaId, p, 'hecha', nota.slice(0, NOTA_MAX) || undefined);
      return true;
    }

    let nota: string | undefined;
    if (estado !== 'quitar') {
      const r = await pedirNota(this.alertCtrl, {
        header: `¿Marcar como ${estado === 'hecha' ? 'hecha' : 'no hecha'}?`,
        message: `${p.tarea.nombre} · ${p.horario}`,
        confirmar: 'Marcar',
      });
      if (!r.ok) return false;
      nota = r.nota;
    }
    await this.tareasSvc.registrar(personaId, p, estado, nota);
    // Ya no está hecha: sus mediciones (si las hubo) dejan de contar
    if (deSignos && p.registro?.hecha) {
      await this.signosSvc.quitarDeTarea(personaId, tareaId, p.idRegistro).catch(() => undefined);
    }
    return true;
  }

  private async pedirSignos(p: TareaProgramada): Promise<DatosSignos | null> {
    const modal = await this.modalCtrl.create({
      component: SignosModal,
      componentProps: { titulo: `${p.tarea.nombre} · ${p.horario}`, tipos: p.tarea.signos ?? [] },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosSignos>();
    return role === 'guardar' && data ? data : null;
  }
}
