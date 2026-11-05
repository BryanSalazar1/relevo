import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';

/** Mensaje y detalles de un error de una Cloud Function invocable. */
function errorFuncion(error: unknown): { mensaje: string; esperaSeg?: number } {
  const e = error as { message?: string; code?: string; details?: { esperaSeg?: number } };
  if (e?.code === 'functions/unavailable' && !e.message) return { mensaje: 'Sin conexión. Revisa tu internet.' };
  const mensaje = e?.message && !/^internal$/i.test(e.message) ? e.message : 'Ocurrió un error. Inténtalo de nuevo.';
  return { mensaje, esperaSeg: e?.details?.esperaSeg };
}

/**
 * Verificación del correo al registrarse: llega un código de 6 dígitos (Cloud Function
 * enviarCodigoCorreo) y, al escribirlo bien (verificarCodigoCorreo), la cuenta queda verificada.
 * Sin verificar, las rules no dejan leer ni escribir datos y authGuard trae aquí.
 */
@Component({
  selector: 'app-verificar',
  imports: [FormsModule, IonHeader, IonToolbar, IonTitle, IonContent, IonInput, IonButton, IonSpinner, IonText, IonIcon],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-title>Relevo</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="contenedor">
        <div class="icono" aria-hidden="true"><ion-icon name="mail-outline" /></div>
        <h1>Verifica tu correo</h1>
        <p class="explica">
          @if (enviado()) {
            Te enviamos un código de 6 dígitos a <strong>{{ destino() || email() }}</strong>. Escríbelo aquí; vence en
            {{ vigencia() }} minutos. Si no lo ves, revisa la carpeta de spam.
          } @else {
            Para proteger los datos de cuidado, confirmamos que el correo <strong>{{ email() }}</strong> es tuyo.
          }
        </p>

        <form (ngSubmit)="verificar()">
          <ion-input
            class="codigo"
            name="codigo"
            label="Código"
            labelPlacement="floating"
            fill="outline"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            [(ngModel)]="codigo"
            data-prueba="codigo"
          />
          <ion-button expand="block" type="submit" [disabled]="ocupado() || codigo.trim().length < 6">
            @if (verificando()) {
              <ion-spinner name="crescent" />
            } @else {
              Verificar
            }
          </ion-button>
        </form>

        <ion-button expand="block" fill="clear" [disabled]="ocupado() || espera() > 0" (click)="enviar()">
          @if (espera() > 0) {
            Reenviar código en {{ espera() }} s
          } @else if (enviando()) {
            Enviando…
          } @else {
            {{ enviado() ? 'Reenviar código' : 'Enviar código' }}
          }
        </ion-button>
        <ion-text color="medium">
          <p class="otra">¿Ese no es tu correo o quieres usar otro?</p>
        </ion-text>
        <ion-button expand="block" fill="outline" size="small" [disabled]="ocupado()" (click)="cambiarCorreo()" data-prueba="cambiar-correo">
          Cambiar mi correo
        </ion-button>
        <ion-button expand="block" fill="clear" color="medium" size="small" (click)="salir()">
          Cerrar sesión
        </ion-button>
      </div>
    </ion-content>
  `,
  styles: `
    .contenedor {
      max-width: 420px;
      margin: 32px auto 0;
      text-align: center;
    }
    .icono {
      width: 64px;
      height: 64px;
      margin: 0 auto 12px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: rgba(var(--ion-color-primary-rgb), 0.12);
      color: var(--ion-color-primary);
      font-size: 32px;
    }
    h1 {
      font-size: 1.4rem;
      margin: 0 0 8px;
    }
    .explica {
      color: var(--ion-color-medium-shade);
      margin: 0 0 20px;
      line-height: 1.45;
    }
    ion-input.codigo {
      margin-bottom: 12px;
      --padding-start: 16px;
      font-size: 1.5rem;
    }
    ion-input.codigo ::ng-deep input {
      letter-spacing: 0.4em;
      text-align: center;
    }
    .otra {
      font-size: 0.85rem;
      margin: 16px 0 0;
    }
  `,
})
export class VerificarPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastController);
  private readonly alertas = inject(AlertController);
  /** Correo al que se mandó el último código (el de la cuenta, o el nuevo si lo está cambiando) */
  readonly destino = signal('');
  /** Correo nuevo pedido con "Cambiar mi correo": los reenvíos van a ese */
  private correoNuevo: string | undefined;

  readonly email = computed(() => this.auth.user()?.email ?? 'tu correo');
  readonly enviado = signal(false);
  readonly enviando = signal(false);
  readonly verificando = signal(false);
  readonly ocupado = computed(() => this.enviando() || this.verificando());
  readonly vigencia = signal(10);
  /** Segundos que faltan para poder pedir otro código */
  readonly espera = signal(0);
  codigo = '';
  private reloj: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearInterval(this.reloj));
  }

  ngOnInit() {
    // Al llegar (recién registrado o una cuenta sin verificar) se manda el código; si se pidió hace
    // menos de un minuto, el servidor dice cuánto esperar y el código anterior sigue sirviendo
    void this.enviar(true);
  }

  private contar(segundos: number) {
    this.espera.set(Math.max(0, Math.ceil(segundos)));
    clearInterval(this.reloj);
    this.reloj = setInterval(() => {
      this.espera.update((s) => Math.max(0, s - 1));
      if (this.espera() === 0) clearInterval(this.reloj);
    }, 1000);
  }

  async enviar(alEntrar = false) {
    if (this.ocupado()) return;
    this.enviando.set(true);
    try {
      const r = await this.auth.enviarCodigo(this.correoNuevo);
      if (r.email) this.destino.set(r.email);
      if (r.verificado) {
        await this.continuar();
        return;
      }
      this.enviado.set(true);
      if (r.vigenciaMin) this.vigencia.set(r.vigenciaMin);
      this.contar(r.reenvioSeg ?? 60);
      if (!alEntrar) await this.avisar('Te enviamos un código nuevo.', 'success');
    } catch (error) {
      const { mensaje, esperaSeg } = errorFuncion(error);
      if (esperaSeg) {
        // Ya hay un código reciente: sirve el mismo
        this.enviado.set(true);
        this.contar(esperaSeg);
        if (alEntrar) return;
      }
      await this.avisar(mensaje);
    } finally {
      this.enviando.set(false);
    }
  }

  async verificar() {
    const codigo = this.codigo.replace(/\s+/g, '');
    if (this.ocupado()) return;
    if (!/^[0-9]{6}$/.test(codigo)) {
      await this.avisar('Escribe los 6 dígitos del código.');
      return;
    }
    this.verificando.set(true);
    try {
      const { correoNuevo } = await this.auth.verificarCodigo(codigo);
      if (correoNuevo) {
        // Firebase cierra la sesión al cambiar el correo: se vuelve a entrar con el nuevo
        await this.auth.cerrarSesion(`/login?correo=${encodeURIComponent(correoNuevo)}`);
        return;
      }
      await this.avisar('¡Listo! Tu correo quedó verificado.', 'success');
      await this.continuar();
    } catch (error) {
      await this.avisar(errorFuncion(error).mensaje);
      this.codigo = '';
    } finally {
      this.verificando.set(false);
    }
  }

  private async continuar() {
    const volver = this.route.snapshot.queryParamMap.get('volver');
    await this.router.navigateByUrl(volver && volver.startsWith('/') ? volver : '/home', { replaceUrl: true });
  }

  /** La cuenta se queda con el correo nuevo cuando se escribe el código que llega ahí */
  async cambiarCorreo() {
    const alerta = await this.alertas.create({
      header: 'Cambiar mi correo',
      message: 'Te mandaremos el código al correo nuevo. Al escribirlo, tu cuenta quedará con ese correo.',
      inputs: [{ name: 'email', type: 'email', placeholder: 'tucorreo@gmail.com', attributes: { autocomplete: 'email' } }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Enviar código', role: 'confirm' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss();
    if (role !== 'confirm') return;
    const email = String(data?.values?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      await this.avisar('Escribe un correo válido.');
      return;
    }
    const anterior = this.correoNuevo;
    this.correoNuevo = email;
    this.espera.set(0);
    this.codigo = '';
    await this.enviar();
    // Si no se pudo mandar (correo de otra cuenta, etc.), se queda como estaba
    if (this.destino() !== email) this.correoNuevo = anterior;
  }

  async salir() {
    await this.auth.cerrarSesion();
  }

  private async avisar(message: string, color: 'danger' | 'success' = 'danger') {
    const t = await this.toast.create({ message, color, duration: color === 'success' ? 2500 : 4000, position: 'top' });
    await t.present();
  }
}
