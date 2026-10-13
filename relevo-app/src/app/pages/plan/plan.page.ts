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
import { PUEDE_EDITAR_MEDICAMENTOS } from '../../core/models';
import { personaActual } from '../../core/utils/persona-actual';
import { FabAsistente } from '../../shared/fab-asistente.component';
import { MedicamentosPlan } from '../medicamentos/medicamentos-plan.component';
import { RutinaPlan } from '../rutina/rutina-plan.component';

export type SeccionPlan = 'medicamentos' | 'rutina';

/**
 * Plan: lo que el responsable define para la persona (medicamentos y rutina), en una sola pestaña
 * con un segmento. Lo del día a día (tomas y tareas de hoy) vive en Hoy.
 */
@Component({
  selector: 'app-plan',
  imports: [
    FabAsistente,
    MedicamentosPlan,
    RutinaPlan,
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
          @if (puedeEditar()) {
            <ion-button (click)="nuevo()" [attr.aria-label]="seccion() === 'rutina' ? 'Nueva tarea' : 'Nuevo medicamento'">
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
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (seccion() === 'rutina') {
        <app-rutina-plan />
      } @else {
        <app-medicamentos-plan />
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

  /** Sección abierta: viene de la ruta (plan/medicamentos | plan/rutina); sin ella, medicinas */
  readonly seccion = toSignal(
    this.route.paramMap.pipe(map((p): SeccionPlan => (p.get('seccion') === 'rutina' ? 'rutina' : 'medicamentos'))),
    { initialValue: 'medicamentos' as SeccionPlan },
  );

  readonly puedeEditar = computed(() => {
    const r = this.ctx.rol();
    return !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });

  cambiar(valor: unknown) {
    const id = this.ctx.personaId();
    const seccion: SeccionPlan = valor === 'rutina' ? 'rutina' : 'medicamentos';
    if (!id || seccion === this.seccion()) return;
    void this.router.navigate(['/personas', id, 'plan', seccion], { replaceUrl: true });
  }

  /** El + de la barra da de alta en la sección abierta. */
  nuevo() {
    if (this.seccion() === 'rutina') void this.rutina()?.nueva();
    else void this.medicamentos()?.nuevo();
  }
}
