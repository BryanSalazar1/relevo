import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import {
  EntradaBitacora,
  PUEDE_ESCRIBIR_INDICACION,
  TIPO_ENTRADA_INFO,
  TipoEntrada,
} from '../../core/models';
import { BitacoraService, DatosEntrada } from '../../core/services/bitacora.service';
import { Reporte, ReporteService } from '../../core/services/reporte.service';
import { edad, haceCuanto, inicioDeDia, sumarDias } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { EntradaModal } from '../bitacora/entrada.modal';
import { FabAsistente } from '../../shared/fab-asistente.component';

/** Días hacia atrás que abarca el seguimiento */
type Ventana = 30 | 90;

/**
 * Seguimiento del paciente: la pantalla de inicio del médico. Responde en un minuto lo que un
 * médico tratante necesita entre consultas: ¿pasó algo delicado?, ¿cómo van sus cifras?, ¿se toma
 * lo indicado?, ¿qué pregunta la familia?, y le deja dar una indicación que todo el equipo ve.
 * Reutiliza los cálculos de la hoja para la consulta (ReporteService + core/utils/hoja-consulta.ts);
 * no muestra inventario, rutina ni turnos, que son operación de la familia.
 */
@Component({
  selector: 'app-seguimiento',
  imports: [
    FabAsistente,
    DatePipe,
    RouterLink,
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
    IonNote,
    IonSpinner,
    IonText,
  ],
  templateUrl: './seguimiento.page.html',
  styleUrl: './seguimiento.page.scss',
})
export class SeguimientoPage {
  private readonly reporteSvc = inject(ReporteService);
  private readonly bitacoraSvc = inject(BitacoraService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  readonly dias = signal<Ventana>(30);
  readonly reporte = signal<Reporte | null>(null);
  readonly cargando = signal(false);
  readonly error = signal<string | null>(null);
  readonly exportando = signal(false);
  /** Cambiarlo vuelve a cargar (tras dar una indicación o al reintentar) */
  private readonly recarga = signal(0);

  /** Solo el médico da indicaciones (PUEDE_ESCRIBIR_INDICACION, igual que las rules) */
  readonly puedeIndicar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_ESCRIBIR_INDICACION.includes(r);
  });
  readonly edad = computed(() => edad(this.persona()?.fechaNacimiento));
  readonly banderasAltas = computed(
    () => this.reporte()?.hoja.banderas.filter((b) => b.nivel === 'alta').length ?? 0,
  );
  /** Las indicaciones de la ventana más las previas que trae la hoja, sin repetir, las 5 más recientes */
  readonly indicaciones = computed(() => {
    const r = this.reporte();
    if (!r) return [];
    const vistas = new Set<string>();
    return [...r.entradas.filter((e) => e.tipo === 'indicacion'), ...r.hoja.indicaciones]
      .filter((e) => {
        const clave = e.id ?? `${e.fecha.toMillis()}-${e.autorUid}`;
        if (vistas.has(clave)) return false;
        vistas.add(clave);
        return true;
      })
      .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
      .slice(0, 5);
  });
  /** Síntomas e incidentes de la ventana, los 5 más recientes (el resto está en el historial) */
  readonly alertas = computed(() =>
    [...(this.reporte()?.alertas ?? [])]
      .sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())
      .slice(0, 5),
  );
  /** Medicamentos con algo que revisar primero (adherencia baja o la misma dosis omitida) */
  readonly medicamentos = computed(() =>
    [...(this.reporte()?.medicamentos ?? [])].sort(
      (a, b) => Number(this.revisar(b)) - Number(this.revisar(a)),
    ),
  );

  constructor() {
    // Se vuelve a cargar cuando cambia la persona, la ventana o se pide una recarga
    effect(() => {
      const id = this.ctx.personaId();
      const dias = this.dias();
      this.recarga();
      if (!id) return;
      untracked(() => void this.cargar(id, dias));
    });
  }

  private async cargar(personaId: string, dias: Ventana) {
    this.cargando.set(true);
    this.error.set(null);
    try {
      // Hasta mañana a las 00:00 = "hasta hoy", igual que el reporte
      const hasta = sumarDias(inicioDeDia(new Date()), 1);
      this.reporte.set(await this.reporteSvc.generar(personaId, sumarDias(hasta, -dias), hasta));
    } catch (e) {
      console.error(e);
      this.error.set('No se pudo cargar el seguimiento. Revisa tu conexión.');
    } finally {
      this.cargando.set(false);
    }
  }

  reintentar() {
    this.recarga.update((n) => n + 1);
  }

  cambiarVentana(valor: unknown) {
    const n = Number(valor);
    if (n === 30 || n === 90) this.dias.set(n);
  }

  info(tipo: TipoEntrada) {
    return TIPO_ENTRADA_INFO[tipo];
  }

  cuando(e: EntradaBitacora): string {
    return haceCuanto(e.fecha.toDate());
  }

  /** Adherencia por debajo del 80 % o la misma dosis omitida casi siempre */
  revisar(m: Reporte['medicamentos'][number]): boolean {
    return (m.adherencia !== null && m.adherencia < 80) || !!m.patronOmision;
  }

  /** Abre el formulario de indicación (el mismo de la bitácora, acotado al médico) y recarga. */
  async indicar() {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeIndicar()) return;
    const modal = await this.modalCtrl.create({
      component: EntradaModal,
      componentProps: { entrada: null, personaNombre: this.persona()?.nombre ?? '', rol: this.rol() },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosEntrada>();
    if (role !== 'guardar' || !data) return;
    try {
      await this.bitacoraSvc.crear(personaId, data);
      await this.aviso('Indicación guardada. El equipo la verá en Hoy y en la bitácora.');
      this.reintentar();
    } catch (e) {
      console.error(e);
      await this.aviso('No se pudo guardar la indicación. Revisa tu conexión o tus permisos.');
    }
  }

  /** La misma hoja de una página que exporta la familia, con el anexo de síntomas e incidentes. */
  async exportarHoja() {
    const r = this.reporte();
    if (!r || this.exportando()) return;
    this.exportando.set(true);
    const loading = await this.loadingCtrl.create({ message: 'Generando PDF…' });
    await loading.present();
    try {
      const blob = await this.reporteSvc.exportarHojaPdf(r, {
        sintomas: true,
        resumenIA: false,
        bitacora: false,
      });
      await loading.dismiss();
      const resultado = await this.reporteSvc.compartirPdf(blob, this.reporteSvc.nombreArchivoHoja(r));
      await this.aviso(resultado === 'descargado' ? 'PDF descargado.' : 'PDF listo para compartir.');
    } catch (e) {
      console.error(e);
      await loading.dismiss();
      await this.aviso('No se pudo generar el PDF.');
    } finally {
      this.exportando.set(false);
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, duration: 3000, position: 'top' });
    await t.present();
  }
}
