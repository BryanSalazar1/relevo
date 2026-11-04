import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
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
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { combineLatest, map, of, switchMap } from 'rxjs';
import {
  EntradaBitacora,
  EventoCalendario,
  Medicamento,
  PUEDE_EDITAR_CITAS,
  PUEDE_EDITAR_MEDICAMENTOS,
  PUEDE_REGISTRAR_TAREAS,
  PUEDE_REGISTRAR_TOMAS,
  TIPO_EVENTO_INFO,
  TipoEvento,
} from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { BitacoraService } from '../../core/services/bitacora.service';
import { EventosService, detalleCita } from '../../core/services/eventos.service';
import {
  EstadoInventario,
  MedicamentosService,
  estadoInventario,
  textoInventario,
  vigenteEnDia,
} from '../../core/services/medicamentos.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { SignosService } from '../../core/services/signos.service';
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
import {
  MAX_LINEAS_ENTREGA,
  Novedad,
  Visita,
  visitaAlEntrar,
  inicioEntrega,
  novedadesEntrega,
  textoDesde,
} from '../../core/utils/entrega-turno';
import {
  claveDia,
  etiquetaDia,
  inicioDeDia,
  sumarDias,
  textoFechaRelativa,
} from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { estadoSemaforo } from '../../core/utils/semaforo';
import { textoHoy, textoIndicacion } from '../../core/utils/segun-necesidad';
import { FabAsistente } from '../../shared/fab-asistente.component';
import { EditarCitaService } from '../citas/editar-cita.service';
import { MarcarTomaService } from '../medicamentos/marcar-toma.service';
import { ResurtirService } from '../medicamentos/resurtir.service';
import { MarcarTareaService } from '../rutina/marcar-tarea.service';
import { OpcionesSemaforoService } from '../semaforo/opciones-semaforo.service';

/** Cada cuánto se vuelve a calcular el estado del día (ms). */
const REFRESCO_MS = 30_000;
/** Cuántas citas próximas se muestran en Hoy (todas están en Plan › Citas). */
const MAX_CITAS_HOY = 3;
/** Durante cuántos días se destaca en Hoy la última indicación del médico. */
const DIAS_INDICACION = 14;

/**
 * Visitas a Hoy de esa persona en este dispositivo (para la Entrega de turno). `desde` = cuándo
 * terminó la visita anterior; `ultima` = la última vez que se vio Hoy. Ir a otra pestaña y volver
 * enseguida es la misma visita: la entrega no se vacía por mirar la bitácora un momento.
 */
function claveVisita(personaId: string) {
  return `relevo.visita.${personaId}`;
}
function fechaValida(v: unknown): Date | null {
  const d = typeof v === 'string' ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}
