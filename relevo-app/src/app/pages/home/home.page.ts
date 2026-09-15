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
  ModalController,
  ToastController,
} from '@ionic/angular';
import { TIPO_USUARIO_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { PersonasService } from '../../core/services/personas.service';
import { edad } from '../../core/utils/fechas';
import { pedirTipoCuenta } from '../../core/utils/tipo-cuenta';
import { DatosPersona, PersonaModal } from './persona.modal';
import { PerfilModal } from './perfil.modal';

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
  private readonly modalCtrl = inject(ModalController);
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
    const modal = await this.modalCtrl.create({ component: PersonaModal, componentProps: { persona: null } });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosPersona>();
    if (role !== 'guardar' || !data) return;
    const nombre = data.nombre;

    try {
      const id = await this.personasSvc.crearPersona({
        nombre,
        ...(data.fechaNacimiento ? { fechaNacimiento: data.fechaNacimiento } : {}),
        ...(data.descripcion ? { descripcion: data.descripcion } : {}),
      });
      await this.mostrar(`"${nombre}" se creó. Ya puedes registrar su bitácora.`, 'success');
      await this.router.navigate(['/personas', id]);
    } catch (error) {
      console.error(error);
      await this.mostrar('No se pudo guardar. Revisa tu conexión.', 'danger');
    }
  }

  /** Nombre y, en la zona de peligro, eliminación de la cuenta. */
  async editarPerfil() {
    const modal = await this.modalCtrl.create({ component: PerfilModal });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<{ nombre: string }>();
    if (role === 'eliminada') {
      await this.mostrar('Tu cuenta se eliminó.', 'success');
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return;
    }
    if (role !== 'guardar' || !data?.nombre) return;
    try {
      await this.auth.actualizarNombre(data.nombre);
      await this.mostrar('Nombre actualizado.', 'success');
    } catch (error) {
      console.error(error);
      await this.mostrar('No se pudo actualizar el nombre.', 'danger');
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
