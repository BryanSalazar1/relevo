import { Component } from '@angular/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

/** Contenedor con pestañas de una persona cuidada: bitácora, equipo y reporte. */
@Component({
  selector: 'app-persona',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
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
export class PersonaPage {}
