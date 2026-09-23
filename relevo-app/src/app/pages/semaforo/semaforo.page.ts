import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { KeepAwake } from '@capacitor-community/keep-awake';
import {
  AlertController,
  IonButton,
  IonContent,
  IonIcon,
  IonSpinner,
  ToastController,
} from '@ionic/angular';
import { combineLatest, distinctUntilChanged, map, switchMap } from 'rxjs';
import { PUEDE_REGISTRAR_TAREAS, PUEDE_REGISTRAR_TOMAS, TIPO_TAREA_INFO } from '../../core/models';
import {
  DosisProgramada,
  MedicamentosService,
  agotado,
} from '../../core/services/medicamentos.service';
import { TareaProgramada, TareasService } from '../../core/services/tareas.service';
import { claveDia, horaFin, inicioDeDia } from '../../core/utils/fechas';
import { pedirNota } from '../../core/utils/notas';
import { personaActual } from '../../core/utils/persona-actual';
import { MarcarTareaService } from '../rutina/marcar-tarea.service';
import {
  FaseSemaforo,
  PendienteSemaforo,
  cuandoEs,
  estadoSemaforo,
} from '../../core/utils/semaforo';

/** Cada cuánto se vuelve a calcular el semáforo (ms). */
const REFRESCO_MS = 15_000;
/** Cuántos pendientes se listan debajo del principal. */
const MAX_DESPUES = 4;
/** Tras tocar la pantalla, cuánto siguen a la vista los botones y la lista antes de volver al vistazo (ms). */
const DETALLES_MS = 30_000;

/** Un pendiente de hoy (toma o tarea sin registro) listo para pintarse. */
type Pendiente = PendienteSemaforo & {
  clave: string;
  titulo: string;
  detalle: string;
  icono: string;
  horario: string;
} & ({ tipo: 'toma'; dosis: DosisProgramada } | { tipo: 'tarea'; programada: TareaProgramada });

const TITULO_FASE: Record<FaseSemaforo, string> = {
  atrasado: 'Atrasado',
  ahora: 'Es hora',
  pronto: 'Ya casi',
  despues: 'Todo al día',
};

