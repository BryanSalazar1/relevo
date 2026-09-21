import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonBadge, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { switchMap } from 'rxjs';
import { MedicamentosService, estadoInventario } from '../../core/services/medicamentos.service';
import { personaActual } from '../../core/utils/persona-actual';

/** Contenedor con pestañas de una persona cuidada: bitácora, medicinas, rutina, equipo, reporte y asistente. */
@Component({
  selector: 'app-persona',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="bitacora">
          <ion-icon name="book-outline" />
          <ion-label>Bitácora</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="medicamentos">
          <ion-icon name="medkit-outline" />
          <ion-label>Medicinas</ion-label>
          @if (porResurtir().total > 0) {
            <ion-badge
              [color]="porResurtir().agotados > 0 ? 'danger' : 'warning'"
              [attr.aria-label]="porResurtir().total + ' por resurtir'"
              >{{ porResurtir().total }}</ion-badge
            >
          }
        </ion-tab-button>
        <ion-tab-button tab="rutina">
          <ion-icon name="alarm-outline" />
          <ion-label>Rutina</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="equipo">
          <ion-icon name="people-outline" />
          <ion-label>Equipo</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="reporte">
          <ion-icon name="document-text-outline" />
          <ion-label>Reporte</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="asistente">
          <ion-icon name="sparkles-outline" />
          <ion-label>Asistente</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class PersonaPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly ctx = personaActual();

  private readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );

  /** Medicamentos por resurtir (agotados o por acabarse), para el aviso de la pestaña Medicinas. */
  readonly porResurtir = computed(() => {
    const niveles = (this.medicamentos() ?? []).map((m) => estadoInventario(m)?.nivel);
    const agotados = niveles.filter((n) => n === 'agotado').length;
    return { total: agotados + niveles.filter((n) => n === 'bajo').length, agotados };
  });
}
