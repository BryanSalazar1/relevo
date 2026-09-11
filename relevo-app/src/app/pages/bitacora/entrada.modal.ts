import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonDatetime,
  IonDatetimeButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonModal,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { EntradaBitacora, TIPOS_ENTRADA, TipoEntrada } from '../../core/models';
import { DatosEntrada } from '../../core/services/bitacora.service';
import { aIsoLocal } from '../../core/utils/fechas';

/** Formulario para crear o editar un registro de la bitácora. Devuelve DatosEntrada con rol 'guardar'. */
@Component({
  selector: 'app-entrada-modal',
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonChip,
    IonIcon,
    IonLabel,
    IonTextarea,
    IonItem,
    IonNote,
    IonDatetimeButton,
    IonModal,
    IonDatetime,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>{{ entrada ? 'Editar registro' : 'Nuevo registro' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!texto.trim()">Guardar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note>¿Qué pasó con {{ personaNombre || 'la persona cuidada' }}?</ion-note>
      <div class="tipos">
        @for (t of tipos; track t.valor) {
          <ion-chip [outline]="tipo() !== t.valor" [color]="t.color" (click)="tipo.set(t.valor)">
            <ion-icon [name]="t.icono" />
            <ion-label>{{ t.etiqueta }}</ion-label>
          </ion-chip>
        }
      </div>

      <ion-textarea
        label="Descripción"
        labelPlacement="stacked"
        fill="outline"
        [autoGrow]="true"
        rows="4"
        name="texto"
        [(ngModel)]="texto"
        placeholder="Ej. Desayunó bien; a las 10 se quejó de dolor de cabeza…"
        autocapitalize="sentences"
      />

      <ion-item lines="none" class="fecha">
        <ion-label>Fecha y hora</ion-label>
        <ion-datetime-button datetime="fecha-entrada" />
      </ion-item>
      <ion-modal [keepContentsMounted]="true">
        <ng-template>
          <ion-datetime
            id="fecha-entrada"
            presentation="date-time"
            locale="es-MX"
            [max]="maxIso"
            name="fecha"
            [(ngModel)]="fechaIso"
            [showDefaultButtons]="true"
            doneText="Listo"
            cancelText="Cancelar"
          />
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [
    `
      .tipos {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 8px 0 16px;
      }
      ion-textarea {
        margin-bottom: 12px;
      }
      .fecha {
        --padding-start: 0;
      }
    `,
  ],
})
export class EntradaModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellenan desde componentProps */
  entrada: EntradaBitacora | null = null;
  personaNombre = '';

  readonly tipos = TIPOS_ENTRADA;
  readonly tipo = signal<TipoEntrada>('nota');
  readonly maxIso = aIsoLocal(new Date());
  texto = '';
  fechaIso = aIsoLocal(new Date());

  ngOnInit() {
    if (this.entrada) {
      this.tipo.set(this.entrada.tipo);
      this.texto = this.entrada.texto;
      this.fechaIso = aIsoLocal(this.entrada.fecha.toDate());
    }
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    const texto = this.texto.trim();
    if (!texto) return;
    const fecha = new Date(this.fechaIso);
    const datos: DatosEntrada = {
      tipo: this.tipo(),
      texto,
      fecha: isNaN(fecha.getTime()) ? new Date() : fecha,
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
