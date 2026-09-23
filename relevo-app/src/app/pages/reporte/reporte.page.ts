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
  IonItemDivider,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  LoadingController,
  ToastController,
} from '@ionic/angular';
import { SignoVital, TIPO_ENTRADA_INFO, TipoEntrada } from '../../core/models';
import { AsistenteService } from '../../core/services/asistente.service';
import { Reporte, ReporteService } from '../../core/services/reporte.service';
import {
  agruparPorDia,
  etiquetaDia,
  etiquetaRango,
  inicioDeDia,
  sumarDias,
} from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { GraficasReporte } from './graficas.component';
import { FabAsistente } from '../../shared/fab-asistente.component';

type Periodo = 'semana' | 'mes';

@Component({
  selector: 'app-reporte',
  imports: [
    FabAsistente,
    DatePipe,
    GraficasReporte,
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
    IonItemDivider,
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
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;

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

  readonly grupos = computed(() => {
    const r = this.reporte();
    return r ? agruparPorDia(r.entradas, (e) => e.fecha.toDate()) : [];
  });
  readonly etiquetaDia = etiquetaDia;

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

  private async cargar(personaId: string, desde: Date, hasta: Date) {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.reporte.set(await this.reporteSvc.generar(personaId, desde, hasta));
    } catch (e) {
      console.error(e);
      this.error.set('No se pudo generar el reporte. Revisa tu conexión.');
    } finally {
      this.cargando.set(false);
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

  async exportar() {
    const r = this.reporte();
    if (!r || this.exportando()) return;
    this.exportando.set(true);
    const loading = await this.loadingCtrl.create({ message: 'Generando PDF…' });
    await loading.present();
    try {
      const blob = await this.reporteSvc.exportarPdf(r);
      await loading.dismiss();
      const resultado = await this.reporteSvc.compartirPdf(blob, this.reporteSvc.nombreArchivo(r));
      await this.aviso(
        resultado === 'descargado' ? 'PDF descargado.' : 'PDF listo para compartir.',
      );
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
