import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ActionSheetController,
  AlertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { combineLatest, switchMap } from 'rxjs';
import { Medicamento, PUEDE_EDITAR_MEDICAMENTOS, PUEDE_REGISTRAR_TOMAS } from '../../core/models';
import {
  DatosMedicamento,
  DosisProgramada,
  EstadoToma,
  MedicamentosService,
} from '../../core/services/medicamentos.service';
import { claveDia, etiquetaDia, inicioDeDia, sumarDias } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { MedicamentoModal } from './medicamento.modal';

@Component({
  selector: 'app-medicamentos',
  imports: [
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonSpinner,
    IonText,
  ],
  templateUrl: './medicamentos.page.html',
  styleUrl: './medicamentos.page.scss',
})
export class MedicamentosPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  /** Día que se muestra en la agenda de tomas (por defecto hoy) */
  readonly dia = signal<Date>(inicioDeDia(new Date()));
  readonly esHoy = computed(() => claveDia(this.dia()) === claveDia(new Date()));
  readonly etiquetaDia = etiquetaDia;

  readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );
  readonly agenda = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.dia)]).pipe(
      switchMap(([id, dia]) => this.medsSvc.agendaDelDia(id, dia)),
    ),
  );
  readonly tomadas = computed(() => this.agenda()?.filter((d) => d.toma?.tomado).length ?? 0);

  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });
  readonly puedeRegistrar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_REGISTRAR_TOMAS.includes(r);
  });

  cambiarDia(delta: number) {
    this.dia.update((d) => sumarDias(d, delta));
  }

  hoy() {
    this.dia.set(inicioDeDia(new Date()));
  }

  icono(d: DosisProgramada): string {
    if (!d.toma) return d.hora.getTime() < Date.now() ? 'time-outline' : 'ellipse-outline';
    return d.toma.tomado ? 'checkmark-circle' : 'close-circle';
  }

  color(d: DosisProgramada): string {
    if (!d.toma) return d.hora.getTime() < Date.now() ? 'warning' : 'medium';
    return d.toma.tomado ? 'success' : 'danger';
  }

  async marcar(d: DosisProgramada, estado: EstadoToma) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrar()) return;
    try {
      await this.medsSvc.registrarToma(personaId, d, estado);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar la toma.', 'danger');
    }
  }

  async opcionesDosis(d: DosisProgramada) {
    if (!this.puedeRegistrar()) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${d.medicamento.nombre} · ${d.horario}`,
      buttons: [
        {
          text: 'Marcar como tomada',
          icon: 'checkmark-circle-outline',
          handler: () => {
            void this.marcar(d, 'tomada');
          },
        },
        {
          text: 'Marcar como no tomada',
          icon: 'close-circle-outline',
          handler: () => {
            void this.marcar(d, 'omitida');
          },
        },
        ...(d.toma
          ? [
              {
                text: 'Quitar registro',
                icon: 'trash-outline',
                role: 'destructive',
                handler: () => {
                  void this.marcar(d, 'quitar');
                },
              },
            ]
          : []),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  nuevo() {
    return this.editar(null);
  }

  async editar(medicamento: Medicamento | null) {
    if (!this.puedeEditar()) return;
    const modal = await this.modalCtrl.create({
      component: MedicamentoModal,
      componentProps: { medicamento },
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
        await this.aviso(`${data.nombre} registrado.`, 'success');
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
          text: m.activo === false ? 'Reactivar' : 'Suspender',
          icon: m.activo === false ? 'play-circle-outline' : 'pause-circle-outline',
          handler: () => {
            void this.medsSvc.cambiarActivo(personaId, m.id!, m.activo === false);
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
