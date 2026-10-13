import { formatDate } from '@angular/common';
import { Component, OnInit, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { PersonaCuidada } from '../../core/models';
import { edad } from '../../core/utils/fechas';
import { DatosFicha, FichaCamposComponent } from '../equipo/ficha-campos.component';

/** Lo que captura el formulario; fechaNacimiento en ISO yyyy-mm-dd. */
export interface DatosPersona {
  nombre: string;
  fechaNacimiento?: string;
  descripcion?: string;
  /** Solo en el alta: la ficha médica se captura en el mismo formulario */
  ficha?: DatosFicha;
}

/**
 * Alta / edición de los datos básicos de una persona cuidada. Devuelve DatosPersona con rol 'guardar'.
 * En el alta incluye la ficha médica (opcional); después se edita aparte, en Equipo.
 */
@Component({
  selector: 'app-persona-modal',
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
    IonNote,
    FichaCamposComponent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>{{ persona ? 'Editar datos' : 'Nueva persona' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()">
            {{ persona ? 'Guardar' : 'Crear' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (!persona) {
        <ion-note>Quedarás como responsable de su bitácora y podrás invitar al equipo.</ion-note>
      }

      <ion-input
        label="Nombre"
        labelPlacement="stacked"
        fill="outline"
        name="nombre"
        placeholder="Ej. Lupe, Mamá, Don Carlos"
        [(ngModel)]="nombre"
        autocapitalize="words"
        maxlength="60"
        class="campo"
      />

      <ion-input
        type="date"
        label="Fecha de nacimiento (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="fechaNacimiento"
        min="1900-01-01"
        [max]="hoy"
        [(ngModel)]="fechaNacimiento"
        [helperText]="edadTexto()"
        class="campo"
      />

      <ion-textarea
        label="Descripción (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="descripcion"
        placeholder="Ej. Mi mamá. Vive conmigo; camina con andadera y le gusta la radio por las mañanas."
        [autoGrow]="true"
        rows="4"
        [(ngModel)]="descripcion"
        autocapitalize="sentences"
        [counter]="true"
        maxlength="500"
        class="campo"
      />
      <ion-note color="medium">
        La descripción la ve todo el equipo de cuidado y le da contexto al asistente y al reporte.
      </ion-note>

      @if (!persona) {
        <h2 class="seccion">Ficha médica</h2>
        <ion-note color="medium">
          Lo que el equipo debe tener a mano en una emergencia. Todo es opcional: llena lo que sepas
          ahora y completa el resto después, en Equipo.
        </ion-note>
        <app-ficha-campos />
      }
    </ion-content>
  `,
  styles: [
    `
      .campo {
        margin-top: 16px;
      }
      ion-note {
        display: block;
        margin-top: 8px;
      }
      .seccion {
        margin: 28px 0 0;
        padding-top: 20px;
        border-top: 1px solid var(--ion-color-step-150, var(--ion-color-light-shade));
        font-size: 1.15rem;
        font-weight: 700;
      }
    `,
  ],
})
export class PersonaModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  /** Solo existe en el alta */
  private readonly ficha = viewChild(FichaCamposComponent);

  /** Se rellena desde componentProps al editar; null al dar de alta. */
  persona: PersonaCuidada | null = null;

  readonly hoy = formatDate(new Date(), 'yyyy-MM-dd', 'es');
  nombre = '';
  fechaNacimiento = '';
  descripcion = '';

  ngOnInit() {
    if (this.persona) {
      this.nombre = this.persona.nombre;
      this.fechaNacimiento = this.persona.fechaNacimiento ?? '';
      this.descripcion = this.persona.descripcion ?? '';
    }
  }

  /** "74 años" mientras se escribe la fecha; vacío si no hay fecha válida. */
  edadTexto(): string {
    const anios = edad(this.fechaNacimiento || null);
    if (anios === null) return '';
    if (anios < 0) return 'La fecha no puede ser futura';
    return `${anios} ${anios === 1 ? 'año' : 'años'}`;
  }

  valido(): boolean {
    if (!this.nombre.trim()) return false;
    if (this.ficha()?.valido() === false) return false;
    if (!this.fechaNacimiento) return true;
    const anios = edad(this.fechaNacimiento);
    return anios !== null && anios >= 0 && this.fechaNacimiento <= this.hoy && this.fechaNacimiento >= '1900-01-01';
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.valido()) return;
    const datos: DatosPersona = {
      nombre: this.nombre.trim(),
      fechaNacimiento: this.fechaNacimiento || undefined,
      descripcion: this.descripcion.trim() || undefined,
      ficha: this.ficha()?.datos(),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
