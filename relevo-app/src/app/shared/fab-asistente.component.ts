import { Component, inject } from '@angular/core';
import { IonFab, IonFabButton, IonIcon, ModalController } from '@ionic/angular';
import { AsistentePage } from '../pages/asistente/asistente.page';
import { personaActual } from '../core/utils/persona-actual';

/**
 * Botón flotante que abre el asistente de IA sobre la página actual.
 *
 * Va en las páginas de una persona cuidada. Se abre como modal y no como
 * navegación para no perder dónde estabas: puedes preguntar algo y volver a la
 * bitácora en el punto exacto en el que la dejaste.
 *
 * La persona se resuelve aquí (la ruta sí tiene el :id) y se le pasa al modal
 * por componentProps, porque dentro del modal ActivatedRoute ya no la trae.
 */
@Component({
  selector: 'app-fab-asistente',
  imports: [IonFab, IonFabButton, IonIcon],
  template: `
    <ion-fab slot="fixed" vertical="bottom" horizontal="end" class="fab-asistente">
      <ion-fab-button (click)="abrir()" aria-label="Preguntar al asistente">
        <ion-icon name="sparkles-outline" />
      </ion-fab-button>
    </ion-fab>
  `,
  styles: `
    .fab-asistente ion-fab-button {
      --background: linear-gradient(145deg, #6b5cf6 0%, #3730a3 100%);
      --background-activated: linear-gradient(145deg, #3730a3 0%, #6b5cf6 100%);
      --color: #ffffff;
      --box-shadow: 0 10px 28px rgba(107, 92, 246, 0.4);
    }
  `,
})
export class FabAsistente {
  private readonly modalCtrl = inject(ModalController);
  private readonly ctx = personaActual();

  async abrir() {
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    const modal = await this.modalCtrl.create({
      component: AsistentePage,
      componentProps: {
        personaIdFijo: personaId,
        nombreFijo: this.ctx.persona()?.nombre,
        enModal: true,
      },
    });
    await modal.present();
  }
}