function leerVisita(personaId: string): Visita | null {
  try {
    const v = localStorage.getItem(claveVisita(personaId));
    if (!v) return null;
    // Versiones anteriores guardaban solo la fecha de la última visita
    if (!v.startsWith('{')) {
      const ultima = fechaValida(v);
      return ultima ? { desde: ultima, ultima } : null;
    }
    const o = JSON.parse(v) as { desde?: string; ultima?: string };
    const ultima = fechaValida(o.ultima);
    return ultima ? { desde: fechaValida(o.desde), ultima } : null;
  } catch {
    return null;
  }
}
function guardarVisita(personaId: string, visita: Visita) {
  try {
    localStorage.setItem(
      claveVisita(personaId),
      JSON.stringify({ desde: visita.desde?.toISOString() ?? null, ultima: visita.ultima.toISOString() }),
    );
  } catch {
    // Sin almacenamiento (modo privado, cuota): la entrega usa el turno o las últimas 8 h
  }
}
/**
 * Hoy: lo que toca en el día, en una sola lista cronológica (tomas de medicamentos y tareas de la
 * rutina) con botones para marcar, la Entrega de turno y el estado del semáforo arriba, las tomas
 * según necesidad y el aviso de inventario por resurtir. Es la primera pestaña de cada persona.
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
  ],
  templateUrl: './hoy.page.html',
  styleUrl: './hoy.page.scss',
})
export class HoyPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly tareasSvc = inject(TareasService);
  private readonly bitacoraSvc = inject(BitacoraService);
  private readonly signosSvc = inject(SignosService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly auth = inject(AuthService);
  private readonly marcarToma = inject(MarcarTomaService);
  private readonly marcarTarea = inject(MarcarTareaService);
  private readonly resurtirSvc = inject(ResurtirService);
  private readonly eventosSvc = inject(EventosService);
  private readonly editarCita = inject(EditarCitaService);
  private readonly toast = inject(ToastController);
  private readonly router = inject(Router);
  private readonly opcionesSemaforo = inject(OpcionesSemaforoService);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;
  readonly enPausa = this.ctx.enPausa;

  /** Día que se muestra (por defecto hoy) */
  readonly dia = signal<Date>(inicioDeDia(new Date()));
  readonly esHoy = computed(() => claveDia(this.dia()) === claveDia(this.ahora()));
  /** Inicio de hoy según el reloj: cambia solo a medianoche */
  private readonly hoyInicio = computed(() => inicioDeDia(this.ahora()), {
    equal: (a, b) => a.getTime() === b.getTime(),
  });
  readonly etiquetaDia = etiquetaDia;
  readonly textoInventario = textoInventario;
  /** Hasta cuántos días atrás se puede ver (lo anterior está en el reporte) */
  readonly puedeRetroceder = computed(
    () => claveDia(this.dia()) > claveDia(sumarDias(this.hoyInicio(), -DIAS_ATRAS_MAX)),
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
  /** Tomas de hoy de cada medicamento según necesidad (id → tomas): "hoy van 2 de 3" */
  private readonly tomasHoyPrn = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.hoyInicio)]).pipe(
      switchMap(([id, hoy]) => this.medsSvc.tomasHoySegunNecesidad(id, hoy)),
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

  // ---------------------------------------------------------------- Entrega de turno
  /** Momento en que se abrió Hoy: la ventana de la entrega se fija aquí, no se mueve con el reloj */
  private readonly entradaEn = signal(new Date());
  /** Última visita anterior a esta (localStorage); null la primera vez o sin almacenamiento */
  private readonly visitaAnterior = signal<Date | null>(null);
  readonly membresia = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.miembrosSvc.miMembresia(id))),
  );
  /** Desde cuándo se resume: fin del turno anterior, últimas 8 h o la última visita */
  readonly desdeEntrega = computed(() =>
    inicioEntrega({
      turnos: this.membresia()?.turnos,
      ahora: this.entradaEn(),
      ultimaVisita: this.visitaAnterior(),
    }),
  );
  /** Días anteriores a hoy que cubre la ventana (como mucho 3) */
  private readonly diasAnteriores = computed(() => {
    const dias: Date[] = [];
    const hoy = claveDia(this.entradaEn());
    for (let d = inicioDeDia(this.desdeEntrega()); claveDia(d) < hoy; d = sumarDias(d, 1)) dias.push(d);
    return dias;
  });
  private readonly filasAnteriores = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.diasAnteriores)]).pipe(
      switchMap(([id, dias]) =>
        dias.length
          ? combineLatest(
              dias.map((d) =>
                combineLatest([this.medsSvc.agendaDelDia(id, d), this.tareasSvc.agendaDelDia(id, d)]).pipe(
                  map(([ds, ts]) => filasDelDia(ds, ts)),
                ),
              ),
            ).pipe(map((listas) => listas.flat()))
          : of([] as FilaDia[]),
      ),
    ),
  );
  private readonly entradasRecientes = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.bitacoraSvc.entradas(id, 100))),
  );
  private readonly signosRecientes = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.desdeEntrega)]).pipe(
      switchMap(([id, desde]) => this.signosSvc.recientes(id, desde)),
    ),
  );
  /** Lo relevante desde el último turno (solo cuando se ve hoy y ya cargó todo) */
  readonly entrega = computed<Novedad[] | null>(() => {
    if (!this.esHoy() || this.cargando() || this.filasAnteriores() === undefined) return null;
    return novedadesEntrega({
      desde: this.desdeEntrega(),
      ahora: this.ahora(),
      filas: [...(this.filasAnteriores() ?? []), ...this.filas()],
      entradas: this.entradasRecientes() ?? [],
      signos: this.signosRecientes() ?? [],
      miUid: this.auth.uid,
    });
  });
  /** La última indicación del médico de los últimos días, destacada arriba de la agenda */
  readonly indicacion = computed<EntradaBitacora | null>(() => {
    const desde = this.ahora().getTime() - DIAS_INDICACION * 86_400_000;
    return (
      (this.entradasRecientes() ?? [])
        .filter((e) => e.tipo === 'indicacion' && e.fecha.toMillis() >= desde)
        .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())[0] ?? null
    );
  });
  readonly lineasEntrega = computed(() => (this.entrega() ?? []).slice(0, MAX_LINEAS_ENTREGA));
  readonly masEntrega = computed(() => Math.max(0, (this.entrega()?.length ?? 0) - MAX_LINEAS_ENTREGA));
  readonly textoDesdeEntrega = computed(() => textoDesde(this.desdeEntrega(), this.ahora()));

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

  // ---------------------------------------------------------------- Próximas citas
  /** Citas desde hoy (una de hoy ya pasada sigue hasta mañana); se pide una de más para saber si hay más */
  private readonly citas = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.hoyInicio)]).pipe(
      switchMap(([id, hoy]) => this.eventosSvc.proximos(id, hoy, MAX_CITAS_HOY + 1)),
    ),
  );
  readonly citasVisibles = computed(() => (this.citas() ?? []).slice(0, MAX_CITAS_HOY));
  readonly hayMasCitas = computed(() => (this.citas()?.length ?? 0) > MAX_CITAS_HOY);
  /** El equipo, para mostrar quién acompaña a cada cita */
  private readonly miembros = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.miembrosSvc.miembros(id))),
  );
  /** Responsable y familiares agendan y editan citas */
  readonly puedeEditarCitas = computed(() => {
    const r = this.rol();
    return !!r && !this.enPausa() && PUEDE_EDITAR_CITAS.includes(r);
  });

  readonly puedeRegistrarTomas = computed(() => {
    const r = this.rol();
    return !!r && !this.enPausa() && PUEDE_REGISTRAR_TOMAS.includes(r);
  });
  readonly puedeRegistrarTareas = computed(() => {
    const r = this.rol();
    return !!r && !this.enPausa() && PUEDE_REGISTRAR_TAREAS.includes(r);
  });
  /** El responsable: resurte y edita el plan */
  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });
  constructor() {
    const reloj = setInterval(() => this.tic(new Date()), REFRESCO_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(reloj));
  }

  /** Avanza el reloj; si se estaba viendo hoy y pasó la medianoche, pasa al día nuevo. */
  private tic(ahora: Date) {
    const veiaHoy = this.esHoy();
    this.ahora.set(ahora);
    if (veiaHoy && !this.esHoy()) this.dia.set(inicioDeDia(ahora));
  }

  ionViewWillEnter() {
    const ahora = new Date();
    this.ahora.set(ahora);
    this.entradaEn.set(ahora);
    // Hoy siempre abre en el día de hoy (los días anteriores son una consulta de paso)
    this.dia.set(inicioDeDia(ahora));
    // La entrega resume desde la visita anterior; volver de otra pestaña sigue siendo la misma visita
    const id = this.ctx.personaId();
    if (id) {
      const visita = visitaAlEntrar(leerVisita(id), ahora);
      this.visitaAnterior.set(visita.desde);
      guardarVisita(id, visita);
    }
  }

  ionViewWillLeave() {
    // Lo visto hasta aquí cuenta como parte de esta visita
    const id = this.ctx.personaId();
    const visita = id ? leerVisita(id) : null;
    if (id && visita) guardarVisita(id, { ...visita, ultima: new Date() });
  }

  cambiarDia(delta: number) {
    this.dia.update((d) => sumarDias(d, delta));
  }

  hoy() {
    this.dia.set(this.hoyInicio());
  }

  /** "08:00" si fue hoy; "ayer 22:10" o "10 oct 16:00" si no. */
  horaNovedad(n: Novedad): string {
    const hoy = claveDia(this.ahora());
    if (claveDia(n.hora) === hoy) return this.hhmm(n.hora);
    if (claveDia(n.hora) === claveDia(sumarDias(this.ahora(), -1))) return `ayer ${this.hhmm(n.hora)}`;
    return `${n.hora.getDate()}/${n.hora.getMonth() + 1} ${this.hhmm(n.hora)}`;
  }

  private hhmm(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** "Ver en la bitácora" de la entrega: la bitácora completa (lo anotado, más reciente primero). */
  verEntregaCompleta() {
    const id = this.ctx.personaId();
    if (id) void this.router.navigate(['/personas', id, 'bitacora'], { queryParams: { filtro: 'todo' } });
  }

  // ---------------------------------------------------------------- Indicación del médico
  /** "hoy 12:10", "ayer 18:00", "jue 9 oct, 11:00" */
  cuandoIndicacion(e: EntradaBitacora): string {
    return textoFechaRelativa(e.fecha.toDate(), this.ahora());
  }

  /** Todas las indicaciones, en la bitácora filtrada */
  verIndicaciones() {
    const id = this.ctx.personaId();
    if (!id) return;
    void this.router.navigate(['/personas', id, 'bitacora'], { queryParams: { filtro: 'indicacion' } });
  }

  // ---------------------------------------------------------------- Citas
  infoEvento(tipo: TipoEvento) {
    return TIPO_EVENTO_INFO[tipo] ?? TIPO_EVENTO_INFO.cita;
  }

  /** "hoy 10:00", "mañana 10:00", "jue 15 oct, 10:00" */
  cuandoCita(c: EventoCalendario): string {
    return textoFechaRelativa(c.inicio.toDate(), this.ahora());
  }

  /** "1 h · Hospital Ángeles · acompaña Sofía" */
  detalleCita(c: EventoCalendario): string {
    return detalleCita(c, (uid) => this.miembros()?.find((m) => m.uid === uid)?.nombre);
  }

  /** Una cita de hoy que ya terminó se ve atenuada */
  citaPasada(c: EventoCalendario): boolean {
    return c.fin.toDate().getTime() < this.ahora().getTime();
  }

  opcionesCita(c: EventoCalendario) {
    const id = this.ctx.personaId();
    if (!id || !this.puedeEditarCitas()) return;
    void this.editarCita.opciones(id, c);
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

  /** Tarjeta del semáforo: abrirlo, copiar su enlace o mostrar su QR. */
  semaforo() {
    const p = this.persona();
    if (p) void this.opcionesSemaforo.abrir(p);
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
          puedeQuitarAjenos: this.puedeEditar(),
        });
      } else {
        await this.marcarTarea.marcar(personaId, f.programada, hecho ? 'hecha' : 'omitida', {
          puedeQuitarAjenos: this.puedeEditar(),
        });
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
    // El responsable puede quitar registros de otros; los demás solo los suyos (igual que las rules)
    const puedeQuitarAjenos = this.puedeEditar();
    if (f.tipo === 'toma') {
      await this.marcarToma.opciones(personaId, f.dosis, {
        puedeResurtir: this.puedeEditar(),
        puedeQuitarAjenos,
      });
    } else {
      await this.marcarTarea.opciones(personaId, f.programada, { puedeQuitarAjenos });
    }
  }

  /** Registra una toma "ahora" de un medicamento según necesidad. */
  /** Indicación del médico de un medicamento según necesidad ("Si hay dolor · máximo 3 al día · cada 8 h"). */
  indicacionPrn(m: Medicamento): string {
    return textoIndicacion(m);
  }

  /** Cuántas van hoy y si ya se llegó al máximo indicado. */
  usoHoyPrn(m: Medicamento): { texto: string; enMaximo: boolean } {
    const dadas = (m.id ? (this.tomasHoyPrn()?.[m.id] ?? []) : []).filter((t) => t.tomado).length;
    return { texto: textoHoy(dadas, m.maxAlDia), enMaximo: !!m.maxAlDia && dadas >= m.maxAlDia };
  }

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

  /** Signos vitales ahora mismo, sin tarea de por medio (presión, glucosa… lo que se haya medido). */
  async registrarSignos() {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrarTareas() || this.marcando) return;
    this.marcando = true;
    try {
      await this.marcarTarea.registrarSueltos(personaId);
    } finally {
      this.marcando = false;
    }
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
