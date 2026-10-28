import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
} from '@ionic/angular';

/**
 * Lector de códigos QR con la cámara (getUserMedia + jsQR).
 * Funciona en el navegador y dentro del WebView de Android (permiso CAMERA en el manifest).
 * Devuelve el texto del QR con rol 'ok'.
 */
@Component({
  selector: 'app-escaner-modal',
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonText],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Escanear QR</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()" aria-label="Cerrar">
            <ion-icon slot="icon-only" name="close-outline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="escaner">
      <video #video playsinline muted autoplay></video>
      <canvas #canvas hidden></canvas>
      <div class="marco"></div>
      @if (error(); as e) {
        <div class="pie">
          <ion-text color="light"><p>{{ e }}</p></ion-text>
          <ion-button size="small" (click)="iniciar()">
            <ion-icon slot="start" name="refresh-outline" />
            Reintentar
          </ion-button>
        </div>
      } @else {
        <p class="pie">Apunta la cámara al código QR de la invitación</p>
      }
    </ion-content>
  `,
  styles: [
    `
      .escaner {
        --background: #000;
      }
      video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .marco {
        position: absolute;
        top: 50%;
        left: 50%;
        width: min(70vw, 280px);
        aspect-ratio: 1;
        transform: translate(-50%, -50%);
        border: 3px solid #fff;
        border-radius: 16px;
        box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
      }
      .pie {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 32px;
        text-align: center;
        color: #fff;
      }
    `,
  ],
})
export class EscanerModal implements AfterViewInit, OnDestroy {
  private readonly modalCtrl = inject(ModalController);
  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  readonly error = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private rafId = 0;
  private activo = false;

  ngAfterViewInit() {
    void this.iniciar();
  }

  /** El modal ya se cerró: una cámara que llegue tarde se apaga en vez de quedar encendida */
  private cerrado = false;

  ngOnDestroy() {
    this.cerrado = true;
    this.detener();
  }

  async iniciar() {
    this.error.set(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Este navegador no permite usar la cámara. Escribe el código a mano.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      // Se cerró el escáner mientras el navegador pedía la cámara: se apaga de inmediato
      if (this.cerrado) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const video = this.video().nativeElement;
      video.srcObject = this.stream;
      await video.play();
      this.activo = true;
      await this.leer();
    } catch (e) {
      console.error(e);
      this.error.set('No se pudo abrir la cámara. Revisa el permiso o escribe el código a mano.');
    }
  }

  private async leer() {
    const { default: jsQR } = await import('jsqr');
    const video = this.video().nativeElement;
    const canvas = this.canvas().nativeElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const paso = () => {
      if (!this.activo) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          this.detener();
          void this.modalCtrl.dismiss(code.data, 'ok');
          return;
        }
      }
      this.rafId = requestAnimationFrame(paso);
    };
    paso();
  }

  private detener() {
    this.activo = false;
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  cerrar() {
    this.detener();
    void this.modalCtrl.dismiss(null, 'cancelar');
  }
}
