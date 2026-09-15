import { DatePipe } from '@angular/common';
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
import { aIsoLocal, inicioDeDia } from '../../core/utils/fechas';

/** Cuánto tiempo atrás se puede fechar un registro nuevo (una hora). */
export const VENTANA_REGISTRO_MS = 60 * 60 * 1000;

/**
 * Límites para fechar un registro nuevo: entre hace una hora y ahora, sin salir del día de hoy
 * (si son las 00:30, el mínimo es 00:00). La fecha siempre es la de hoy; solo se elige la hora.
 */
export function ventanaRegistro(ahora = new Date()): { min: Date; max: Date } {
  const haceUnaHora = new Date(ahora.getTime() - VENTANA_REGISTRO_MS);
  const inicioHoy = inicioDeDia(ahora);
  return { min: haceUnaHora < inicioHoy ? inicioHoy : haceUnaHora, max: ahora };
}

/** Formulario para crear o editar un registro de la bitácora. Devuelve DatosEntrada con rol 'guardar'. */
@Component({
  selector: 'app-entrada-modal',
  imports: [
    DatePipe,
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
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!texto.trim()"
            >Guardar</ion-button
          >
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

      @if (entrada) {
        <!-- Al editar se conserva la fecha y hora originales del registro. -->
        <ion-item lines="none" class="fecha">
          <ion-label>
            <h3>Fecha y hora</h3>
            <p>{{ fechaOriginal | date: "EEEE d 'de' MMMM, HH:mm" }}</p>
          </ion-label>
        </ion-item>
      } @else {
        <ion-item lines="none" class="fecha">
          <ion-label>
            <h3>Hora</h3>
            <p>Hoy · se puede registrar hasta una hora atrás</p>
          </ion-label>
          <ion-datetime-button datetime="hora-entrada" />
        </ion-item>
        <ion-modal [keepContentsMounted]="true" (ionModalWillPresent)="actualizarLimites()">
          <ng-template>
            <ion-datetime
              id="hora-entrada"
              presentation="time"
              locale="es-MX"
              [min]="minIso()"
              [max]="maxIso()"
              name="fecha"
              [(ngModel)]="fechaIso"
              [showDefaultButtons]="true"
              doneText="Listo"
              cancelText="Cancelar"
            />
          </ng-template>
        </ion-modal>
      }
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
      .fecha h3 {
        font-weight: 500;
      }
      .fecha p {
        font-size: 0.8rem;
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
  /** Límites del selector de hora (se refrescan cada vez que se abre). */
  readonly minIso = signal(aIsoLocal(ventanaRegistro().min));
  readonly maxIso = signal(aIsoLocal(new Date()));
  texto = '';
  fechaIso = aIsoLocal(new Date());
  /** Fecha del registro que se edita; no se cambia desde el formulario. */
  fechaOriginal: Date | null = null;

  ngOnInit() {
    if (this.entrada) {
      this.tipo.set(this.entrada.tipo);
      this.texto = this.entrada.texto;
      this.fechaOriginal = this.entrada.fecha.toDate();
    }
  }

  /** Recalcula la ventana [hace una hora, ahora] y acerca la hora elegida si quedó fuera. */
  actualizarLimites() {
    const { min, max } = ventanaRegistro();
    this.minIso.set(aIsoLocal(min));
    this.maxIso.set(aIsoLocal(max));
    this.fechaIso = aIsoLocal(this.acotar(new Date(this.fechaIso), min, max));
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    const texto = this.texto.trim();
    if (!texto) return;
    const datos: DatosEntrada = {
      tipo: this.tipo(),
      texto,
      fecha: this.fechaOriginal ?? this.fechaElegida(),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }

  /** Hora elegida, siempre de hoy y dentro de la ventana permitida al momento de guardar. */
  private fechaElegida(): Date {
    const { min, max } = ventanaRegistro();
    const elegida = new Date(this.fechaIso);
    return this.acotar(isNaN(elegida.getTime()) ? max : elegida, min, max);
  }

  private acotar(d: Date, min: Date, max: Date): Date {
    if (isNaN(d.getTime()) || d > max) return max;
    if (d < min) return min;
    return d;
  }
}
