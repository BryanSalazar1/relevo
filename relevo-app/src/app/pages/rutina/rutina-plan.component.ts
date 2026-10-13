import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActionSheetController,
  AlertController,
  IonBadge,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonSpinner,
  IonText,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { switchMap } from 'rxjs';
import { PUEDE_EDITAR_TAREAS, TIPO_TAREA_INFO, Tarea, TipoTarea } from '../../core/models';
import { DatosTarea, TareasService } from '../../core/services/tareas.service';
import { rangoHorario, textoDias } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { TareaModal } from './tarea.modal';

/**
 * Plan de la rutina: las tareas con horario que define el responsable (comidas, baño, ejercicio,
 * signos vitales…), con alta, edición, suspensión y borrado. Se marcan en Hoy.
 */
@Component({
  selector: 'app-rutina-plan',
  imports: [IonList, IonListHeader, IonItem, IonLabel, IonBadge, IonIcon, IonSpinner, IonText],
  templateUrl: './rutina-plan.component.html',
  styleUrl: './rutina-plan.component.scss',
})
export class RutinaPlan {
  private readonly tareasSvc = inject(TareasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly rol = this.ctx.rol;
  readonly textoDias = textoDias;

  readonly tareas = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.tareasSvc.tareas(id))),
  );

  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_TAREAS.includes(r);
  });

  info(tipo: TipoTarea) {
    return TIPO_TAREA_INFO[tipo] ?? TIPO_TAREA_INFO['otro'];
  }

  /** "10:00–11:00, 16:00–17:00" o "08:00, 14:00". */
  horariosTexto(t: Tarea): string {
    return t.horarios?.length
      ? t.horarios.map((h) => rangoHorario(h, t.duracionMin)).join(', ')
      : 'Sin horario';
  }

  nueva() {
    return this.editar(null);
  }

  async editar(tarea: Tarea | null) {
    if (!this.puedeEditar()) return;
    const modal = await this.modalCtrl.create({
      component: TareaModal,
      componentProps: { tarea },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosTarea>();
    if (role !== 'guardar' || !data) return;
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      if (tarea?.id) {
        await this.tareasSvc.actualizar(personaId, tarea.id, data);
        await this.aviso('Tarea actualizada.', 'success');
      } else {
        await this.tareasSvc.crear(personaId, data);
        await this.aviso(`${data.nombre} agregada a la rutina.`, 'success');
      }
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar la tarea.', 'danger');
    }
  }

  async opcionesTarea(t: Tarea) {
    if (!this.puedeEditar()) return;
    const personaId = this.ctx.personaId();
    if (!personaId || !t.id) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${t.nombre} · ${t.horarios.join(', ')}`,
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => {
            void this.editar(t);
          },
        },
        {
          text: t.activo === false ? 'Reactivar' : 'Suspender',
          icon: t.activo === false ? 'play-circle-outline' : 'pause-circle-outline',
          handler: () => {
            void this.cambiarActivo(personaId, t);
          },
        },
        {
          text: 'Eliminar',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.eliminar(t);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Suspende o reactiva una tarea (una suspendida no sale en Hoy ni avisa). */
  private async cambiarActivo(personaId: string, t: Tarea) {
    const reactivar = t.activo === false;
    try {
      await this.tareasSvc.cambiarActivo(personaId, t.id!, reactivar);
      await this.aviso(reactivar ? `${t.nombre} se reactivó.` : `${t.nombre} quedó suspendida.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso(`No se pudo ${reactivar ? 'reactivar' : 'suspender'} la tarea.`, 'danger');
    }
  }

  private async eliminar(t: Tarea) {
    const personaId = this.ctx.personaId();
    if (!personaId || !t.id) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Eliminar ${t.nombre}?`,
      message:
        'Se borrará también su historial. Si solo se deja de hacer por ahora, mejor usa "Suspender".',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.tareasSvc.eliminar(personaId, t.id);
      await this.aviso(`${t.nombre} eliminada.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo eliminar.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
