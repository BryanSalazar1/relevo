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
  IonSegment,
  IonSegmentButton,
  IonSkeletonText,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Router, RouterLink } from '@angular/router';
import { combineLatest, of, switchMap } from 'rxjs';
import {
  Invitacion,
  Miembro,
  ROL_COLOR,
  ROL_ETIQUETA,
  ROLES,
  ROLES_INVITABLES,
  ROLES_PAUSABLES,
  Rol,
  RolInvitable,
} from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import {
  DIAS_CODIGO_PERMANENTE,
  InvitacionesService,
  USOS_CODIGO_PERMANENTE,
  formatearCodigo,
} from '../../core/services/invitaciones.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { PersonasService } from '../../core/services/personas.service';
import { edad } from '../../core/utils/fechas';
import { resumenCobertura, textoTurnos, turnosQueCubren } from '../../core/utils/turnos';
import { confirmar } from '../../core/utils/notas';
import { personaActual } from '../../core/utils/persona-actual';
import { CompartirModal } from './compartir.modal';
import { DatosTurnos, TurnosModal } from './turnos.modal';
import { DatosFicha } from './ficha-campos.component';
import { FichaModal } from './ficha.modal';
import { DatosPersona, PersonaModal } from '../home/persona.modal';
import { FabAsistente } from '../../shared/fab-asistente.component';

