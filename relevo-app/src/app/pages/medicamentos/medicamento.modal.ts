import { formatDate } from '@angular/common';
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
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { Medicamento } from '../../core/models';
import { DatosMedicamento, finTratamiento } from '../../core/services/medicamentos.service';
import { sumarDias } from '../../core/utils/fechas';

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
    IonSelect,
    IonSelectOption,
    IonToggle,
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

      <ion-toggle
        name="segunNecesidad"
        [(ngModel)]="segunNecesidad"
        labelPlacement="start"
        justify="space-between"
        class="ion-margin-bottom"
      >
        <div>
          Sin horario fijo
          <ion-note class="ayuda">Solo cuando lo necesite (p. ej. si siente dolor)</ion-note>
        </div>
      </ion-toggle>

      @if (segunNecesidad) {
        <ion-note color="medium" class="ayuda-bloque">
          Cada toma se registra en el momento desde la sección "Según necesidad". No se programan
          avisos.
        </ion-note>
      } @else {
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
      }

      <ion-note>Duración del tratamiento</ion-note>
      <div class="duracion">
        <ion-input
          type="date"
          label="Empieza el"
          labelPlacement="stacked"
          fill="outline"
          name="inicio"
          [(ngModel)]="inicio"
        />
        <ion-select
          label="Duración"
          labelPlacement="stacked"
          fill="outline"
          interface="popover"
          name="modoDuracion"
          [(ngModel)]="modoDuracion"
        >
          <ion-select-option value="indefinido">Hasta que el médico lo indique</ion-select-option>
          <ion-select-option value="dias">Cierto número de días</ion-select-option>
        </ion-select>
      </div>
      @if (modoDuracion === 'dias') {
        <ion-input
          type="number"
          inputmode="numeric"
          label="Número de días"
          labelPlacement="stacked"
          fill="outline"
          name="duracionDias"
          [(ngModel)]="duracionDias"
          min="1"
          max="365"
          [helperText]="finTexto()"
          class="ion-margin-bottom"
        />
      } @else {
        <ion-note color="medium" class="ayuda-bloque">
          Aparecerá todos los días hasta que lo suspendas o lo elimines.
        </ion-note>
      }

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
        [placeholder]="segunNecesidad ? 'Ej. Si siente dolor, máximo 3 al día, dejar 8 h entre tomas' : 'Ej. Con alimentos; no combinar con…'"
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
      ion-toggle .ayuda {
        display: block;
        font-size: 0.8rem;
      }
      .duracion {
        display: flex;
        gap: 8px;
        margin: 6px 0 12px;
        ion-input,
        ion-select {
          flex: 1;
          min-width: 0;
        }
      }
      .ayuda-bloque {
        display: block;
        margin-bottom: 16px;
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
  segunNecesidad = false;
  readonly hoy = formatDate(new Date(), 'yyyy-MM-dd', 'es');
  inicio = this.hoy;
  modoDuracion: 'indefinido' | 'dias' = 'indefinido';
  duracionDias: number | string = 7;
  inventario: number | string | null = null;
  notas = '';
  readonly horarios = signal<string[]>([]);

  ngOnInit() {
    if (this.medicamento) {
      this.nombre = this.medicamento.nombre;
      this.dosis = this.medicamento.dosis;
      this.horarios.set([...(this.medicamento.horarios ?? [])]);
      this.segunNecesidad = this.medicamento.segunNecesidad === true;
      this.inicio = this.medicamento.inicio ?? this.hoy;
      if (this.medicamento.duracionDias && this.medicamento.duracionDias > 0) {
        this.modoDuracion = 'dias';
        this.duracionDias = this.medicamento.duracionDias;
      }
      this.inventario = this.medicamento.inventario ?? null;
      this.notas = this.medicamento.notas ?? '';
    }
  }

  valido(): boolean {
    return (
      !!this.nombre.trim() &&
      !!this.dosis.trim() &&
      (this.segunNecesidad || this.horarios().length > 0) &&
      (this.modoDuracion !== 'dias' || this.diasNumero() > 0)
    );
  }

  private diasNumero(): number {
    const n = Math.round(Number(this.duracionDias));
    return Number.isFinite(n) ? n : 0;
  }

  /** "Última toma el 21 sep (7 días)" para el campo de duración. */
  finTexto(): string {
    const dias = this.diasNumero();
    if (dias <= 0) return 'Escribe cuántos días';
    const fin = finTratamiento({ inicio: this.inicio || this.hoy, duracionDias: dias });
    if (!fin) return '';
    return `Última toma el ${formatDate(sumarDias(fin, -1), "d 'de' MMMM", 'es')} (${dias} ${dias === 1 ? 'día' : 'días'})`;
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
      horarios: this.segunNecesidad ? [] : this.horarios(),
      segunNecesidad: this.segunNecesidad,
      inicio: this.inicio || this.hoy,
      duracionDias: this.modoDuracion === 'dias' ? Math.max(1, this.diasNumero()) : null,
      inventario: inv === null || Number.isNaN(inv) ? null : Math.max(0, Math.round(inv)),
      notas: this.notas.trim(),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
