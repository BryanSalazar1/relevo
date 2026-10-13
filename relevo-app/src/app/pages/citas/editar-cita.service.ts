import { Injectable, inject } from '@angular/core';
import {
  ActionSheetController,
  AlertController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { EventoCalendario } from '../../core/models';
import { DatosEvento, EventosService } from '../../core/services/eventos.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { CitaModal } from './cita.modal';

/**
 * Alta, edición y borrado de citas con sus confirmaciones y avisos. Lo usan Hoy (próximas citas)
 * y Plan › Citas, para que una cita se edite igual desde donde se toque.
 */
@Injectable({ providedIn: 'root' })
export class EditarCitaService {
  private readonly eventosSvc = inject(EventosService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  /** Abre el formulario (vacío o con la cita) y guarda. Devuelve true si se guardó. */
  async editar(personaId: string, evento: EventoCalendario | null): Promise<boolean> {
    const miembros = await firstValueFrom(this.miembrosSvc.miembros(personaId));
    const modal = await this.modalCtrl.create({
      component: CitaModal,
      componentProps: { evento, miembros },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosEvento>();
    if (role !== 'guardar' || !data) return false;
    try {
      if (evento?.id) {
        await this.eventosSvc.actualizar(personaId, evento.id, data);
        await this.aviso('Cita actualizada.', 'success');
      } else {
        await this.eventosSvc.crear(personaId, data);
        await this.aviso(`${data.titulo} agendada.`, 'success');
      }
      return true;
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar la cita.', 'danger');
      return false;
    }
  }

  /** Hoja de opciones de una cita: editar o eliminar. */
  async opciones(personaId: string, evento: EventoCalendario) {
    const sheet = await this.actionSheetCtrl.create({
      header: evento.titulo,
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => {
            void this.editar(personaId, evento);
          },
        },
        {
          text: 'Eliminar',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.eliminar(personaId, evento);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async eliminar(personaId: string, evento: EventoCalendario) {
    if (!evento.id) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Eliminar ${evento.titulo}?`,
      message: 'La cita se quita del calendario de todo el equipo.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.eventosSvc.eliminar(personaId, evento.id);
      await this.aviso('Cita eliminada.', 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo eliminar la cita.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, duration: 2500, color, position: 'top' });
    await t.present();
  }
}
