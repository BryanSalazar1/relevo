import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ActionSheetController,
  AlertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
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
import { combineLatest, of, switchMap } from 'rxjs';
import { Invitacion, Miembro, ROL_COLOR, ROL_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import {
  InvitacionesService,
  formatearCodigo,
} from '../../core/services/invitaciones.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { edad } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { CompartirModal } from './compartir.modal';

@Component({
  selector: 'app-equipo',
  imports: [
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonBadge,
    IonButton,
    IonIcon,
    IonNote,
    IonSpinner,
    IonText,
  ],
  templateUrl: './equipo.page.html',
  styleUrl: './equipo.page.scss',
})
export class EquipoPage {
  private readonly auth = inject(AuthService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly invitacionesSvc = inject(InvitacionesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;
  readonly uid = this.auth.uid;
  readonly ROL_ETIQUETA = ROL_ETIQUETA;
  readonly ROL_COLOR = ROL_COLOR;
  readonly formatearCodigo = formatearCodigo;

  readonly miembros = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.miembrosSvc.miembros(id))),
  );
  readonly esPrincipal = computed(() => this.rol() === 'cuidador_principal');
  readonly edad = computed(() => edad(this.persona()?.fechaNacimiento));

  /** Solo se consultan si soy responsable (las rules no permiten listar a otros). */
  readonly invitaciones = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.esPrincipal)]).pipe(
      switchMap(([id, principal]) =>
        principal ? this.invitacionesSvc.activas(id) : of([] as Invitacion[]),
      ),
    ),
  );

  /** Crea una invitación y muestra el código + QR. */
  async invitar() {
    const persona = this.persona();
    if (!persona) return;
    try {
      const inv = await this.invitacionesSvc.crear(persona);
      await this.mostrarInvitacion(inv);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo crear la invitación.', 'danger');
    }
  }

  async mostrarInvitacion(invitacion: Invitacion) {
    const modal = await this.modalCtrl.create({
      component: CompartirModal,
      componentProps: { invitacion },
    });
    await modal.present();
  }

  async revocar(inv: Invitacion) {
    const alerta = await this.alertCtrl.create({
      header: '¿Cancelar esta invitación?',
      message: `El código ${formatearCodigo(inv.codigo)} dejará de funcionar.`,
      buttons: [
        { text: 'No', role: 'cancel' },
        { text: 'Cancelar invitación', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.invitacionesSvc.desactivar(inv.codigo);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cancelar.', 'danger');
    }
  }

  /** Opciones sobre un miembro (solo el responsable): hacer/quitar responsable, quitar del equipo. */
  async opcionesMiembro(m: Miembro) {
    if (!this.esPrincipal() || m.uid === this.uid) return;
    const tipo = await this.miembrosSvc.tipoDe(m.uid);
    const buttons: { text: string; icon?: string; role?: string; handler?: () => void }[] = [];

    if (tipo === 'familiar') {
      if (m.rol === 'cuidador_principal') {
        buttons.push({
          text: 'Quitar como responsable',
          icon: 'person-circle-outline',
          handler: () => {
            void this.cambiarRol(m, 'familiar');
          },
        });
      } else {
        buttons.push({
          text: 'Hacer responsable',
          icon: 'key-outline',
          handler: () => {
            void this.cambiarRol(m, 'cuidador_principal');
          },
        });
      }
    }
    buttons.push(
      {
        text: 'Quitar del equipo',
        icon: 'trash-outline',
        role: 'destructive',
        handler: () => {
          void this.quitar(m);
        },
      },
      { text: 'Cancelar', role: 'cancel' },
    );

    const sheet = await this.actionSheetCtrl.create({
      header: `${m.nombre} · ${ROL_ETIQUETA[m.rol]}`,
      buttons,
    });
    await sheet.present();
  }

  private async cambiarRol(m: Miembro, rol: Miembro['rol']) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      await this.miembrosSvc.cambiarRol(personaId, m.uid, rol);
      await this.aviso(`${m.nombre} ahora es ${ROL_ETIQUETA[rol].toLowerCase()}.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cambiar el rol.', 'danger');
    }
  }

  private async quitar(m: Miembro) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Quitar a ${m.nombre}?`,
      message: 'Dejará de ver la bitácora de inmediato.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Quitar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.miembrosSvc.quitar(personaId, m.uid);
      await this.aviso(`${m.nombre} ya no forma parte del equipo.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo quitar al miembro.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
