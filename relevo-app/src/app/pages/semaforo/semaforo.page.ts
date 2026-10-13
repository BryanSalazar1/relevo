import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { IonButton, IonContent, IonIcon, IonSpinner, ToastController } from '@ionic/angular';
import { combineLatest, distinctUntilChanged, map, switchMap } from 'rxjs';
import {
  PUEDE_EDITAR_MEDICAMENTOS,
  PUEDE_REGISTRAR_TAREAS,
  PUEDE_REGISTRAR_TOMAS,
} from '../../core/models';
import { MedicamentosService } from '../../core/services/medicamentos.service';
import { TareasService } from '../../core/services/tareas.service';
import {
  FilaDia,
  avanceDia,
  filasDelDia,
  pendientesDelDia,
  textoCuando,
  tituloEstado,
} from '../../core/utils/agenda-dia';
import { claveDia, inicioDeDia } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { FaseSemaforo, estadoSemaforo } from '../../core/utils/semaforo';
import { MarcarTomaService } from '../medicamentos/marcar-toma.service';
import { MarcarTareaService } from '../rutina/marcar-tarea.service';

/** Cada cuánto se vuelve a calcular el semáforo (ms). */
const REFRESCO_MS = 15_000;
/** Cuántos pendientes se listan debajo del principal. */
const MAX_DESPUES = 4;
/** Tras tocar la pantalla, cuánto siguen a la vista los botones y la lista antes de volver al vistazo (ms). */
const DETALLES_MS = 30_000;

/**
 * Semáforo: lo que sigue hoy (tomas y rutina) en pantalla completa y con un solo color, para verlo
 * de lejos con el teléfono apoyado. Mantiene la pantalla encendida mientras está abierto.
 * Por defecto es solo un vistazo (luces, estado y qué toca); al tocar la pantalla aparecen los
 * botones para marcar y la lista de lo que sigue, y se esconden solos al rato.
 * Los pendientes salen de la misma agenda del día que la pestaña Hoy (core/utils/agenda-dia.ts).
 */
