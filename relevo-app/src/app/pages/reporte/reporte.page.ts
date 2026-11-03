import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
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
  IonCheckbox,
  IonSpinner,
  IonText,
  IonTextarea,
  IonTitle,
  IonToolbar,
  LoadingController,
  ToastController,
} from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import {
  PUEDE_ESCRIBIR_BITACORA,
  SignoVital,
  TIPO_ENTRADA_INFO,
  TipoEntrada,
} from '../../core/models';
import { AsistenteService } from '../../core/services/asistente.service';
import { ConsultaService } from '../../core/services/consulta.service';
import { Reporte, ReporteService } from '../../core/services/reporte.service';
import { etiquetaRango, inicioDeDia, sumarDias } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { GraficasReporte } from './graficas.component';
import { FabAsistente } from '../../shared/fab-asistente.component';

type Periodo = 'semana' | 'mes';

@Component({
  selector: 'app-reporte',
  imports: [
    FabAsistente,
    DatePipe,
    FormsModule,
    GraficasReporte,
    IonCheckbox,
    IonTextarea,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonBadge,
    IonChip,
    IonNote,
    IonSpinner,
    IonText,
  ],
  templateUrl: './reporte.page.html',
  styleUrl: './reporte.page.scss',
})
export class ReportePage {
  private readonly reporteSvc = inject(ReporteService);
  private readonly asistente = inject(AsistenteService);
  private readonly consultaSvc = inject(ConsultaService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;

  /** Preguntas de la familia para el médico (texto compartido; se carga con el reporte) */
  textoPreguntas = '';
  readonly guardandoPreguntas = signal(false);
  /** Quienes escriben en la bitácora también dejan preguntas; el médico solo las lee */
  readonly puedeEditarPreguntas = computed(() => {
    const r = this.ctx.rol();
    return !!r && PUEDE_ESCRIBIR_BITACORA.includes(r);
  });
  /** Anexos de la hoja para la consulta (la primera página siempre va) */
  anexoSintomas = true;
  anexoResumen = true;
  anexoBitacora = false;

  readonly periodo = signal<Periodo>('semana');
  /** Fin del periodo, exclusivo (mañana a las 00:00 = "hasta hoy") */
  readonly fin = signal<Date>(this.manana());
  readonly dias = computed(() => (this.periodo() === 'semana' ? 7 : 30));
  readonly desde = computed(() => sumarDias(this.fin(), -this.dias()));
  readonly rango = computed(() => etiquetaRango(this.desde(), this.fin()));
  readonly puedeAvanzar = computed(() => this.fin().getTime() < this.manana().getTime());

  readonly reporte = signal<Reporte | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly exportando = signal(false);
  readonly resumiendo = signal(false);
  readonly errorResumen = signal<string | null>(null);

  constructor() {
    // Se vuelve a generar cuando cambia la persona, el periodo o la fecha
    effect(() => {
      const id = this.ctx.personaId();
      const desde = this.desde();
      const hasta = this.fin();
      if (!id) return;
      untracked(() => void this.cargar(id, desde, hasta));
    });
  }

  private manana(): Date {
    return sumarDias(inicioDeDia(new Date()), 1);
  }

  /** Cada carga lleva un número: si el usuario cambió de periodo, la respuesta vieja se descarta */
  private cargaActual = 0;
  /** Lo último guardado de las preguntas: lo escrito y no guardado no se pisa al recargar */
  private preguntasGuardadas = '';

  /** Vuelve a generar el periodo que se está viendo. */
  reintentar() {
    const id = this.ctx.personaId();
    if (id) void this.cargar(id, this.desde(), this.fin());
  }

  private async cargar(personaId: string, desde: Date, hasta: Date) {
    const carga = ++this.cargaActual;
    this.cargando.set(true);
    this.error.set(null);
    try {
      const reporte = await this.reporteSvc.generar(personaId, desde, hasta);
      if (carga !== this.cargaActual) return;
      this.reporte.set(reporte);
      const sinGuardar = this.textoPreguntas.trim() !== this.preguntasGuardadas.trim();
      this.preguntasGuardadas = reporte.hoja.preguntas;
      if (!sinGuardar) this.textoPreguntas = reporte.hoja.preguntas;
    } catch (e) {
      console.error(e);
      if (carga === this.cargaActual) this.error.set('No se pudo generar el reporte. Revisa tu conexión.');
    } finally {
      if (carga === this.cargaActual) this.cargando.set(false);
    }
  }

  info(tipo: TipoEntrada) {
    return TIPO_ENTRADA_INFO[tipo];
  }

  textoSigno(s: SignoVital): string {
    return s.tipo === 'presion' && s.valorSecundario != null
      ? `${s.valor}/${s.valorSecundario} ${s.unidad}`
      : `${s.valor} ${s.unidad}`;
  }

  cambiarPeriodo(valor: unknown) {
    if (valor === 'semana' || valor === 'mes') this.periodo.set(valor);
  }

  anterior() {
    this.fin.update((f) => sumarDias(f, -this.dias()));
  }

  siguiente() {
    if (!this.puedeAvanzar()) return;
    this.fin.update((f) => {
      const siguiente = sumarDias(f, this.dias());
      return siguiente > this.manana() ? this.manana() : siguiente;
    });
  }

  hoy() {
    this.fin.set(this.manana());
  }

  /** Pide a la IA el resumen narrativo del periodo y lo guarda en el reporte (entra en el PDF). */
  async resumir() {
    const personaId = this.ctx.personaId();
    const r = this.reporte();
    if (!personaId || !r || this.resumiendo()) return;
    this.resumiendo.set(true);
    this.errorResumen.set(null);
    try {
      const texto = await this.asistente.resumirPeriodo(personaId, r.desde, r.hasta);
      this.reporte.update((actual) => (actual ? { ...actual, resumenIA: texto } : actual));
    } catch (e) {
      console.error(e);
      this.errorResumen.set(this.asistente.mensajeError(e));
    } finally {
      this.resumiendo.set(false);
    }
  }

  /** Guarda las preguntas de la familia (compartidas con el equipo; encabezan la hoja). */
  async guardarPreguntas() {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeEditarPreguntas() || this.guardandoPreguntas()) return;
    this.guardandoPreguntas.set(true);
    try {
      await this.consultaSvc.guardarPreguntas(personaId, this.textoPreguntas);
      const texto = this.textoPreguntas.trim();
      this.preguntasGuardadas = texto;
      this.reporte.update((r) => (r ? { ...r, hoja: { ...r.hoja, preguntas: texto } } : r));
      await this.aviso('Preguntas guardadas.');
    } catch (e) {
      console.error(e);
      await this.aviso('No se pudieron guardar las preguntas.');
    } finally {
      this.guardandoPreguntas.set(false);
    }
  }