/**
 * Semáforo: lo que sigue hoy (tomas y rutina) en pantalla completa y con un solo color, para verlo
 * de lejos con el teléfono apoyado. Mantiene la pantalla encendida mientras está abierto.
 * Por defecto es solo un vistazo (luces, estado y qué toca); al tocar la pantalla aparecen los
 * botones para marcar y la lista de lo que sigue, y se esconden solos al rato.
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
  private readonly marcarSvc = inject(MarcarTareaService);
  private readonly alertCtrl = inject(AlertController);
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

  /** Avance del día: cuánto de lo programado ya tiene registro. */
  readonly avance = computed(() => {
    const dosis = (this.dosis() ?? []).filter((d) => !d.aDemanda);
    const tareas = this.tareas() ?? [];
    return {
      total: dosis.length + tareas.length,
      registradas: dosis.filter((d) => d.toma).length + tareas.filter((t) => t.registro).length,
    };
  });

  private readonly pendientes = computed<Pendiente[]>(() => [
    ...(this.dosis() ?? [])
      .filter((d) => !d.toma && !d.aDemanda)
      .map(
        (d): Pendiente => ({
          tipo: 'toma',
          dosis: d,
          clave: `toma-${d.medicamento.id}-${d.idToma}`,
          titulo: d.medicamento.nombre,
          detalle: [d.medicamento.dosis, d.medicamento.notas].filter(Boolean).join(' · '),
          icono: 'medkit-outline',
          horario: `a las ${d.horario}`,
          hora: d.hora,
        }),
      ),
    ...(this.tareas() ?? [])
      .filter((t) => !t.registro)
      .map((t): Pendiente => {
        const info = TIPO_TAREA_INFO[t.tarea.tipo] ?? TIPO_TAREA_INFO['otro'];
        const dura = t.tarea.duracionMin && t.tarea.duracionMin > 0 ? t.tarea.duracionMin : null;
        return {
          tipo: 'tarea',
          programada: t,
          clave: `tarea-${t.tarea.id}-${t.idRegistro}`,
          titulo: t.tarea.nombre,
          detalle: [info.etiqueta, t.tarea.notas].filter(Boolean).join(' · '),
          icono: info.icono,
          horario: dura
            ? `de ${t.horario} a ${horaFin(t.horario, dura)}`
            : `a las ${t.horario}`,
          hora: t.hora,
          duracionMin: dura,
          avisarMin: t.tarea.avisarMin,
        };
      }),
  ]);

  readonly estado = computed(() => estadoSemaforo(this.pendientes(), this.ahora()));
  readonly despues = computed(() => this.estado().resto.slice(0, MAX_DESPUES));
  readonly masDespues = computed(() => Math.max(0, this.estado().resto.length - MAX_DESPUES));

  /** "Atrasado", "Es hora", "Ya casi" o "Todo al día". */
  readonly titulo = computed(() => {
    const e = this.estado();
    if (e.atrasados > 1) return `${e.atrasados} atrasados`;
    return TITULO_FASE[e.fase ?? 'despues'];
  });

  /** "Era a las 08:00 · hace 35 min", "A las 14:00 · en 10 min"… */
  readonly cuando = computed(() => {
    const e = this.estado();
    const p = e.principal;
    if (!p) return '';
    const horario = e.fase === 'atrasado' ? `Era ${p.horario}` : this.mayuscula(p.horario);
    const falta = cuandoEs(p.hora, this.ahora());
    return falta === 'ahora' ? horario : `${horario} · ${falta}`;
  });

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
  puedeMarcar(p: Pendiente): boolean {
    const r = this.rol();
    if (!r) return false;
    return (p.tipo === 'toma' ? PUEDE_REGISTRAR_TOMAS : PUEDE_REGISTRAR_TAREAS).includes(r);
  }

  textoSi(p: Pendiente): string {
    return p.tipo === 'toma' ? 'Tomada' : 'Hecha';
  }

  textoNo(p: Pendiente): string {
    return p.tipo === 'toma' ? 'No tomada' : 'No hecha';
  }

  /** Marca el pendiente desde el semáforo, con la misma confirmación y nota opcional del resto de la app. */
  async marcar(p: Pendiente, hecho: boolean) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeMarcar(p) || this.guardando()) return;
    // Con el cuadro de confirmación abierto los botones no deben esconderse
    clearTimeout(this.ocultarDetalles);
    this.guardando.set(true);
    try {
      if (p.tipo === 'tarea') {
        // Misma confirmación que en Rutina (y la captura de mediciones si es de signos vitales)
        const estado = hecho ? 'hecha' : 'omitida';
        if (!(await this.marcarSvc.marcar(personaId, p.programada, estado))) return;
      } else {
        const sinUnidades = hecho && agotado(p.dosis.medicamento);
        const r = await pedirNota(this.alertCtrl, {
          header: `¿Marcar como ${(hecho ? this.textoSi(p) : this.textoNo(p)).toLowerCase()}?`,
          message: [
            `${p.titulo} · ${p.horario}.`,
            sinUnidades ? 'El inventario está en 0: la toma se registra sin descontar.' : '',
          ]
            .filter(Boolean)
            .join(' '),
          confirmar: 'Marcar',
        });
        if (!r.ok) return;
        await this.medsSvc.registrarToma(personaId, p.dosis, hecho ? 'tomada' : 'omitida', r.nota);
        if (sinUnidades) {
          await this.aviso(
            `Toma registrada. ${p.titulo} está en 0 unidades: hay que resurtirlo.`,
            'warning',
          );
        }
      }
      this.ahora.set(new Date());
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar. Revisa tu conexión e inténtalo de nuevo.', 'danger');
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

  private mayuscula(texto: string): string {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  private async aviso(message: string, color: 'warning' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 5000, position: 'top' });
    await t.present();
  }
}
