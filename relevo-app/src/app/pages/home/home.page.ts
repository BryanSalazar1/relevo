import { Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
  AlertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { TIPO_USUARIO_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { PersonasService } from '../../core/services/personas.service';
import { edad } from '../../core/utils/fechas';
import { pedirTipoCuenta } from '../../core/utils/tipo-cuenta';

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonText,
    IonSpinner,
    IonFab,
    IonFabButton,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly personasSvc = inject(PersonasService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);
  private pidiendoTipo = false;

  readonly usuario = this.auth.user;
  readonly perfil = this.auth.perfil;
  /** `undefined` mientras llega el primer snapshot de Firestore */
  readonly personas = toSignal(this.personasSvc.misPersonas());
  readonly edad = edad;

  /** Solo las cuentas de familiar dan de alta personas cuidadas */
  readonly esFamiliar = computed(() => this.perfil()?.tipo === 'familiar');
  readonly tipoEtiqueta = computed(() => {
    const tipo = this.perfil()?.tipo;
    return tipo ? TIPO_USUARIO_ETIQUETA[tipo] : '';
  });

  constructor() {
    // Cuentas creadas antes de que existiera el tipo: se les pide una sola vez
    effect(() => {
      const perfil = this.perfil();
      if (perfil && !perfil.tipo) untracked(() => void this.completarTipo());
    });
  }

  private async completarTipo() {
    if (this.pidiendoTipo) return;
    this.pidiendoTipo = true;
    try {
      const tipo = await pedirTipoCuenta(this.alertCtrl);
      if (tipo) await this.auth.definirTipo(tipo);
    } catch (error) {
      console.error(error);
    } finally {
      this.pidiendoTipo = false;
    }
  }

  async nuevaPersona() {
    if (!this.esFamiliar()) {
      await this.mostrar('Solo una cuenta de familiar puede dar de alta a una persona.', 'danger');
      return;
    }
    const alerta = await this.alertCtrl.create({
      header: 'Nueva persona cuidada',
      message: 'Quedarás como responsable de su bitácora y podrás invitar al equipo.',
      inputs: [
        { name: 'nombre', type: 'text', placeholder: 'Nombre', attributes: { autocapitalize: 'words' } },
        { name: 'fechaNacimiento', type: 'date', placeholder: 'Fecha de nacimiento' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Crear', role: 'confirm' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{
      values: { nombre: string; fechaNacimiento: string };
    }>();
    if (role !== 'confirm') return;

    const nombre = data?.values?.nombre?.trim();
    if (!nombre) return;

    try {
      const id = await this.personasSvc.crearPersona({
        nombre,
        fechaNacimiento: data?.values?.fechaNacimiento || undefined,
      });
      await this.mostrar(`"${nombre}" se creó. Ya puedes registrar su bitácora.`, 'success');
      await this.router.navigate(['/personas', id]);
    } catch (error) {
      console.error(error);
      await this.mostrar('No se pudo guardar. Revisa tu conexión.', 'danger');
    }
  }

  async salir() {
    await this.auth.cerrarSesion();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private async mostrar(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 3000, position: 'top' });
    await t.present();
  }
}
