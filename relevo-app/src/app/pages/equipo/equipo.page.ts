import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ActionSheetController,
  AlertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSkeletonText,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { combineLatest, of, switchMap } from 'rxjs';
import { Invitacion, Miembro, ROL_COLOR, ROL_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import {
  DIAS_CODIGO_PERMANENTE,
  InvitacionesService,
  USOS_CODIGO_PERMANENTE,
  formatearCodigo,
} from '../../core/services/invitaciones.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { PersonasService } from '../../core/services/personas.service';
import { edad, textoTurnos } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { CompartirModal } from './compartir.modal';
import { DatosAvisos, TurnosModal } from './turnos.modal';
import { DatosFicha } from './ficha-campos.component';
import { FichaModal } from './ficha.modal';
import { DatosPersona, PersonaModal } from '../home/persona.modal';
import { FabAsistente } from '../../shared/fab-asistente.component';

@Component({
  selector: 'app-equipo',
  imports: [
    FabAsistente,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonBadge,
    IonButton,
    IonIcon,
    IonNote,
    IonSkeletonText,
    IonSpinner,
    IonText,
  ],
  templateUrl: './equipo.page.html',
  styleUrl: './equipo.page.scss',
})
export class EquipoPage {
  private readonly auth = inject(AuthService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly invitacionesSvc = inject(InvitacionesService);
  private readonly personasSvc = inject(PersonasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly toast = inject(ToastController);
  private creandoCodigo = false;

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;
  readonly uid = this.auth.uid;
  readonly ROL_ETIQUETA = ROL_ETIQUETA;
  readonly ROL_COLOR = ROL_COLOR;
  readonly formatearCodigo = formatearCodigo;
  readonly textoTurnos = textoTurnos;

  readonly miembros = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.miembrosSvc.miembros(id))),
  );
  readonly esPrincipal = computed(() => this.rol() === 'cuidador_principal');
  readonly edad = computed(() => edad(this.persona()?.fechaNacimiento));
  /** Dio de alta a la persona con una versión anterior y quedó sin el rol de responsable */
  readonly puedeRecuperarResponsable = computed(
    () =>
      !!this.rol() &&
      !this.esPrincipal() &&
      this.persona()?.creadoPor === this.uid &&
      this.auth.tipoActual === 'familiar',
  );

  /** Invitaciones activas (solo el responsable puede listarlas; las rules lo garantizan). */
  readonly invitaciones = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.esPrincipal)]).pipe(
      switchMap(([id, principal]) =>
        principal ? this.invitacionesSvc.activas(id) : of([] as Invitacion[]),
      ),
    ),
  );

  /** El código que se muestra como QR permanente: la invitación activa más reciente. */
  readonly invitacionActual = computed(() => this.invitaciones()?.[0] ?? null);
  /** Otras invitaciones activas (p. ej. temporales creadas antes), por si se quieren cancelar. */
  readonly otrasInvitaciones = computed(() => this.invitaciones()?.slice(1) ?? []);
  readonly qr = signal<string | null>(null);

  constructor() {
    // Si el responsable no tiene ningún código activo, se genera uno de larga duración
    effect(() => {
      const lista = this.invitaciones();
      const persona = this.persona();
      if (this.esPrincipal() && persona && lista && lista.length === 0) {
        untracked(() => void this.crearCodigoPermanente());
      }
    });
    // Imagen del QR para el código actual
    effect(() => {
      const inv = this.invitacionActual();
      this.qr.set(null);
      if (inv) {
        untracked(() =>
          this.invitacionesSvc
            .qrDataUrl(inv.codigo)
            .then((src) => {
              if (this.invitacionActual()?.codigo === inv.codigo) this.qr.set(src);
            })
            .catch((e) => console.error('No se pudo generar el QR', e)),
        );
      }
    });
  }

  private async crearCodigoPermanente() {
    const persona = this.persona();
    if (!persona?.id || this.creandoCodigo) return;
    this.creandoCodigo = true;
    try {
      // La lista en tiempo real puede llegar vacía desde la caché local antes que del servidor;
      // se confirma con el servidor para no duplicar códigos.
      const existentes = await this.invitacionesSvc.activasEnServidor(persona.id);
      if (existentes.length > 0) return;
      await this.invitacionesSvc.crear(persona, DIAS_CODIGO_PERMANENTE, USOS_CODIGO_PERMANENTE);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo generar el código de acceso.', 'danger');
    } finally {
      this.creandoCodigo = false;
    }
  }

  /** Quien dio de alta a la persona recupera el rol de responsable (permitido por las rules). */
  async hacermeResponsable() {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.uid) return;
    try {
      await this.miembrosSvc.cambiarRol(personaId, this.uid, 'cuidador_principal');
      await this.aviso('Ahora eres responsable de esta persona.', 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cambiar el rol.', 'danger');
    }
  }

  /** Nuevo código; el anterior deja de funcionar. */
  /** El responsable corrige nombre, fecha de nacimiento y descripción. */
  async editarDatos() {
    const persona = this.persona();
    if (!persona?.id || !this.esPrincipal()) return;
    const modal = await this.modalCtrl.create({ component: PersonaModal, componentProps: { persona } });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosPersona>();
    if (role !== 'guardar' || !data) return;
    try {
      await this.personasSvc.actualizar(persona.id, data);
      await this.aviso('Datos actualizados.', 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudieron guardar los datos.', 'danger');
    }
  }

  async renovar(inv: Invitacion) {
    const alerta = await this.alertCtrl.create({
      header: '¿Generar un código nuevo?',
      message: `El código ${formatearCodigo(inv.codigo)} dejará de funcionar. Quienes ya se unieron no se ven afectados.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Generar nuevo', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    const persona = this.persona();
    if (!persona) return;
    try {
      this.creandoCodigo = true;
      await this.invitacionesSvc.crear(persona, DIAS_CODIGO_PERMANENTE, USOS_CODIGO_PERMANENTE);
      await this.invitacionesSvc.desactivar(inv.codigo);
      await this.aviso('Código renovado.', 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo renovar el código.', 'danger');
    } finally {
      this.creandoCodigo = false;
    }
  }

  async compartir(inv: Invitacion) {
    try {
      const resultado = await this.invitacionesSvc.compartir(inv);
      if (resultado === 'copiado') await this.aviso('Invitación copiada al portapapeles.', 'success');
    } catch {
      await this.aviso('No se pudo compartir en este dispositivo.', 'danger');
    }
  }

  async copiarCodigo(inv: Invitacion) {
    try {
      await navigator.clipboard.writeText(formatearCodigo(inv.codigo));
      await this.aviso('Código copiado.', 'success');
    } catch {
      await this.aviso('No se pudo copiar en este dispositivo.', 'danger');
    }
  }

  /** QR en grande, con botones de compartir. */
  async mostrarInvitacion(invitacion: Invitacion) {
    const modal = await this.modalCtrl.create({
      component: CompartirModal,
      componentProps: { invitacion },
    });
    await modal.present();
  }

  async revocar(inv: Invitacion) {
    const alerta = await this.alertCtrl.create({
      header: '¿Cancelar esta invitación?',
      message: `El código ${formatearCodigo(inv.codigo)} dejará de funcionar.`,
      buttons: [
        { text: 'No', role: 'cancel' },
        { text: 'Cancelar invitación', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.invitacionesSvc.desactivar(inv.codigo);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cancelar.', 'danger');
    }
  }

  /** Opciones sobre un miembro (solo el responsable): turnos, hacer/quitar responsable, quitar del equipo. */
  async opcionesMiembro(m: Miembro) {
    if (!this.esPrincipal()) return;
    const buttons: { text: string; icon?: string; role?: string; handler?: () => void }[] = [
      {
        text: 'Turnos y alertas',
        icon: 'time-outline',
        handler: () => {
          void this.editarTurnos(m);
        },
      },
    ];
    if (m.uid === this.uid) {
      buttons.push({ text: 'Cancelar', role: 'cancel' });
      const propio = await this.actionSheetCtrl.create({ header: `${m.nombre} (tú)`, buttons });
      await propio.present();
      return;
    }
    const tipo = await this.miembrosSvc.tipoDe(m.uid);

    if (tipo === 'familiar') {
      if (m.rol === 'cuidador_principal') {
        buttons.push({
          text: 'Quitar como responsable',
          icon: 'person-circle-outline',
          handler: () => {
            void this.cambiarRol(m, 'familiar');
          },
        });
      } else {
        buttons.push({
          text: 'Hacer responsable',
          icon: 'key-outline',
          handler: () => {
            void this.cambiarRol(m, 'cuidador_principal');
          },
        });
      }
    }
    buttons.push(
      {
        text: 'Quitar del equipo',
        icon: 'trash-outline',
        role: 'destructive',
        handler: () => {
          void this.quitar(m);
        },
      },
      { text: 'Cancelar', role: 'cancel' },
    );

    const sheet = await this.actionSheetCtrl.create({
      header: `${m.nombre} · ${ROL_ETIQUETA[m.rol]}`,
      buttons,
    });
    await sheet.present();
  }

  /** El responsable edita la ficha médica (tipo de sangre, alergias, condiciones, médico, contactos…). */
  async editarFicha() {
    const persona = this.persona();
    if (!persona?.id || !this.esPrincipal()) return;
    const modal = await this.modalCtrl.create({ component: FichaModal, componentProps: { persona } });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosFicha>();
    if (role !== 'guardar' || !data) return;
    try {
      await this.personasSvc.actualizar(persona.id, data);
      await this.aviso('Ficha médica actualizada.', 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar la ficha médica.', 'danger');
    }
  }

  /** El responsable define cuándo está de guardia cada miembro y si recibe alertas fuera de turno. */
  async editarTurnos(m: Miembro) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    const modal = await this.modalCtrl.create({ component: TurnosModal, componentProps: { miembro: m } });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosAvisos>();
    if (role !== 'guardar' || !data) return;
    try {
      await this.miembrosSvc.actualizarAvisos(personaId, m.uid, data);
      await this.aviso(`Turnos de ${m.nombre} guardados.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudieron guardar los turnos.', 'danger');
    }
  }

  private async cambiarRol(m: Miembro, rol: Miembro['rol']) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      await this.miembrosSvc.cambiarRol(personaId, m.uid, rol);
      await this.aviso(`${m.nombre} ahora es ${ROL_ETIQUETA[rol].toLowerCase()}.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cambiar el rol.', 'danger');
    }
  }

  private async quitar(m: Miembro) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Quitar a ${m.nombre}?`,
      message: 'Dejará de ver la bitácora de inmediato.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Quitar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.miembrosSvc.quitar(personaId, m.uid);
      await this.aviso(`${m.nombre} ya no forma parte del equipo.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo quitar al miembro.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
