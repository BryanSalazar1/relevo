import { Component, inject, viewChild } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { PersonaCuidada } from '../../core/models';
import { FichaCamposComponent } from './ficha-campos.component';

/** Ficha médica de la persona cuidada. Devuelve DatosFicha con rol 'guardar'. */
@Component({
  selector: 'app-ficha-modal',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonNote,
    FichaCamposComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Ficha médica</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="campos()?.valido() === false">Guardar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note
        >Datos de {{ persona?.nombre || 'la persona' }} que todo el equipo debe tener a
        mano.</ion-note
      >
      <app-ficha-campos [inicial]="persona" />
    </ion-content>
  `,
  styles: [
    `
      ion-note {
        display: block;
      }
    `,
  ],
})
export class FichaModal {
  private readonly modalCtrl = inject(ModalController);
  protected readonly campos = viewChild(FichaCamposComponent);

  /** Se rellena desde componentProps */
  persona: PersonaCuidada | null = null;

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    const campos = this.campos();
    if (!campos || !campos.valido()) return;
    void this.modalCtrl.dismiss(campos.datos(), 'guardar');
  }
}
