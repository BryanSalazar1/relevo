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
      --background: var(--relevo-ia-degradado);
      --background-activated: linear-gradient(145deg, #5b4fd6 0%, #7c6ff0 100%);
      --color: #ffffff;
      --box-shadow: var(--relevo-ia-sombra);
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
