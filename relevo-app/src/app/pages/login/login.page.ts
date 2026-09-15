import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonButton,
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
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonInput,
    IonInputPasswordToggle,
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

  alternarModo() {
    this.modo.update((m) => (m === 'login' ? 'registro' : 'login'));
  }

  cambiarTipo(valor: unknown) {
    if (valor === 'familiar' || valor === 'enfermero' || valor === 'medico') this.tipo.set(valor);
  }

  async enviar() {
    if (this.cargando()) return;
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
      const t = await this.toast.create({
        message: this.auth.mensajeError(error),
        duration: 3500,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      this.cargando.set(false);
    }
  }
}