@Component({
  selector: 'app-semaforo',
  imports: [DatePipe, IonContent, IonButton, IonIcon, IonSpinner],
  templateUrl: './semaforo.page.html',
  styleUrl: './semaforo.page.scss',
})
export class SemaforoPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly tareasSvc = inject(TareasService);
  private readonly marcarToma = inject(MarcarTomaService);
  private readonly marcarTarea = inject(MarcarTareaService);
  private readonly toast = inject(ToastController);
  private readonly router = inject(Router);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  /** Reloj del semáforo: todo se recalcula con él */
  readonly ahora = signal(new Date());
  readonly guardando = signal(false);
  /** Botones y lista a la vista (se tocó la pantalla); si no, solo el vistazo */
  readonly detalles = signal(false);
  private ocultarDetalles?: ReturnType<typeof setTimeout>;

  /** Cambia solo a medianoche, para pasar a la agenda del día siguiente */
  private readonly dia$ = toObservable(this.ahora).pipe(
    map((d) => claveDia(d)),
    distinctUntilChanged(),
    map(() => inicioDeDia(new Date())),
  );

  private readonly dosis = toSignal(
    combineLatest([this.ctx.personaId$, this.dia$]).pipe(
      switchMap(([id, dia]) => this.medsSvc.agendaDelDia(id, dia)),
    ),
  );
  private readonly tareas = toSignal(
    combineLatest([this.ctx.personaId$, this.dia$]).pipe(
      switchMap(([id, dia]) => this.tareasSvc.agendaDelDia(id, dia)),
    ),
  );

  readonly cargando = computed(() => this.dosis() === undefined || this.tareas() === undefined);

  private readonly filas = computed(() => filasDelDia(this.dosis() ?? [], this.tareas() ?? []));
  /** Avance del día: cuánto de lo programado ya tiene registro. */
  readonly avance = computed(() => avanceDia(this.filas()));
  readonly estado = computed(() => estadoSemaforo(pendientesDelDia(this.filas()), this.ahora()));
  readonly despues = computed(() => this.estado().resto.slice(0, MAX_DESPUES));
  readonly masDespues = computed(() => Math.max(0, this.estado().resto.length - MAX_DESPUES));

  /** "Atrasado", "Es hora", "Ya casi" o "Todo al día". */
  readonly titulo = computed(() => tituloEstado(this.estado()));
  /** "Era a las 08:00 · hace 35 min", "A las 14:00 · en 10 min"… */
  readonly cuando = computed(() => textoCuando(this.estado(), this.ahora()));

  /** Sobre el amarillo el texto va oscuro; sobre verde y rojo, claro. */
  readonly colorBoton = computed(() => (this.estado().color === 'amarillo' ? 'dark' : 'light'));

  /** Qué ofrece el toque: marcar lo que toca (si su rol puede) o solo ver lo que sigue. */
  readonly pista = computed(() => {
    const e = this.estado();
    const marcar = !!e.principal && e.fase !== 'despues' && this.puedeMarcar(e.principal);
    if (marcar) return 'Toca la pantalla para marcar';
    return e.resto.length > 0 ? 'Toca la pantalla para ver lo que sigue' : '';
  });

  readonly etiquetaFase: Record<FaseSemaforo, string> = {
    atrasado: 'atrasado',
    ahora: 'es hora',
    pronto: 'ya casi',
    despues: '',
  };

  constructor() {
    const reloj = setInterval(() => this.ahora.set(new Date()), REFRESCO_MS);
    // Al volver a la pestaña el navegador suelta el bloqueo de pantalla: se pide otra vez
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      this.ahora.set(new Date());
      void this.pantallaEncendida(true);
    };
    document.addEventListener('visibilitychange', alVolver);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      clearTimeout(this.ocultarDetalles);
      document.removeEventListener('visibilitychange', alVolver);
      void this.pantallaEncendida(false);
    });
  }

  ionViewDidEnter() {
    this.ahora.set(new Date());
    void this.pantallaEncendida(true);
  }

  ionViewWillLeave() {
    void this.pantallaEncendida(false);
    this.verDetalles(false);
  }

  /** Tocar la pantalla alterna entre el vistazo y los detalles (botones para marcar y lo que sigue). */
  alternarDetalles() {
    this.verDetalles(!this.detalles());
  }

  private verDetalles(ver: boolean) {
    clearTimeout(this.ocultarDetalles);
    this.detalles.set(ver);
    if (ver) this.ocultarDetalles = setTimeout(() => this.detalles.set(false), DETALLES_MS);
  }

  /** Puede marcar el pendiente según su rol (tomas y tareas tienen permisos distintos). */
  puedeMarcar(p: FilaDia): boolean {
    const r = this.rol();
    if (!r) return false;
    return (p.tipo === 'toma' ? PUEDE_REGISTRAR_TOMAS : PUEDE_REGISTRAR_TAREAS).includes(r);
  }

  textoSi(p: FilaDia): string {
    return p.tipo === 'toma' ? 'Tomada' : 'Hecha';
  }

  textoNo(p: FilaDia): string {
    return p.tipo === 'toma' ? 'No tomada' : 'No hecha';
  }

  /** Marca el pendiente desde el semáforo, con la misma confirmación y nota opcional que en Hoy. */
  async marcar(p: FilaDia, hecho: boolean) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeMarcar(p) || this.guardando()) return;
    // Con el cuadro de confirmación abierto los botones no deben esconderse
    clearTimeout(this.ocultarDetalles);
    this.guardando.set(true);
    try {
      if (p.tipo === 'tarea') {
        // Misma confirmación que en Hoy (y la captura de mediciones si es de signos vitales)
        if (!(await this.marcarTarea.marcar(personaId, p.programada, hecho ? 'hecha' : 'omitida'))) return;
      } else {
        const r = this.rol();
        const puedeResurtir = !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
        if (!(await this.marcarToma.marcar(personaId, p.dosis, hecho ? 'tomada' : 'omitida', { puedeResurtir }))) return;
      }
      this.ahora.set(new Date());
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      this.guardando.set(false);
      // Si quedan más atrasados se marcan seguidos; si no, vuelve solo al vistazo
      this.verDetalles(true);
    }
  }

  salir() {
    const id = this.ctx.personaId();
    void this.router.navigate(id ? ['/personas', id] : ['/home']);
  }

  /** Mantiene la pantalla encendida (o la suelta). Si el dispositivo no lo permite, el semáforo sigue funcionando. */
  private async pantallaEncendida(encendida: boolean) {
    try {
      if (encendida) await KeepAwake.keepAwake();
      else await KeepAwake.allowSleep();
    } catch {
      // Sin soporte (navegador antiguo, ahorro de batería): no es un error para quien lo usa
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, color: 'danger', duration: 5000, position: 'top' });
    await t.present();
  }
}
