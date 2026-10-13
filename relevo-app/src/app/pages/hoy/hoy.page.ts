import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { combineLatest, switchMap } from 'rxjs';
import {
  Medicamento,
  PUEDE_EDITAR_MEDICAMENTOS,
  PUEDE_REGISTRAR_TAREAS,
  PUEDE_REGISTRAR_TOMAS,
} from '../../core/models';
import {
  EstadoInventario,
  MedicamentosService,
  estadoInventario,
  textoInventario,
  vigenteEnDia,
} from '../../core/services/medicamentos.service';
import { TareasService } from '../../core/services/tareas.service';
import {
  DIAS_ATRAS_MAX,
  FilaDia,
  avanceDia,
  filasDelDia,
  pendientesDelDia,
  textoCuando,
  tituloEstado,
} from '../../core/utils/agenda-dia';
import { claveDia, etiquetaDia, inicioDeDia, sumarDias } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { estadoSemaforo } from '../../core/utils/semaforo';
import { FabAsistente } from '../../shared/fab-asistente.component';
import { MarcarTomaService } from '../medicamentos/marcar-toma.service';
import { ResurtirService } from '../medicamentos/resurtir.service';
import { MarcarTareaService } from '../rutina/marcar-tarea.service';

/** Cada cuánto se vuelve a calcular el estado del día (ms). */
const REFRESCO_MS = 30_000;

/**
 * Hoy: lo que toca en el día, en una sola lista cronológica (tomas de medicamentos y tareas de la
 * rutina) con botones para marcar, el estado del semáforo arriba, las tomas según necesidad y el
 * aviso de inventario por resurtir. Es la primera pestaña de cada persona.
 */
