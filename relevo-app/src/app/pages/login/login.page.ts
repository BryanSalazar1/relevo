import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonInputPasswordToggle,
  IonLabel,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { TIPOS_USUARIO, TipoUsuario } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';

type Modo = 'login' | 'registro';

@Component({
  selector: 'app-login',
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonInput,
    IonInputPasswordToggle,
    IonCheckbox,
    IonButton,
    IonSpinner,
    IonText,
    IonIcon,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonNote,
  ],
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastController);

  readonly modo = signal<Modo>('login');
  readonly cargando = signal(false);
  readonly tipos = TIPOS_USUARIO;
  readonly tipo = signal<TipoUsuario>('familiar');
  readonly descripcionTipo = computed(
    () => TIPOS_USUARIO.find((t) => t.valor === this.tipo())?.descripcion ?? '',
  );

  nombre = '';
  email = '';
  password = '';
  /** Al registrarse hay que aceptar el aviso de privacidad (/privacidad) */
  aceptaPrivacidad = false;

  alternarModo() {
    this.modo.update((m) => (m === 'login' ? 'registro' : 'login'));
  }

  cambiarTipo(valor: unknown) {
    if (valor === 'familiar' || valor === 'enfermero' || valor === 'medico') this.tipo.set(valor);
  }

  /** Lo que falta o está mal antes de llamar a Firebase (los `required` del HTML no detienen el envío). */
  errorFormulario(): string {
    const email = this.email.trim();
    if (this.modo() === 'registro' && this.nombre.trim().length < 2) return 'Escribe tu nombre.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Escribe un correo válido.';
    if (this.password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
    if (this.modo() === 'registro' && !this.aceptaPrivacidad) {
      return 'Para crear tu cuenta acepta el aviso de privacidad.';
    }
    return '';
  }

  /** Manda el correo de Firebase para crear una contraseña nueva. */
  async recuperarContrasena() {
    const email = this.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      await this.avisar('Escribe tu correo arriba y vuelve a tocar "¿Olvidaste tu contraseña?".');
      return;
    }
    if (this.cargando()) return;
    this.cargando.set(true);
    try {
      await this.auth.recuperarContrasena(email);
      await this.avisar(
        `Te enviamos un correo a ${email} con un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.`,
        'success',
      );
    } catch (error) {
      await this.avisar(this.auth.mensajeError(error));
    } finally {
      this.cargando.set(false);
    }
  }

  async enviar() {
    if (this.cargando()) return;
    const error = this.errorFormulario();
    if (error) {
      await this.avisar(error);
      return;
    }
    this.cargando.set(true);
    try {
      if (this.modo() === 'registro') {
        await this.auth.registrar(this.nombre.trim(), this.email.trim(), this.password, this.tipo());
      } else {
        await this.auth.iniciarSesion(this.email.trim(), this.password);
      }
      // Si venía de un enlace (p. ej. /unirse/CODIGO), regresa ahí
      const volver = this.route.snapshot.queryParamMap.get('volver');
      await this.router.navigateByUrl(volver && volver.startsWith('/') ? volver : '/home', {
        replaceUrl: true,
      });
    } catch (error) {
      await this.avisar(this.auth.mensajeError(error));
    } finally {
      this.cargando.set(false);
    }
  }

  private async avisar(message: string, color: 'danger' | 'success' = 'danger') {
    const t = await this.toast.create({
      message,
      duration: color === 'success' ? 6000 : 3500,
      color,
      position: 'top',
    });
    await t.present();
  }
}
