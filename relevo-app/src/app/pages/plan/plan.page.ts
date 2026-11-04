import { Component, computed, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { map } from 'rxjs';
import { PUEDE_EDITAR_CITAS, PUEDE_EDITAR_MEDICAMENTOS } from '../../core/models';
import { personaActual } from '../../core/utils/persona-actual';
import { FabAsistente } from '../../shared/fab-asistente.component';
import { CitasPlan } from '../citas/citas-plan.component';
import { MedicamentosPlan } from '../medicamentos/medicamentos-plan.component';
import { RutinaPlan } from '../rutina/rutina-plan.component';

export type SeccionPlan = 'medicamentos' | 'rutina' | 'citas';

const SECCIONES: SeccionPlan[] = ['medicamentos', 'rutina', 'citas'];

/**
 * Plan: lo que se define para la persona (medicamentos, rutina y citas), en una sola pestaña con
 * un segmento. Lo del día a día (tomas y tareas de hoy, próximas citas) vive en Hoy.
 */
@Component({
  selector: 'app-plan',
  imports: [
    FabAsistente,
    MedicamentosPlan,
    RutinaPlan,
    CitasPlan,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/home" text="" />
        </ion-buttons>
        <ion-title>Plan</ion-title>
        <ion-buttons slot="end">
          @if (puedeAgregar()) {
            <ion-button (click)="nuevo()" [attr.aria-label]="textoNuevo()">
              <ion-icon slot="icon-only" name="add" />
            </ion-button>
          }
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar class="secciones">
        <ion-segment [value]="seccion()" (ionChange)="cambiar($any($event).detail.value)">
          <ion-segment-button value="medicamentos">
            <ion-label>Medicinas</ion-label>
          </ion-segment-button>
          <ion-segment-button value="rutina">
            <ion-label>Rutina</ion-label>
          </ion-segment-button>
          <ion-segment-button value="citas">
            <ion-label>Citas</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @switch (seccion()) {
        @case ('rutina') {
          <app-rutina-plan />
        }
        @case ('citas') {
          <app-citas-plan />
        }
        @default {
          <app-medicamentos-plan />
        }
      }
      <app-fab-asistente />
    </ion-content>
  `,
  styles: [
    `
      ion-toolbar.secciones {
        --padding-start: 16px;
        --padding-end: 16px;
        --padding-bottom: 8px;
      }
    `,
  ],
})
export class PlanPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ctx = personaActual();
  private readonly medicamentos = viewChild(MedicamentosPlan);
  private readonly rutina = viewChild(RutinaPlan);
  private readonly citas = viewChild(CitasPlan);

  /** Sección abierta: viene de la ruta (plan/medicamentos | plan/rutina | plan/citas); sin ella, medicinas */
  readonly seccion = toSignal(
    this.route.paramMap.pipe(map((p) => aSeccion(p.get('seccion')))),
    { initialValue: 'medicamentos' as SeccionPlan },
  );

  /** El responsable edita medicinas y rutina; las citas también los familiares */
  readonly puedeAgregar = computed(() => {
    const r = this.ctx.rol();
    if (!r || this.ctx.enPausa()) return false;
    return this.seccion() === 'citas'
      ? PUEDE_EDITAR_CITAS.includes(r)
      : PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });

  readonly textoNuevo = computed(() => {
    switch (this.seccion()) {
      case 'rutina':
        return 'Nueva tarea';
      case 'citas':
        return 'Nueva cita';
      default:
        return 'Nuevo medicamento';
    }
  });

  cambiar(valor: unknown) {
    const id = this.ctx.personaId();
    const seccion = aSeccion(typeof valor === 'string' ? valor : null);
    if (!id || seccion === this.seccion()) return;
    void this.router.navigate(['/personas', id, 'plan', seccion], { replaceUrl: true });
  }

  /** El + de la barra da de alta en la sección abierta. */
  nuevo() {
    switch (this.seccion()) {
      case 'rutina':
        void this.rutina()?.nueva();
        break;
      case 'citas':
        void this.citas()?.nueva();
        break;
      default:
        void this.medicamentos()?.nuevo();
    }
  }
}

function aSeccion(valor: string | null): SeccionPlan {
  return SECCIONES.includes(valor as SeccionPlan) ? (valor as SeccionPlan) : 'medicamentos';
}
