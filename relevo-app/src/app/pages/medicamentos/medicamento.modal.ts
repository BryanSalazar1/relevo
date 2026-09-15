import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonLabel,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { Medicamento } from '../../core/models';
import { DatosMedicamento } from '../../core/services/medicamentos.service';

/** Alta / edición de un medicamento. Devuelve DatosMedicamento con rol 'guardar'. */
@Component({
  selector: 'app-medicamento-modal',
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonInput,
    IonTextarea,
    IonChip,
    IonIcon,
    IonLabel,
    IonNote,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>{{ medicamento ? 'Editar medicamento' : 'Nuevo medicamento' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()">Guardar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-input
        label="Nombre"
        labelPlacement="stacked"
        fill="outline"
        name="nombre"
        placeholder="Ej. Losartán"
        [(ngModel)]="nombre"
        autocapitalize="sentences"
        class="ion-margin-bottom"
      />
      <ion-input
        label="Dosis"
        labelPlacement="stacked"
        fill="outline"
        name="dosis"
        placeholder="Ej. 50 mg, 1 tableta"
        [(ngModel)]="dosis"
        class="ion-margin-bottom"
      />

      <ion-note>Horarios de toma</ion-note>
      <div class="horarios">
        @for (h of horarios(); track h) {
          <ion-chip color="primary" (click)="quitarHora(h)">
            <ion-label>{{ h }}</ion-label>
            <ion-icon name="close-circle" />
          </ion-chip>
        } @empty {
          <ion-note color="medium">Agrega al menos una hora.</ion-note>
        }
      </div>
      <div class="agregar-hora">
        <ion-input type="time" label="Nueva hora" labelPlacement="stacked" fill="outline" name="nuevaHora" [(ngModel)]="nuevaHora" />
        <ion-button fill="outline" (click)="agregarHora()" [disabled]="!nuevaHora">Agregar</ion-button>
      </div>

      <ion-input
        type="number"
        inputmode="numeric"
        label="Inventario (unidades restantes)"
        labelPlacement="stacked"
        fill="outline"
        name="inventario"
        placeholder="Déjalo vacío si no lo controlas"
        [(ngModel)]="inventario"
        min="0"
        class="ion-margin-bottom"
      />
      <ion-textarea
        label="Notas (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="notas"
        placeholder="Ej. Con alimentos; no combinar con…"
        [autoGrow]="true"
        rows="2"
        [(ngModel)]="notas"
      />
    </ion-content>
  `,
  styles: [
    `
      .horarios {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        min-height: 40px;
        margin: 6px 0 4px;
        align-items: center;
      }
      .agregar-hora {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        margin-bottom: 16px;
        ion-input {
          flex: 1;
        }
      }
    `,
  ],
})
export class MedicamentoModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellena desde componentProps al editar */
  medicamento: Medicamento | null = null;

  nombre = '';
  dosis = '';
  nuevaHora = '';
  inventario: number | string | null = null;
  notas = '';
  readonly horarios = signal<string[]>([]);

  ngOnInit() {
    if (this.medicamento) {
      this.nombre = this.medicamento.nombre;
      this.dosis = this.medicamento.dosis;
      this.horarios.set([...(this.medicamento.horarios ?? [])]);
      this.inventario = this.medicamento.inventario ?? null;
      this.notas = this.medicamento.notas ?? '';
    }
  }

  valido(): boolean {
    return !!this.nombre.trim() && !!this.dosis.trim() && this.horarios().length > 0;
  }

  agregarHora() {
    const m = String(this.nuevaHora).match(/(\d{1,2}):(\d{2})/);
    if (!m) return;
    const hora = `${m[1].padStart(2, '0')}:${m[2]}`;
    this.horarios.update((h) => [...new Set([...h, hora])].sort());
    this.nuevaHora = '';
  }

  quitarHora(hora: string) {
    this.horarios.update((h) => h.filter((x) => x !== hora));
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.valido()) return;
    const inv = this.inventario === '' || this.inventario === null ? null : Number(this.inventario);
    const datos: DatosMedicamento = {
      nombre: this.nombre.trim(),
      dosis: this.dosis.trim(),
      horarios: this.horarios(),
      inventario: inv === null || Number.isNaN(inv) ? null : Math.max(0, Math.round(inv)),
      notas: this.notas.trim(),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
