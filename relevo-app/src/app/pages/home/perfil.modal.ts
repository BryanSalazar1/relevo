import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { TIPO_USUARIO_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';

/**
 * Perfil del usuario: cambia su nombre y, en la zona de peligro, elimina su cuenta.
 * Se cierra con rol 'guardar' (nombre nuevo en data), 'eliminada' (la cuenta ya no existe) o 'cancelar'.
 */
@Component({
  selector: 'app-perfil-modal',
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonInput,
    IonBadge,
    IonNote,
    IonIcon,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()" [disabled]="guardando">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Mi perfil</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!nombre.trim() || guardando">
            Guardar
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-input
        label="Nombre"
        labelPlacement="stacked"
        fill="outline"
        name="nombre"
        [(ngModel)]="nombre"
        autocapitalize="words"
        maxlength="60"
        class="ion-margin-bottom"
      />
      <ion-input
        label="Correo"
        labelPlacement="stacked"
        fill="outline"
        [value]="email"
        [readonly]="true"
        class="ion-margin-bottom"
      />
      <ion-item lines="none" class="tipo">
        <ion-label>Tipo de cuenta</ion-label>
        <ion-badge slot="end" color="primary">{{ tipoEtiqueta }}</ion-badge>
      </ion-item>
      <ion-note color="medium">
        El correo y el tipo de cuenta no se pueden cambiar. El nombre se actualiza en todos los
        equipos de los que formas parte.
      </ion-note>

      <ion-list inset class="seguridad">
        <ion-list-header>
          <ion-label>Seguridad y privacidad</ion-label>
        </ion-list-header>
        <ion-item button [detail]="false" (click)="cambiarContrasena()" [disabled]="guardando">
          <ion-icon slot="start" name="key-outline" color="primary" />
          <ion-label>Cambiar contraseña</ion-label>
        </ion-item>
        <ion-item button detail (click)="verPrivacidad()">
          <ion-icon slot="start" name="document-text-outline" color="primary" />
          <ion-label>Aviso de privacidad</ion-label>
        </ion-item>
      </ion-list>

      <ion-list inset class="peligro">
        <ion-list-header>
          <ion-label color="danger">Zona de peligro</ion-label>
        </ion-list-header>
        <ion-item lines="none">
          <ion-label class="ion-text-wrap">
            <h3>Eliminar mi cuenta</h3>
            <p>
              Dejarás de formar parte de todos los equipos. Si eres la única persona en la bitácora
              de alguien, esa bitácora se borra con todo su historial. No se puede deshacer.
            </p>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-button
            slot="end"
            color="danger"
            fill="outline"
            (click)="eliminar()"
            [disabled]="guardando"
          >
            <ion-icon slot="start" name="trash-outline" />
            Eliminar cuenta
          </ion-button>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [
    `
      ion-note {
        display: block;
        margin: 8px 0 24px;
      }
      .tipo {
        --padding-start: 0;
      }
      .peligro {
        margin-inline: 0;
      }
    `,
  ],
})
export class PerfilModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  nombre = '';
  email = '';
  tipoEtiqueta = '';
  guardando = false;

  ngOnInit() {
    const u = this.auth.user();
    this.nombre = u?.displayName ?? this.auth.perfil()?.nombre ?? '';
    this.email = u?.email ?? '';
    const tipo = this.auth.tipoActual;
    this.tipoEtiqueta = tipo ? TIPO_USUARIO_ETIQUETA[tipo] : 'Sin definir';
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.nombre.trim()) return;
    void this.modalCtrl.dismiss({ nombre: this.nombre.trim() }, 'guardar');
  }

  /** Cierra el modal y abre el aviso de privacidad. */
  async verPrivacidad() {
    await this.modalCtrl.dismiss(null, 'cancelar');
    await this.router.navigateByUrl('/privacidad');
  }

  /** Pide la contraseña actual y la nueva (Firebase exige sesión reciente para cambiarla). */
  async cambiarContrasena() {
    const alerta = await this.alertCtrl.create({
      header: 'Cambiar contraseña',
      inputs: [
        { name: 'actual', type: 'password', placeholder: 'Contraseña actual', attributes: { autocomplete: 'current-password' } },
        { name: 'nueva', type: 'password', placeholder: 'Nueva (mínimo 6 caracteres)', attributes: { autocomplete: 'new-password' } },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cambiar', role: 'confirm' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{ values: { actual?: string; nueva?: string } }>();
    if (role !== 'confirm') return;
    const actual = data?.values?.actual ?? '';
    const nueva = data?.values?.nueva ?? '';
    if (!actual || nueva.length < 6) {
      const aviso = await this.alertCtrl.create({
        header: 'Revisa los datos',
        message: 'Escribe tu contraseña actual y una nueva de al menos 6 caracteres.',
        buttons: ['Entendido'],
      });
      await aviso.present();
      return;
    }
    this.guardando = true;
    try {
      await this.auth.cambiarContrasena(actual, nueva);
      const listo = await this.alertCtrl.create({
        header: 'Contraseña actualizada',
        message: 'Usa la nueva contraseña la próxima vez que entres.',
        buttons: ['Entendido'],
      });
      await listo.present();
    } catch (error) {
      console.error(error);
      const aviso = await this.alertCtrl.create({
        header: 'No se pudo cambiar la contraseña',
        message: this.auth.mensajeError(error),
        buttons: ['Entendido'],
      });
      await aviso.present();
    } finally {
      this.guardando = false;
    }
  }

  /** Pide la contraseña (Firebase exige sesión reciente) y borra la cuenta. */
  async eliminar() {
    const alerta = await this.alertCtrl.create({
      header: '¿Eliminar tu cuenta?',
      message: 'Escribe tu contraseña para confirmar. Esta acción no se puede deshacer.',
      inputs: [
        {
          name: 'password',
          type: 'password',
          placeholder: 'Contraseña',
          attributes: { autocomplete: 'current-password' },
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{ values: { password?: string } }>();
    const password = data?.values?.password ?? '';
    if (role !== 'destructive') return;
    if (!password) {
      const sinClave = await this.alertCtrl.create({
        header: 'Falta la contraseña',
        message: 'Para eliminar la cuenta escribe tu contraseña actual.',
        buttons: ['Entendido'],
      });
      await sinClave.present();
      return;
    }
    this.guardando = true;
    try {
      await this.auth.eliminarCuenta(password);
      void this.modalCtrl.dismiss(null, 'eliminada');
    } catch (error) {
      console.error(error);
      const aviso = await this.alertCtrl.create({
        header: 'No se pudo eliminar la cuenta',
        message: this.auth.mensajeError(error),
        buttons: ['Entendido'],
      });
      await aviso.present();
    } finally {
      this.guardando = false;
    }
  }
}
