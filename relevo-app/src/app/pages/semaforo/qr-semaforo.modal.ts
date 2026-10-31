import { Component, OnInit, inject, signal } from '@angular/core';
import {
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
import { SemaforoCompartidoService } from '../../core/services/semaforo-compartido.service';

/** QR y enlace del semáforo compartido de una persona, para abrirlo en otro dispositivo sin cuenta. */
@Component({
  selector: 'app-qr-semaforo-modal',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonText],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Semáforo por QR</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()" aria-label="Cerrar">
            <ion-icon slot="icon-only" name="close-outline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding ion-text-center">
      <p>Semáforo de hoy de <strong>{{ nombre }}</strong></p>

      @if (qr(); as src) {
        <img class="qr" [src]="src" alt="Código QR del semáforo" />
      } @else {
        <div class="qr placeholder"></div>
      }

      <ion-text color="medium">
        <p>
          Escanéalo con la cámara de otro teléfono o tableta: abre el semáforo sin iniciar sesión, solo
          para verlo (no se puede marcar).
        </p>
      </ion-text>
      <p class="enlace">{{ enlace }}</p>

      <ion-button expand="block" (click)="copiar()">
        <ion-icon slot="start" name="copy-outline" />
        Copiar enlace
      </ion-button>
    </ion-content>
  `,
  styles: [
    `
      .qr {
        width: min(72vw, 300px);
        aspect-ratio: 1;
        margin: 8px auto 12px;
        display: block;
        border-radius: 12px;
        background: #fff;
      }
      .placeholder {
        background: var(--ion-color-light);
      }
      .enlace {
        font-size: 0.8rem;
        word-break: break-all;
        color: var(--ion-color-medium-shade);
        margin-bottom: 16px;
      }
    `,
  ],
})
export class QrSemaforoModal implements OnInit {
  private readonly svc = inject(SemaforoCompartidoService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toast = inject(ToastController);

  /** Se rellenan desde componentProps */
  token!: string;
  nombre = '';

  readonly qr = signal<string | null>(null);

  get enlace(): string {
    return this.svc.enlace(this.token);
  }

  async ngOnInit() {
    try {
      this.qr.set(await this.svc.qrDataUrl(this.token));
    } catch (error) {
      console.error('No se pudo generar el QR', error);
    }
  }

  cerrar() {
    void this.modalCtrl.dismiss();
  }

  async copiar() {
    let message = 'Enlace copiado';
    try {
      await navigator.clipboard.writeText(this.enlace);
    } catch {
      message = 'No se pudo copiar en este dispositivo.';
    }
    const t = await this.toast.create({ message, duration: 2000, position: 'top' });
    await t.present();
  }
}