  /** Hoja para la consulta: una página con lo esencial y los anexos elegidos. */
  exportarHoja() {
    return this.exportarCon(
      (r) =>
        this.reporteSvc.exportarHojaPdf(
          { ...r, hoja: { ...r.hoja, preguntas: this.textoPreguntas.trim() } },
          { sintomas: this.anexoSintomas, resumenIA: this.anexoResumen, bitacora: this.anexoBitacora },
        ),
      (r) => this.reporteSvc.nombreArchivoHoja(r),
    );
  }

  /** Reporte completo (todas las secciones y la bitácora entera). */
  exportar() {
    return this.exportarCon(
      (r) => this.reporteSvc.exportarPdf(r),
      (r) => this.reporteSvc.nombreArchivo(r),
    );
  }

  private async exportarCon(
    generar: (r: Reporte) => Promise<Blob>,
    nombre: (r: Reporte) => string,
  ) {
    const r = this.reporte();
    if (!r || this.exportando()) return;
    this.exportando.set(true);
    const loading = await this.loadingCtrl.create({ message: 'Generando PDF…' });
    await loading.present();
    try {
      const blob = await generar(r);
      await loading.dismiss();
      const resultado = await this.reporteSvc.compartirPdf(blob, nombre(r));
      if (resultado !== 'cancelado') {
        await this.aviso(
          resultado === 'descargado'
            ? `PDF guardado en ${this.reporteSvc.carpetaDescargas}.`
            : 'PDF listo para compartir.',
        );
      }
    } catch (e) {
      console.error(e);
      await loading.dismiss();
      await this.aviso('No se pudo generar el PDF.');
    } finally {
      this.exportando.set(false);
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, duration: 2500, position: 'top' });
    await t.present();
  }
}
