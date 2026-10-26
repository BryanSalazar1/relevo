import { Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonContent,
  IonFab,
  IonHeader,
  IonIcon,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';

import { PersonaCuidada, TIPO_USUARIO_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { PersonasService } from '../../core/services/personas.service';
import { edad } from '../../core/utils/fechas';
import { pedirTipoCuenta } from '../../core/utils/tipo-cuenta';
import { PerfilModal } from './perfil.modal';
import { DatosPersona, PersonaModal } from './persona.modal';

/** Iniciales de un nombre ("Rosa Martínez" → "RM"); con un correo, su primera letra. */
export function inicialesDe(nombre: string | null | undefined): string {
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '·';
  const letras = partes.length === 1 ? partes[0].slice(0, 2) : partes[0][0] + partes[partes.length - 1][0];
  return letras.toUpperCase();
}

/** Tono (0–359) estable para un nombre, para que cada persona tenga su color. */
export function tonoDe(nombre: string): number {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

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
    IonCard,
    IonBadge,
    IonSpinner,
    IonFab,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly personasSvc = inject(PersonasService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toast = inject(ToastController);
  private pidiendoTipo = false;

  readonly usuario = this.auth.user;
  readonly perfil = this.auth.perfil;
  /** `undefined` mientras llega el primer snapshot de Firestore */
  readonly personas = toSignal(this.personasSvc.misPersonas());
  readonly edad = edad;
  readonly inicialesDe = inicialesDe;

  /** Solo las cuentas de familiar dan de alta personas cuidadas */
  readonly esFamiliar = computed(() => this.perfil()?.tipo === 'familiar');
  readonly esMedico = computed(() => this.perfil()?.tipo === 'medico');
  readonly tipoEtiqueta = computed(() => {
    const tipo = this.perfil()?.tipo;
    return tipo ? TIPO_USUARIO_ETIQUETA[tipo] : '';
  });

  private readonly nombre = computed(
    () => this.usuario()?.displayName || this.perfil()?.nombre || this.usuario()?.email || '',
  );
  /** Primer nombre para el saludo ("Hola, Rosa") */
  readonly nombreCorto = computed(() => this.nombre().trim().split(/\s+/)[0] || 'de nuevo');
  readonly iniciales = computed(() => inicialesDe(this.nombre()));

  constructor() {
    // Cuentas creadas antes de que existiera el tipo: se les pide una sola vez
    effect(() => {
      const perfil = this.perfil();
      if (perfil && !perfil.tipo) untracked(() => void this.completarTipo());
    });
    // Cuenta sin perfil (falló la escritura al registrarse): se crea aquí con el tipo que elija
    effect(() => {
      const user = this.usuario();
      if (user && this.perfil() === undefined) untracked(() => void this.repararPerfil(user));
    });
  }

  private reparando = false;

  private async repararPerfil(user: NonNullable<ReturnType<AuthService['user']>>) {
    if (this.reparando) return;
    this.reparando = true;
    try {
      // Se da tiempo a que llegue el perfil; si de verdad no existe, se pregunta el tipo y se crea
      await new Promise((r) => setTimeout(r, 4000));
      if (this.perfil() !== undefined || (await this.auth.perfilExiste()) !== false) return;
      const tipo = await pedirTipoCuenta(this.alertCtrl);
      if (!tipo) return;
      await this.auth.crearPerfil(user, user.displayName || user.email || '', tipo);
      await this.mostrar('Tu perfil se completó.', 'success');
    } catch (error) {
      console.error(error);
    } finally {
      this.reparando = false;
    }
  }

  tono(nombre: string): number {
    return tonoDe(nombre);
  }

  /** La familia entra a Hoy; el médico, a Seguimiento (PersonaPage lo manda ahí de todos modos). */
  abrir(p: PersonaCuidada) {
    if (!p.id) return;
    void this.router.navigate(this.esMedico() ? ['/personas', p.id, 'seguimiento'] : ['/personas', p.id]);
  }

  /** La ficha de emergencia (alergias, medicamentos, contactos), directo desde el inicio. */
  abrirFicha(p: PersonaCuidada, event: Event) {
    event.stopPropagation();
    if (p.id) void this.router.navigate(['/personas', p.id, 'ficha']);
  }

  /** El semáforo del día, directo desde el inicio (sin pasar por las pestañas). */
  abrirSemaforo(p: PersonaCuidada, event: Event) {
    event.stopPropagation();
    if (p.id) void this.router.navigate(['/personas', p.id, 'semaforo']);
  }

  /** El perfil vive en la esquina: nombre, notificaciones y cerrar sesión. */
  async menuPerfil() {
    const sheet = await this.actionSheetCtrl.create({
      header: this.nombre(),
      subHeader: this.usuario()?.email ?? undefined,
      buttons: [
        {
          text: 'Mi perfil',
          icon: 'person-circle-outline',
          handler: () => {
            void this.editarPerfil();
          },
        },
        {
          text: 'Notificaciones',
          icon: 'notifications-outline',
          handler: () => {
            void this.router.navigateByUrl('/notificaciones');
          },
        },
        {
          text: 'Cerrar sesión',
          icon: 'log-out-outline',
          role: 'destructive',
          handler: () => {
            void this.salir();
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
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
        ...data.ficha,
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
