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
import {
  PUEDE_EDITAR_TAREAS,
  PUEDE_REGISTRAR_TAREAS,
  TIPO_TAREA_INFO,
  Tarea,
  TipoTarea,
} from '../../core/models';
import {
  DatosTarea,
  EstadoRegistro,
  TareaProgramada,
  TareasService,
} from '../../core/services/tareas.service';
import {
  claveDia,
  etiquetaDia,
  inicioDeDia,
  rangoHorario,
  sumarDias,
  textoDias,
} from '../../core/utils/fechas';
import { pedirNota } from '../../core/utils/notas';
import { personaActual } from '../../core/utils/persona-actual';
import { TareaModal } from './tarea.modal';

/** Rutina diaria: tareas con horario que define el responsable y marcan quienes cuidan. */
@Component({
  selector: 'app-rutina',
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
  templateUrl: './rutina.page.html',
  styleUrl: './rutina.page.scss',
})
export class RutinaPage {
  private readonly tareasSvc = inject(TareasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  /** Día que se muestra en la agenda (por defecto hoy) */
  readonly dia = signal<Date>(inicioDeDia(new Date()));
  readonly esHoy = computed(() => claveDia(this.dia()) === claveDia(new Date()));
  readonly etiquetaDia = etiquetaDia;
  readonly textoDias = textoDias;
  readonly rangoHorario = rangoHorario;

  readonly tareas = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.tareasSvc.tareas(id))),
  );
  readonly agenda = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.dia)]).pipe(
      switchMap(([id, dia]) => this.tareasSvc.agendaDelDia(id, dia)),
    ),
  );
  readonly hechas = computed(() => this.agenda()?.filter((p) => p.registro?.hecha).length ?? 0);

  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_TAREAS.includes(r);
  });
  readonly puedeRegistrar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_REGISTRAR_TAREAS.includes(r);
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

  cambiarDia(delta: number) {
    this.dia.update((d) => sumarDias(d, delta));
  }

  hoy() {
    this.dia.set(inicioDeDia(new Date()));
  }

  icono(p: TareaProgramada): string {
    if (!p.registro) return p.hora.getTime() < Date.now() ? 'time-outline' : 'ellipse-outline';
    return p.registro.hecha ? 'checkmark-circle' : 'close-circle';
  }

  color(p: TareaProgramada): string {
    if (!p.registro) return p.hora.getTime() < Date.now() ? 'warning' : 'medium';
    return p.registro.hecha ? 'success' : 'danger';
  }

  /** Marca una tarea; para hecha / no hecha pide confirmación con nota opcional. */
  async marcar(p: TareaProgramada, estado: EstadoRegistro) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrar()) return;
    let nota: string | undefined;
    if (estado !== 'quitar') {
      const r = await pedirNota(this.alertCtrl, {
        header: `¿Marcar como ${estado === 'hecha' ? 'hecha' : 'no hecha'}?`,
        message: `${p.tarea.nombre} · ${p.horario}`,
        confirmar: 'Marcar',
      });
      if (!r.ok) return;
      nota = r.nota;
    }
    try {
      await this.tareasSvc.registrar(personaId, p, estado, nota);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar la tarea.', 'danger');
    }
  }

  async opcionesProgramada(p: TareaProgramada) {
    if (!this.puedeRegistrar()) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${p.tarea.nombre} · ${p.horario}`,
      buttons: [
        {
          text: 'Marcar como hecha',
          icon: 'checkmark-circle-outline',
          handler: () => {
            void this.marcar(p, 'hecha');
          },
        },
        {
          text: 'Marcar como no hecha',
          icon: 'close-circle-outline',
          handler: () => {
            void this.marcar(p, 'omitida');
          },
        },
        ...(p.registro
          ? [
              {
                text: p.registro.nota ? 'Editar nota' : 'Agregar nota',
                icon: 'create-outline',
                handler: () => {
                  void this.editarNota(p);
                },
              },
              {
                text: 'Quitar registro',
                icon: 'trash-outline',
                role: 'destructive',
                handler: () => {
                  void this.marcar(p, 'quitar');
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
  private async editarNota(p: TareaProgramada) {
    const personaId = this.ctx.personaId();
    if (!personaId || !p.tarea.id || !p.registro?.id) return;
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
        'danger',
      );
    }
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
            void this.tareasSvc.cambiarActivo(personaId, t.id!, t.activo === false);
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
    const t = await this.toast.create({
      message,
      color,
      duration: 2500,
      position: 'top',
    });
    await t.present();
  }
}