@Component({
  selector: 'app-equipo',
  imports: [
    RouterLink,
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
    IonSegment,
    IonSegmentButton,
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
  private readonly loadingCtrl = inject(LoadingController);
  private readonly router = inject(Router);
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

  /** Quién registra: el enfermero/a solo en su turno (sin turnos, nada); el familiar, con permiso */
  textoRegistro(m: Miembro): { texto: string; alerta: boolean } | null {
    if (m.rol === 'cuidador_turno') {
      return m.turnos?.length
        ? { texto: 'Registra solo en su turno (y 30 min después)', alerta: false }
        : { texto: 'Sin turnos: no puede registrar', alerta: true };
    }
    if (m.rol === 'familiar') {
      return m.puedeRegistrar
        ? { texto: 'Puede registrar', alerta: false }
        : { texto: 'Solo ve; registrar requiere tu permiso', alerta: false };
    }
    return null;
  }

  readonly miembros = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.miembrosSvc.miembros(id))),
  );
  readonly esPrincipal = computed(() => this.rol() === 'cuidador_principal');
  readonly edad = computed(() => edad(this.persona()?.fechaNacimiento));
  /** Horas de la semana sin nadie de guardia (null si nadie tiene turnos) */
  readonly cobertura = computed(() => resumenCobertura(turnosQueCubren(this.miembros() ?? [])));

  /** Invitaciones activas (solo el responsable puede listarlas; las rules lo garantizan). */
  readonly invitaciones = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.esPrincipal)]).pipe(
      switchMap(([id, principal]) =>
        principal ? this.invitacionesSvc.activas(id) : of([] as Invitacion[]),
      ),
    ),
  );

  /** A quién se invita con el QR: el rol es por persona y lo decide aquí el responsable */
  readonly rolInvitar = signal<RolInvitable>('familiar');
  readonly rolesInvitables = ROLES_INVITABLES;
  readonly ROLES = ROLES;
  /** El código que se muestra como QR permanente: la invitación activa más reciente de ese rol. */
  readonly invitacionActual = computed(
    () => this.invitaciones()?.find((i) => i.rol === this.rolInvitar()) ?? null,
  );
  /** Otras invitaciones activas (de otros roles o anteriores sin rol), por si se quieren cancelar. */
  readonly otrasInvitaciones = computed(() =>
    (this.invitaciones() ?? []).filter((i) => i.codigo !== this.invitacionActual()?.codigo),
  );

  /** "Entra como enfermero/a" (o según su tipo de cuenta, en invitaciones anteriores sin rol) */
  entraComo(inv: Invitacion): string {
    return inv.rol ? `Entra como ${ROL_ETIQUETA[inv.rol].toLowerCase()}` : 'Entra según su tipo de cuenta';
  }

  cambiarRolInvitar(valor: unknown) {
    if (ROLES_INVITABLES.includes(valor as RolInvitable)) this.rolInvitar.set(valor as RolInvitable);
  }
  readonly qr = signal<string | null>(null);

  constructor() {
    // Si el responsable no tiene un código activo para el rol elegido, se genera uno de larga duración
    effect(() => {
      const lista = this.invitaciones();
      const persona = this.persona();
      const rol = this.rolInvitar();
      if (this.esPrincipal() && persona && lista && !lista.some((i) => i.rol === rol)) {
        untracked(() => void this.crearCodigoPermanente(rol));
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

  /** No se pudo generar el código (sin conexión): se ofrece reintentar en vez de girar sin fin */
  readonly errorCodigo = signal(false);

  reintentarCodigo() {
    void this.crearCodigoPermanente(this.rolInvitar());
  }

  private async crearCodigoPermanente(rol: RolInvitable) {
    const persona = this.persona();
    if (!persona?.id || this.creandoCodigo) return;
    this.creandoCodigo = true;
    this.errorCodigo.set(false);
    try {
      // La lista en tiempo real puede llegar vacía desde la caché local antes que del servidor;
      // se confirma con el servidor para no duplicar códigos.
      const existentes = await this.invitacionesSvc.activasEnServidor(persona.id);
      if (existentes.some((i) => i.rol === rol)) return;
      await this.invitacionesSvc.crear(persona, rol, DIAS_CODIGO_PERMANENTE, USOS_CODIGO_PERMANENTE);
    } catch (error) {
      console.error(error);
      this.errorCodigo.set(true);
    } finally {
      this.creandoCodigo = false;
    }
  }

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
      await this.invitacionesSvc.crear(
        persona,
        inv.rol ?? this.rolInvitar(),
        DIAS_CODIGO_PERMANENTE,
        USOS_CODIGO_PERMANENTE,
      );
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

  /** Hay otro responsable además de mí: solo entonces puedo dejar el rol (nadie queda sin administrar). */
  readonly hayOtroResponsable = computed(() =>
    (this.miembros() ?? []).some((m) => m.rol === 'cuidador_principal' && m.uid !== this.uid),
  );

  /** La fila tiene opciones: para el responsable, la de los demás; la propia, si puede dejar el rol. */
  tieneOpciones(m: Miembro): boolean {
    return this.esPrincipal() && (m.uid !== this.uid || this.hayOtroResponsable());
  }

  /** Opciones sobre un miembro (solo el responsable): cambiar su rol, turnos, pausa, quitarlo. */
  async opcionesMiembro(m: Miembro) {
    if (!this.tieneOpciones(m)) return;
    const buttons: { text: string; icon?: string; role?: string; handler?: () => void }[] = [];
    if (m.uid === this.uid) {
      // Con otro responsable en el equipo, puede ceder el rol y después salir como familiar
      buttons.push(
        {
          text: 'Dejar de ser responsable',
          icon: 'person-circle-outline',
          handler: () => {
            void this.dejarDeSerResponsable(m);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      );
      const propio = await this.actionSheetCtrl.create({ header: `${m.nombre} (tú)`, buttons });
      await propio.present();
      return;
    }
    // El rol es por persona cuidada: el responsable le da a cualquiera el rol que tiene aquí
    buttons.push({
      text: 'Cambiar rol',
      icon: 'swap-horizontal-outline',
      handler: () => {
        void this.elegirRol(m);
      },
    });
    if (m.rol === 'familiar') {
      buttons.push({
        text: m.puedeRegistrar ? 'Quitar permiso de registrar' : 'Permitir registrar',
        icon: m.puedeRegistrar ? 'lock-closed-outline' : 'create-outline',
        handler: () => {
          void this.permitirRegistrar(m, !m.puedeRegistrar);
        },
      });
    }
    if (ROLES_PAUSABLES.includes(m.rol)) {
      buttons.push(
        m.pausado
          ? {
              text: 'Reactivar',
              icon: 'play-circle-outline',
              handler: () => {
                void this.reactivar(m);
              },
            }
          : {
              text: 'Pausar por un tiempo',
              icon: 'pause-circle-outline',
              handler: () => {
                void this.pausar(m);
              },
            },
      );
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

  /**
   * Pausa a un enfermero o familiar que no podrá venir un tiempo: sigue en el equipo y ve todo, pero no
   * registra ni recibe recordatorios o avisos. Se reactiva cuando vuelva, sin invitarlo de nuevo.
   */
  private async pausar(m: Miembro) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Pausar a ${m.nombre}?`,
      message:
        'Mientras esté en pausa puede ver la información, pero no registrar nada, y no le llegan recordatorios ni avisos. Puedes reactivarlo cuando quieras.',
      inputs: [{ name: 'motivo', type: 'text', placeholder: 'Motivo (opcional): de vacaciones hasta el 20', attributes: { maxlength: 120 } }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Pausar', role: 'confirm' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{ values: { motivo?: string } }>();
    if (role !== 'confirm') return;
    try {
      await this.miembrosSvc.pausar(personaId, m.uid, data?.values?.motivo ?? '');
      await this.aviso(`${m.nombre} quedó en pausa.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo poner en pausa.', 'danger');
    }
  }

  /** Familiar: registrar (tomas, tareas, bitácora y signos) solo con permiso del responsable */
  private async permitirRegistrar(m: Miembro, permitir: boolean) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      await this.miembrosSvc.permitirRegistrar(personaId, m.uid, permitir);
      await this.aviso(
        permitir ? `${m.nombre} ya puede registrar.` : `${m.nombre} ya no puede registrar; sigue viendo todo.`,
        'success',
      );
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo cambiar el permiso.', 'danger');
    }
  }

  private async reactivar(m: Miembro) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      await this.miembrosSvc.reactivar(personaId, m.uid);
      await this.aviso(`${m.nombre} está activo otra vez.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo reactivar.', 'danger');
    }
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

  /** El responsable define cuándo está de guardia cada miembro. */
  async editarTurnos(m: Miembro) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    const modal = await this.modalCtrl.create({
      component: TurnosModal,
      componentProps: { miembro: m, equipo: this.miembros() ?? [] },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosTurnos>();
    if (role !== 'guardar' || !data) return;
    try {
      await this.miembrosSvc.actualizarTurnos(personaId, m.uid, data.turnos);
      await this.aviso(`Turnos de ${m.nombre} guardados.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudieron guardar los turnos.', 'danger');
    }
  }

  /** Ceder el rol: queda como familiar (puede salir del equipo después). */
  private async dejarDeSerResponsable(m: Miembro) {
    if (!this.hayOtroResponsable()) return;
    const ok = await confirmar(this.alertCtrl, {
      header: '¿Dejar de ser responsable?',
      message:
        'Quedarás como familiar: ya no podrás editar medicamentos, rutina ni el equipo. Otro responsable puede devolverte el rol.',
      confirmar: 'Dejar el rol',
    });
    if (ok) await this.cambiarRol(m, 'familiar');
  }

  /** Elegir el rol nuevo de un miembro; a alguien en pausa no se le hace responsable (las rules tampoco). */
  private async elegirRol(m: Miembro) {
    const opciones = ROLES.filter((r) => r.valor !== m.rol && !(m.pausado && r.valor === 'cuidador_principal'));
    const sheet = await this.actionSheetCtrl.create({
      header: `Rol de ${m.nombre} con ${this.persona()?.nombre ?? 'esta persona'}`,
      subHeader: `Ahora: ${ROL_ETIQUETA[m.rol]}. Su rol con otras personas no cambia.`,
      buttons: [
        ...opciones.map((r) => ({
          text: r.etiqueta,
          handler: () => {
            void this.confirmarRol(m, r.valor);
          },
        })),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async confirmarRol(m: Miembro, rol: Rol) {
    const descripcion = ROLES.find((r) => r.valor === rol)?.descripcion ?? '';
    const ok = await confirmar(this.alertCtrl, {
      header: `¿${m.nombre} será ${ROL_ETIQUETA[rol].toLowerCase()}?`,
      message: `${descripcion}.`,
      confirmar: 'Cambiar rol',
    });
    if (ok) await this.cambiarRol(m, rol);
  }

  private async cambiarRol(m: Miembro, rol: Miembro['rol']) {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      await this.miembrosSvc.cambiarRol(personaId, m.uid, rol, m.turnos);
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

  /** El responsable elimina a la persona con todo su historial (Cloud Function eliminarPersona). */
  async eliminarPersona() {
    const persona = this.persona();
    if (!persona?.id || !this.esPrincipal()) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Eliminar a ${persona.nombre}?`,
      message:
        'Se borran su bitácora, medicamentos, citas y todo el historial para todo el equipo. No se puede deshacer. Escribe su nombre para confirmar.',
      inputs: [{ name: 'nombre', type: 'text', placeholder: persona.nombre }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{ values: { nombre?: string } }>();
    if (role !== 'destructive') return;
    const escrito = (data?.values?.nombre ?? '').trim().toLowerCase();
    if (escrito !== persona.nombre.trim().toLowerCase()) {
      await this.aviso('El nombre no coincide; no se eliminó nada.', 'danger');
      return;
    }
    const loading = await this.loadingCtrl.create({ message: 'Eliminando…' });
    await loading.present();
    try {
      await this.personasSvc.eliminar(persona.id);
      await loading.dismiss();
      await this.router.navigateByUrl('/home', { replaceUrl: true });
      await this.aviso(`${persona.nombre} se eliminó de Relevo.`, 'success');
    } catch (error) {
      console.error(error);
      await loading.dismiss();
      await this.aviso('No se pudo eliminar a la persona.', 'danger');
    }
  }

  /** Un miembro (no el responsable) deja el equipo por su cuenta. */
  async salirDelEquipo() {
    const persona = this.persona();
    if (!persona?.id || this.esPrincipal()) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Salir del equipo de ${persona.nombre}?`,
      message: 'Dejarás de ver su bitácora y de recibir avisos. El responsable puede volver a invitarte.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Salir', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.miembrosSvc.salir(persona.id);
      await this.router.navigateByUrl('/home', { replaceUrl: true });
      await this.aviso(`Saliste del equipo de ${persona.nombre}.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo salir del equipo.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
