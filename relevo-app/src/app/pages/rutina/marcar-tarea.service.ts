import { Injectable, inject } from '@angular/core';
import { claveDia } from '../../core/utils/fechas';
import { ActionSheetController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { SignosService, resumenMediciones } from '../../core/services/signos.service';
import {
  EstadoRegistro,
  TareaProgramada,
  TareasService,
} from '../../core/services/tareas.service';
import { NOTA_MAX, pedirNota } from '../../core/utils/notas';
import { DatosSignos, SignosModal } from './signos.modal';

/**
 * Marcar una tarea de la rutina, igual desde Hoy que desde el Semáforo: confirmación con nota
 * opcional y, si la tarea es de signos vitales y se hizo, la captura de las mediciones (que además
 * se guardan en `signos_vitales` para el reporte y el asistente). También las opciones de un
 * registro ya hecho (nota, quitar). Es el par de MarcarTomaService.
 */
@Injectable({ providedIn: 'root' })
export class MarcarTareaService {
  private readonly tareasSvc = inject(TareasService);
  private readonly signosSvc = inject(SignosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toast = inject(ToastController);

  /** Devuelve false si se canceló; lanza si no se pudo guardar. */
  async marcar(personaId: string, p: TareaProgramada, estado: EstadoRegistro): Promise<boolean> {
    const tareaId = p.tarea.id;
    if (!tareaId) throw new Error('Datos incompletos');
    const deSignos = p.tarea.tipo === 'signos';

    if (deSignos && estado === 'hecha') {
      const datos = await this.pedirSignos(p);
      if (!datos) return false;
      // Las mediciones van primero: si el registro fallara, al reintentar se reescriben las mismas
      // Las mediciones llevan la hora real si la tarea es de hoy; si se marca una de otro día, la
      // hora programada de esa tarea (si no, el reporte las pondría en el día equivocado)
      const fecha = claveDia(p.hora) === claveDia(new Date()) ? new Date() : p.hora;
      await this.signosSvc.guardarDeTarea(personaId, tareaId, p.idRegistro, datos.mediciones, fecha);
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

  /** Hoja de opciones de una tarea programada: marcar, nota y quitar el registro. */
  async opciones(personaId: string, p: TareaProgramada) {
    const sheet = await this.actionSheetCtrl.create({
      header: `${p.tarea.nombre} · ${p.horario}`,
      buttons: [
        {
          text: 'Marcar como hecha',
          icon: 'checkmark-circle-outline',
          handler: () => {
            void this.marcarConAviso(personaId, p, 'hecha');
          },
        },
        {
          text: 'Marcar como no hecha',
          icon: 'close-circle-outline',
          handler: () => {
            void this.marcarConAviso(personaId, p, 'omitida');
          },
        },
        ...(p.registro
          ? [
              {
                text: p.registro.nota ? 'Editar nota' : 'Agregar nota',
                icon: 'create-outline',
                handler: () => {
                  void this.editarNota(personaId, p);
                },
              },
              {
                text: 'Quitar registro',
                icon: 'trash-outline',
                role: 'destructive',
                handler: () => {
                  void this.marcarConAviso(personaId, p, 'quitar');
                },
              },
            ]
          : []),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Agrega o corrige la nota de un registro ya hecho (quien lo registró o el responsable). */
  async editarNota(personaId: string, p: TareaProgramada) {
    if (!p.tarea.id || !p.registro?.id) return;
    const r = await pedirNota(this.alertCtrl, {
      header: 'Nota de la tarea',
      message: `${p.tarea.nombre} · ${p.horario}`,
      confirmar: 'Guardar',
      nota: p.registro.nota,
    });
    if (!r.ok) return;
    try {
      await this.tareasSvc.actualizarNota(personaId, p.tarea.id, p.registro.id, r.nota);
    } catch (error) {
      console.error(error);
      await this.aviso(
        'No se pudo guardar la nota. Solo quien registró la tarea o el responsable pueden cambiarla.',
      );
    }
  }

  /** `marcar` que muestra el error en vez de lanzarlo (para los botones de una hoja de opciones). */
  private async marcarConAviso(personaId: string, p: TareaProgramada, estado: EstadoRegistro) {
    try {
      await this.marcar(personaId, p, estado);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar la tarea.');
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, color: 'danger', duration: 2500, position: 'top' });
    await t.present();
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
