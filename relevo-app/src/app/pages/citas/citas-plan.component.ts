import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonSpinner, IonText } from '@ionic/angular';
import { combineLatest, distinctUntilChanged, map, switchMap, timer } from 'rxjs';
import {
  AVISO_CITA_MIN_POR_DEFECTO,
  EventoCalendario,
  PUEDE_EDITAR_CITAS,
  TIPO_EVENTO_INFO,
  TipoEvento,
} from '../../core/models';
import { EventosService, detalleCita } from '../../core/services/eventos.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { inicioDeDia, textoAnticipacion, textoFechaRelativa } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { EditarCitaService } from './editar-cita.service';

/**
 * Plan › Citas: las citas, terapias y estudios de una sola vez (próximas y las últimas que ya
 * pasaron). Las agendan el responsable y los familiares; las próximas también se ven en Hoy.
 */
@Component({
  selector: 'app-citas-plan',
  imports: [IonList, IonListHeader, IonItem, IonLabel, IonIcon, IonSpinner, IonText],
  templateUrl: './citas-plan.component.html',
  styleUrl: './citas-plan.component.scss',
})
export class CitasPlan {
  private readonly eventosSvc = inject(EventosService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly editarCita = inject(EditarCitaService);

  private readonly ctx = personaActual();
  /** Rol en esta persona; undefined mientras llega (el pie de ayuda espera a saberlo) */
  readonly rol = this.ctx.rol;
  /**
   * Desde cuándo cuentan como próximas: el inicio de hoy (una cita de hoy ya pasada sigue hasta
   * mañana). Se revisa cada minuto y solo cambia a medianoche, por si la pantalla queda abierta.
   */
  private readonly hoy$ = timer(0, 60_000).pipe(
    map(() => inicioDeDia(new Date())),
    distinctUntilChanged((a, b) => a.getTime() === b.getTime()),
  );

  readonly proximas = toSignal(
    combineLatest([this.ctx.personaId$, this.hoy$]).pipe(
      switchMap(([id, hoy]) => this.eventosSvc.proximos(id, hoy)),
    ),
  );
  readonly anteriores = toSignal(
    combineLatest([this.ctx.personaId$, this.hoy$]).pipe(
      switchMap(([id, hoy]) => this.eventosSvc.anteriores(id, hoy)),
    ),
  );
  private readonly miembros = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.miembrosSvc.miembros(id))),
  );

  readonly puedeEditar = computed(() => {
    const r = this.ctx.rol();
    return !!r && !this.ctx.enPausa() && PUEDE_EDITAR_CITAS.includes(r);
  });

  info(tipo: TipoEvento) {
    return TIPO_EVENTO_INFO[tipo] ?? TIPO_EVENTO_INFO.cita;
  }

  cuando(ev: EventoCalendario): string {
    return textoFechaRelativa(ev.inicio.toDate());
  }

  /** "1 h · Hospital Ángeles · acompaña Sofía · aviso 1 h antes" */
  detalle(ev: EventoCalendario): string {
    const base = detalleCita(ev, (uid) => this.miembros()?.find((m) => m.uid === uid)?.nombre);
    const aviso = textoAnticipacion(ev.avisarMin ?? AVISO_CITA_MIN_POR_DEFECTO);
    const textoAviso = aviso === 'Sin aviso' ? 'sin aviso' : `aviso ${aviso}`;
    return [base, textoAviso].filter(Boolean).join(' · ');
  }

  nueva() {
    const id = this.ctx.personaId();
    if (!id || !this.puedeEditar()) return;
    return this.editarCita.editar(id, null);
  }

  opcionesCita(ev: EventoCalendario) {
    const id = this.ctx.personaId();
    if (!id || !this.puedeEditar()) return;
    void this.editarCita.opciones(id, ev);
  }
}
