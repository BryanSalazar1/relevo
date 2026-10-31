import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetButton, ActionSheetController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { PersonaCuidada } from '../../core/models';
import { MiembrosService } from '../../core/services/miembros.service';
import { SemaforoCompartidoService } from '../../core/services/semaforo-compartido.service';
import { QrSemaforoModal } from './qr-semaforo.modal';

/**
 * Lo que ofrece tocar el semáforo (desde el inicio o desde Hoy): abrirlo aquí, copiar su enlace o
 * mostrar su QR. El enlace y el QR llevan al mismo semáforo sin iniciar sesión (/s/<token>).
 * La primera vez que el responsable copia el enlace o muestra el QR se crea el token; los demás
 * miembros pueden compartirlo cuando ya existe. Solo el responsable puede cambiarlo.
 */
@Injectable({ providedIn: 'root' })
export class OpcionesSemaforoService {
  private readonly svc = inject(SemaforoCompartidoService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly router = inject(Router);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  async abrir(persona: PersonaCuidada) {
    const id = persona.id;
    if (!id) return;
    const rol = await firstValueFrom(this.miembrosSvc.miRol(id)).catch(() => null);
    const esResponsable = rol === 'cuidador_principal';
    const puedeCompartir = esResponsable || !!persona.enlaceSemaforo;

    const buttons: ActionSheetButton[] = [
      {
        text: 'Abrir semáforo',
        icon: 'semaforo',
        handler: () => {
          void this.router.navigate(['/personas', id, 'semaforo']);
        },
      },
    ];
    if (puedeCompartir) {
      buttons.push(
        {
          text: 'Copiar enlace',
          icon: 'link-outline',
          handler: () => {
            void this.copiar(persona, esResponsable);
          },
        },
        {
          text: 'Mostrar código QR',
          icon: 'qr-code-outline',
          handler: () => {
            void this.mostrarQr(persona, esResponsable);
          },
        },
      );
    }
    if (esResponsable && persona.enlaceSemaforo) {
      buttons.push({
        text: 'Cambiar enlace',
        icon: 'refresh-outline',
        handler: () => {
          void this.cambiar(persona);
        },
      });
    }
    buttons.push({ text: 'Cancelar', role: 'cancel' });

    const sheet = await this.actionSheetCtrl.create({
      header: `Semáforo de ${persona.nombre}`,
      subHeader: puedeCompartir
        ? 'El enlace y el QR lo abren en cualquier navegador, sin iniciar sesión y solo para ver.'
        : 'El responsable puede crear un enlace para verlo en otro dispositivo sin cuenta.',
      buttons,
    });
    await sheet.present();
  }

  /** Token vigente; si no hay y es el responsable, lo crea. */
  private async token(persona: PersonaCuidada, esResponsable: boolean): Promise<string | null> {
    if (persona.enlaceSemaforo) return persona.enlaceSemaforo;
    if (!esResponsable) return null;
    try {
      return await this.svc.crearToken(persona);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo crear el enlace. Revisa tu conexión e inténtalo de nuevo.', 'danger');
      return null;
    }
  }

  private async copiar(persona: PersonaCuidada, esResponsable: boolean) {
    const token = await this.token(persona, esResponsable);
    if (!token) return;
    try {
      await navigator.clipboard.writeText(this.svc.enlace(token));
      await this.aviso('Enlace copiado: quien lo abra ve el semáforo sin iniciar sesión.');
    } catch {
      await this.aviso('No se pudo copiar en este dispositivo.', 'danger');
    }
  }

  private async mostrarQr(persona: PersonaCuidada, esResponsable: boolean) {
    const token = await this.token(persona, esResponsable);
    if (!token) return;
    const modal = await this.modalCtrl.create({
      component: QrSemaforoModal,
      componentProps: { token, nombre: persona.nombre },
    });
    await modal.present();
  }

  /** El responsable cambia el enlace: el anterior (y su QR) dejan de funcionar al instante. */
  private async cambiar(persona: PersonaCuidada) {
    const alert = await this.alertCtrl.create({
      header: '¿Cambiar el enlace?',
      message:
        'El enlace y el QR que ya compartiste dejarán de funcionar. Úsalo si se compartió con alguien que ya no debe verlo.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cambiar', role: 'confirm' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'confirm') return;
    try {
      await this.svc.crearToken(persona);
      await this.aviso('Listo: el enlace anterior ya no funciona. Copia o muestra el nuevo.');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cambiar el enlace. Revisa tu conexión e inténtalo de nuevo.', 'danger');
    }
  }

  private async aviso(message: string, color?: string) {
    const t = await this.toastCtrl.create({ message, color, duration: 3000, position: 'top' });
    await t.present();
  }
}
