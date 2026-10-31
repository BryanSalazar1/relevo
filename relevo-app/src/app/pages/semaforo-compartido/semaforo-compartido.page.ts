import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular';
import {
  DatosSemaforoCompartido,
  SemaforoCompartidoService,
  agendaCompartida,
} from '../../core/services/semaforo-compartido.service';
import { avanceDia, filasDelDia, pendientesDelDia, textoCuando, tituloEstado } from '../../core/utils/agenda-dia';
import { claveDia, inicioDeDia } from '../../core/utils/fechas';
import { FaseSemaforo, estadoSemaforo } from '../../core/utils/semaforo';

/** Cada cuánto se vuelve a calcular el semáforo con lo que ya se tiene (ms). */
const REFRESCO_MS = 15_000;
/** Cada cuánto se piden los datos otra vez a la función (ms). */
const ACTUALIZAR_MS = 60_000;
/** Si no se puede actualizar, hasta cuándo se sigue mostrando lo último que llegó (ms). */
const VIGENCIA_MS = 15 * 60_000;
/** Cuántos pendientes se listan debajo del principal. */
const MAX_DESPUES = 4;
/** Tras tocar la pantalla, cuánto sigue a la vista la lista antes de volver al vistazo (ms). */
const DETALLES_MS = 30_000;

/**
 * Semáforo compartido por enlace (/s/<token>): el mismo semáforo del día, sin iniciar sesión y solo
 * para verlo (p. ej. en una tableta de la casa). Los datos vienen de la Cloud Function
 * semaforoCompartido cada minuto y se calculan con la misma agenda del día que la app.
 */
@Component({
  selector: 'app-semaforo-compartido',
  imports: [DatePipe, IonContent, IonIcon, IonSpinner],
  templateUrl: './semaforo-compartido.page.html',
  styleUrls: ['../semaforo/semaforo.page.scss', './semaforo-compartido.page.scss'],
})
export class SemaforoCompartidoPage {
  private readonly svc = inject(SemaforoCompartidoService);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  readonly ahora = signal(new Date());
  /** Lo último que devolvió la función y el día al que corresponde */
  private readonly datos = signal<{ datos: DatosSemaforoCompartido; dia: Date } | null>(null);
  /** 'invalido': el enlace no existe o se cambió; 'red': no se pudo actualizar (se muestra lo último) */
  readonly problema = signal<'invalido' | 'red' | null>(null);
  readonly actualizado = signal<Date | null>(null);
  readonly detalles = signal(false);
  private ocultarDetalles?: ReturnType<typeof setTimeout>;
  private pidiendo = false;

  readonly nombre = computed(() => this.datos()?.datos.nombre ?? '');
  readonly cargando = computed(() => !this.datos() && !this.problema());
  /**
   * Sin datos que mostrar: nunca se pudo cargar, o lleva más de VIGENCIA_MS sin actualizarse
   * (no se deja a la vista un "Todo al día" que ya puede no ser cierto).
   */
  readonly sinDatos = computed(() => {
    if (this.problema() !== 'red') return false;
    const t = this.actualizado();
    return !this.datos() || !t || this.ahora().getTime() - t.getTime() > VIGENCIA_MS;
  });

  private readonly filas = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const { dosis, tareas } = agendaCompartida(d.datos, d.dia);
    return filasDelDia(dosis, tareas);
  });
  readonly avance = computed(() => avanceDia(this.filas()));
  readonly estado = computed(() => estadoSemaforo(pendientesDelDia(this.filas()), this.ahora()));
  readonly despues = computed(() => this.estado().resto.slice(0, MAX_DESPUES));
  readonly masDespues = computed(() => Math.max(0, this.estado().resto.length - MAX_DESPUES));
  readonly titulo = computed(() => tituloEstado(this.estado()));
  readonly cuando = computed(() => textoCuando(this.estado(), this.ahora()));
  readonly color = computed(() =>
    this.problema() === 'invalido' || this.sinDatos() || !this.datos() ? 'apagado' : this.estado().color,
  );
  readonly pista = computed(() =>
    this.estado().resto.length > 0 ? 'Toca la pantalla para ver lo que sigue' : '',
  );

  readonly etiquetaFase: Record<FaseSemaforo, string> = {
    atrasado: 'atrasado',
    sin_registrar: 'sin registrar',
    ahora: 'es hora',
    pronto: 'ya casi',
    despues: '',
  };

  constructor() {
    void this.actualizar();
    const reloj = setInterval(() => {
      this.ahora.set(new Date());
      // A medianoche se piden de inmediato los datos del nuevo día
      const d = this.datos();
      if (d && claveDia(d.dia) !== claveDia(this.ahora())) void this.actualizar();
    }, REFRESCO_MS);
    const datos = setInterval(() => void this.actualizar(), ACTUALIZAR_MS);
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      this.ahora.set(new Date());
      void this.actualizar();
      void this.pantallaEncendida(true);
    };
    document.addEventListener('visibilitychange', alVolver);
    void this.pantallaEncendida(true);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      clearInterval(datos);
      clearTimeout(this.ocultarDetalles);
      document.removeEventListener('visibilitychange', alVolver);
      void this.pantallaEncendida(false);
    });
  }

  async actualizar() {
    if (this.pidiendo || this.problema() === 'invalido') return;
    this.pidiendo = true;
    const dia = inicioDeDia(new Date());
    try {
      const datos = await this.svc.datos(this.token, dia);
      this.datos.set({ datos, dia });
      this.problema.set(null);
      this.actualizado.set(new Date());
      this.ahora.set(new Date());
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? '';
      if (code.endsWith('not-found')) {
        this.datos.set(null);
        this.problema.set('invalido');
      } else {
        console.warn('No se pudo actualizar el semáforo', error);
        this.problema.set('red');
      }
    } finally {
      this.pidiendo = false;
    }
  }

  alternarDetalles() {
    clearTimeout(this.ocultarDetalles);
    const ver = !this.detalles();
    this.detalles.set(ver);
    if (ver) this.ocultarDetalles = setTimeout(() => this.detalles.set(false), DETALLES_MS);
  }

  /** Mantiene la pantalla encendida (o la suelta). Si el dispositivo no lo permite, sigue funcionando. */
  private async pantallaEncendida(encendida: boolean) {
    try {
      if (encendida) await KeepAwake.keepAwake();
      else await KeepAwake.allowSleep();
    } catch {
      // Sin soporte: no es un error para quien lo mira
    }
  }
}
