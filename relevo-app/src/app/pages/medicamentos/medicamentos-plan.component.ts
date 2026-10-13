import { formatDate } from '@angular/common';
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
import { Medicamento, PUEDE_EDITAR_MEDICAMENTOS } from '../../core/models';
import {
  DatosMedicamento,
  MedicamentosService,
  estadoInventario,
  finTratamiento,
  unidadesRestantes,
} from '../../core/services/medicamentos.service';
import { inicioDeDia, sumarDias } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { MedicamentoModal } from './medicamento.modal';
import { ResurtirService } from './resurtir.service';

/**
 * Plan de medicamentos: la lista con alta, edición, resurtido, suspensión y borrado (solo el
 * responsable). Las tomas del día se registran en Hoy. Se muestra dentro de la pestaña Plan.
 */
@Component({
  selector: 'app-medicamentos-plan',
  imports: [IonList, IonListHeader, IonItem, IonLabel, IonBadge, IonIcon, IonSpinner, IonText],
  templateUrl: './medicamentos-plan.component.html',
  styleUrl: './medicamentos-plan.component.scss',
})
export class MedicamentosPlan {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly resurtirSvc = inject(ResurtirService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly rol = this.ctx.rol;

  readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );

  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });

  /** Unidades restantes que se muestran en la lista (nunca negativas). */
  readonly restantes = unidadesRestantes;

  /** Color del badge de inventario en la lista: agotado, por acabarse o normal. */
  colorInventario(m: Medicamento): string {
    const nivel = estadoInventario(m)?.nivel;
    return nivel === 'agotado' ? 'danger' : nivel === 'bajo' ? 'warning' : 'light';
  }

  /** Ya pasó el último día del tratamiento (se muestra atenuado, como los suspendidos). */
  terminado(m: Medicamento): boolean {
    const fin = finTratamiento(m);
    return !!fin && fin.getTime() <= inicioDeDia(new Date()).getTime();
  }

  /** "Del 15 sep al 21 sep · 7 días", "Desde el 15 sep · hasta indicación médica" o "Terminó el 21 sep". */
  duracionTexto(m: Medicamento): string {
    if (!m.inicio) return '';
    const f = (d: Date) => formatDate(d, 'd MMM', 'es');
    const inicio = new Date(`${m.inicio}T00:00:00`);
    const fin = finTratamiento(m);
    if (!fin) return `Desde el ${f(inicio)} · hasta indicación médica`;
    const ultimo = sumarDias(fin, -1);
    if (this.terminado(m)) return `Terminó el ${f(ultimo)}`;
    if (inicio.getTime() > Date.now()) return `Empieza el ${f(inicio)} · ${m.duracionDias} días`;
    return `Del ${f(inicio)} al ${f(ultimo)} · ${m.duracionDias} días`;
  }

  nuevo() {
    return this.editar(null);
  }

  async editar(medicamento: Medicamento | null) {
    if (!this.puedeEditar()) return;
    const modal = await this.modalCtrl.create({
      component: MedicamentoModal,
      componentProps: { medicamento, existentes: this.medicamentos() ?? [] },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosMedicamento>();
    if (role !== 'guardar' || !data) return;
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      if (medicamento?.id) {
        await this.medsSvc.actualizar(personaId, medicamento.id, data);
        await this.aviso('Medicamento actualizado.', 'success');
      } else {
        await this.medsSvc.crear(personaId, data);
        await this.aviso(`${data.nombre} agregado.`, 'success');
      }
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar el medicamento.', 'danger');
    }
  }

  async opcionesMedicamento(m: Medicamento) {
    if (!this.puedeEditar()) return;
    const personaId = this.ctx.personaId();
    if (!personaId || !m.id) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${m.nombre} · ${m.dosis}`,
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => {
            void this.editar(m);
          },
        },
        {
          text: 'Resurtir',
          icon: 'add',
          handler: () => {
            void this.resurtir(m);
          },
        },
        {
          text: m.activo === false ? 'Reactivar' : 'Suspender',
          icon: m.activo === false ? 'play-circle-outline' : 'pause-circle-outline',
          handler: () => {
            void this.cambiarActivo(personaId, m);
          },
        },
        {
          text: 'Eliminar',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.eliminar(m);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** El responsable suma al inventario las unidades que compraron. */
  async resurtir(m: Medicamento) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeEditar()) return;
    await this.resurtirSvc.resurtir(personaId, m, () => this.medicamentos()?.find((x) => x.id === m.id));
  }

  /** Suspende o reactiva un medicamento (un suspendido no admite tomas ni sale en Hoy). */
  private async cambiarActivo(personaId: string, m: Medicamento) {
    const reactivar = m.activo === false;
    try {
      await this.medsSvc.cambiarActivo(personaId, m.id!, reactivar);
      await this.aviso(
        reactivar
          ? `${m.nombre} se reactivó.`
          : `${m.nombre} quedó suspendido: no se registrarán tomas hasta reactivarlo.`,
        'success',
      );
    } catch (error) {
      console.error(error);
      await this.aviso(`No se pudo ${reactivar ? 'reactivar' : 'suspender'} el medicamento.`, 'danger');
    }
  }

  private async eliminar(m: Medicamento) {
    const personaId = this.ctx.personaId();
    if (!personaId || !m.id) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Eliminar ${m.nombre}?`,
      message: 'Se borrará también su historial de tomas. Si solo dejó de tomarlo, mejor usa "Suspender".',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.medsSvc.eliminar(personaId, m.id);
      await this.aviso(`${m.nombre} eliminado.`, 'success');
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