@Component({
  selector: 'app-hoy',
  imports: [
    DatePipe,
    RouterLink,
    FabAsistente,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonContent,
    IonCard,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonSpinner,
    IonText,
  ],
  templateUrl: './hoy.page.html',
  styleUrl: './hoy.page.scss',
})
export class HoyPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly tareasSvc = inject(TareasService);
  private readonly marcarToma = inject(MarcarTomaService);
  private readonly marcarTarea = inject(MarcarTareaService);
  private readonly resurtirSvc = inject(ResurtirService);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  /** Día que se muestra (por defecto hoy) */
  readonly dia = signal<Date>(inicioDeDia(new Date()));
  readonly esHoy = computed(() => claveDia(this.dia()) === claveDia(this.ahora()));
  readonly etiquetaDia = etiquetaDia;
  readonly textoInventario = textoInventario;
  /** Hasta cuántos días atrás se puede ver (lo anterior está en el reporte) */
  readonly puedeRetroceder = computed(
    () => claveDia(this.dia()) > claveDia(sumarDias(inicioDeDia(new Date()), -DIAS_ATRAS_MAX)),
  );

  /** Reloj: el estado del semáforo y los iconos de "ya pasó" se recalculan con él */
  readonly ahora = signal(new Date());
  /** Hay una confirmación abierta o guardándose: evita registrar dos veces con dos toques */
  private marcando = false;

  readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );
  private readonly dosis = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.dia)]).pipe(
      switchMap(([id, dia]) => this.medsSvc.agendaDelDia(id, dia)),
    ),
  );
  private readonly tareas = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.dia)]).pipe(
      switchMap(([id, dia]) => this.tareasSvc.agendaDelDia(id, dia)),
    ),
  );
  /** Última toma de cada medicamento según necesidad (id → toma) */
  private readonly ultimas = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.ultimasTomasSegunNecesidad(id))),
  );

  readonly cargando = computed(() => this.dosis() === undefined || this.tareas() === undefined);
  readonly filas = computed(() => filasDelDia(this.dosis() ?? [], this.tareas() ?? []));
  readonly avance = computed(() => avanceDia(this.filas()));
  /** Estado del semáforo de hoy (en otros días no se muestra) */
  readonly estado = computed(() => estadoSemaforo(pendientesDelDia(this.filas()), this.ahora()));
  readonly titulo = computed(() => tituloEstado(this.estado()));
  readonly cuando = computed(() => textoCuando(this.estado(), this.ahora()));

  /** Medicamentos sin horario fijo (solo hoy: se registran en el momento). */
  readonly segunNecesidad = computed(() =>
    this.esHoy()
      ? (this.medicamentos() ?? []).filter(
          (m) => m.segunNecesidad && m.activo !== false && vigenteEnDia(m, this.ahora()),
        )
      : [],
  );

  /** Medicamentos que se están acabando o ya se agotaron: primero los agotados, luego por nombre. */
  readonly porResurtir = computed(() =>
    (this.medicamentos() ?? [])
      .map((m) => ({ m, estado: estadoInventario(m) }))
      .filter((x): x is { m: Medicamento; estado: EstadoInventario } => !!x.estado && x.estado.nivel !== 'ok')
      .sort(
        (a, b) =>
          Number(b.estado.nivel === 'agotado') - Number(a.estado.nivel === 'agotado') ||
          a.m.nombre.localeCompare(b.m.nombre),
      ),
  );
  readonly hayAgotados = computed(() => this.porResurtir().some((x) => x.estado.nivel === 'agotado'));

  readonly puedeRegistrarTomas = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_REGISTRAR_TOMAS.includes(r);
  });
  readonly puedeRegistrarTareas = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_REGISTRAR_TAREAS.includes(r);
  });
  /** El responsable: resurte y edita el plan */
  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });
  /** Solo lectura (médico): ve el día sin botones */
  readonly soloLectura = computed(
    () => !!this.rol() && !this.puedeRegistrarTomas() && !this.puedeRegistrarTareas(),
  );

  constructor() {
    const reloj = setInterval(() => this.ahora.set(new Date()), REFRESCO_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(reloj));
  }

  ionViewWillEnter() {
    this.ahora.set(new Date());
  }

  cambiarDia(delta: number) {
    this.dia.update((d) => sumarDias(d, delta));
  }

  hoy() {
    this.dia.set(inicioDeDia(new Date()));
  }

  puedeMarcar(f: FilaDia): boolean {
    return f.tipo === 'toma' ? this.puedeRegistrarTomas() : this.puedeRegistrarTareas();
  }

  icono(f: FilaDia): string {
    if (!f.registrado) return f.hora.getTime() < this.ahora().getTime() ? 'time-outline' : 'ellipse-outline';
    return f.hecho ? 'checkmark-circle' : 'close-circle';
  }

  color(f: FilaDia): string {
    if (!f.registrado) return f.hora.getTime() < this.ahora().getTime() ? 'warning' : 'medium';
    return f.hecho ? 'success' : 'danger';
  }

  /** "Tomada" / "No tomada" o "Hecha" / "No hecha". */
  textoEstado(f: FilaDia): string {
    if (f.tipo === 'toma') return f.hecho ? 'Tomada' : 'No tomada';
    return f.hecho ? 'Hecha' : 'No hecha';
  }

  textoSi(f: FilaDia): string {
    return f.tipo === 'toma' ? 'Marcar tomada' : 'Marcar hecha';
  }

  textoNo(f: FilaDia): string {
    return f.tipo === 'toma' ? 'Marcar no tomada' : 'Marcar no hecha';
  }

  /** Marca una fila como hecha / tomada (true) o no (false), con la confirmación de cada tipo. */
  async marcar(f: FilaDia, hecho: boolean) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeMarcar(f) || this.marcando) return;
    this.marcando = true;
    try {
      if (f.tipo === 'toma') {
        await this.marcarToma.marcar(personaId, f.dosis, hecho ? 'tomada' : 'omitida', {
          puedeResurtir: this.puedeEditar(),
        });
      } else {
        await this.marcarTarea.marcar(personaId, f.programada, hecho ? 'hecha' : 'omitida');
      }
      this.ahora.set(new Date());
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar la tarea.');
    } finally {
      this.marcando = false;
    }
  }

  /** Hoja de opciones de la fila: marcar, nota y quitar el registro. */
  async opciones(f: FilaDia) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeMarcar(f)) return;
    if (f.tipo === 'toma') {
      await this.marcarToma.opciones(personaId, f.dosis, { puedeResurtir: this.puedeEditar() });
    } else {
      await this.marcarTarea.opciones(personaId, f.programada);
    }
  }

  /** Registra una toma "ahora" de un medicamento según necesidad. */
  async registrarAhora(m: Medicamento) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrarTomas() || !m.id || this.marcando) return;
    this.marcando = true;
    try {
      await this.marcarToma.registrarAhora(personaId, m, this.ultimas()?.[m.id], {
        puedeResurtir: this.puedeEditar(),
      });
    } finally {
      this.marcando = false;
    }
  }

  ultimaTomaTexto(m: Medicamento): string {
    return this.marcarToma.ultimaTomaTexto(m.id ? this.ultimas()?.[m.id] : undefined);
  }

  /** El responsable suma al inventario desde el aviso "Por resurtir". */
  async resurtir(m: Medicamento) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeEditar()) return;
    await this.resurtirSvc.resurtir(personaId, m, () => this.medicamentos()?.find((x) => x.id === m.id));
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, color: 'danger', duration: 2500, position: 'top' });
    await t.present();
  }
}
