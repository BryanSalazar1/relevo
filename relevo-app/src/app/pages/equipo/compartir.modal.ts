import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Invitacion, ROL_COLOR, ROL_ETIQUETA } from '../../core/models';
import {
  InvitacionesService,
  formatearCodigo,
} from '../../core/services/invitaciones.service';

/** Muestra el código y el QR de una invitación con opciones para compartirla. */
@Component({
  selector: 'app-compartir-modal',
  imports: [DatePipe, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonText, IonBadge],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Invitación</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()" aria-label="Cerrar">
            <ion-icon slot="icon-only" name="close-outline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding ion-text-center">
      <p>Para unirse a la bitácora de <strong>{{ invitacion.personaNombre }}</strong></p>
      <p class="tipos">
        @if (invitacion.rol) {
          Entra como <ion-badge [color]="ROL_COLOR[invitacion.rol]">{{ ROL_ETIQUETA[invitacion.rol] }}</ion-badge>
        } @else {
          Entra según su tipo de cuenta
        }
      </p>

      @if (qr(); as src) {
        <img class="qr" [src]="src" alt="Código QR de la invitación" />
      } @else {
        <div class="qr placeholder"></div>
      }

      <div class="codigo">{{ codigo }}</div>
      <ion-text color="medium">
        <p>Vence el {{ invitacion.expiraEn.toDate() | date: "d 'de' MMMM 'de' y" }} · hasta {{ invitacion.usosMax }} personas</p>
      </ion-text>

      <ion-button expand="block" (click)="compartir()">
        <ion-icon slot="start" name="share-social-outline" />
        Compartir
      </ion-button>
      <ion-button expand="block" fill="outline" (click)="copiar(codigo, 'Código copiado')">
        <ion-icon slot="start" name="copy-outline" />
        Copiar código
      </ion-button>
      <ion-button expand="block" fill="clear" size="small" (click)="copiar(enlace, 'Enlace copiado')">
        <ion-icon slot="start" name="link-outline" />
        Copiar enlace
      </ion-button>

      <ion-text color="medium">
        <p class="ayuda">
          Quien reciba el código puede escribirlo en <em>Unirme con código</em>, escanear el QR desde la
          app o con la cámara del teléfono. Entrará con el rol de esta invitación solo en esta persona;
          con otras personas puede tener otro rol.
        </p>
      </ion-text>
    </ion-content>
  `,
  styles: [
    `
      .qr {
        display: block;
        width: min(70vw, 280px);
        height: auto;
        aspect-ratio: 1;
        margin: 12px auto;
        padding: 8px;
        border-radius: 12px;
        background: #fff;
      }
      .placeholder {
        background: var(--ion-color-light);
      }
      .codigo {
        font-family: ui-monospace, 'Cascadia Mono', 'Consolas', monospace;
        font-size: 2rem;
        font-weight: 700;
        letter-spacing: 0.15em;
        margin: 8px 0;
      }
      .ayuda {
        font-size: 0.85rem;
        margin-top: 16px;
      }
      .tipos {
        display: flex;
        justify-content: center;
        gap: 6px;
        margin: 0 0 4px;
      }
    `,
  ],
})
export class CompartirModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly invitacionesSvc = inject(InvitacionesService);
  private readonly toast = inject(ToastController);

  /** Se rellena desde componentProps */
  invitacion!: Invitacion;

  readonly ROL_ETIQUETA = ROL_ETIQUETA;
  readonly ROL_COLOR = ROL_COLOR;
  readonly qr = signal<string | null>(null);

  get codigo(): string {
    return formatearCodigo(this.invitacion.codigo);
  }

  get enlace(): string {
    return this.invitacionesSvc.enlace(this.invitacion.codigo);
  }

  get mensaje(): string {
    return this.invitacionesSvc.textoInvitacion(this.invitacion);
  }

  async ngOnInit() {
    try {
      this.qr.set(await this.invitacionesSvc.qrDataUrl(this.invitacion.codigo));
    } catch (error) {
      console.error('No se pudo generar el QR', error);
    }
  }

  cerrar() {
    void this.modalCtrl.dismiss();
  }

  async copiar(texto: string, aviso: string) {
    try {
      await navigator.clipboard.writeText(texto);
      await this.aviso(aviso);
    } catch {
      await this.aviso('No se pudo copiar en este dispositivo.');
    }
  }

  async compartir() {
    try {
      const resultado = await this.invitacionesSvc.compartir(this.invitacion);
      if (resultado === 'copiado') await this.aviso('Invitación copiada al portapapeles');
    } catch {
      await this.aviso('No se pudo compartir en este dispositivo.');
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, duration: 2000, position: 'top' });
    await t.present();
  }
}
