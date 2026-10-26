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
import {
  EntradaBitacora,
  Rol,
  TIPOS_ENTRADA,
  TipoEntrada,
  TipoEntradaInfo,
  tiposEntradaPara,
} from '../../core/models';
import { DatosEntrada } from '../../core/services/bitacora.service';
import { aIsoLocal } from '../../core/utils/fechas';

/** Cuánto tiempo atrás se puede fechar un registro nuevo: 12 horas, para cerrar un turno de noche. */
export const VENTANA_REGISTRO_MS = 12 * 60 * 60 * 1000;

/**
 * Límites para fechar un registro nuevo: entre hace 12 horas y ahora, aunque eso caiga en el día
 * anterior (quien escribe al terminar un turno nocturno fecha lo que pasó de madrugada).
 */
export function ventanaRegistro(ahora = new Date()): { min: Date; max: Date } {
  return { min: new Date(ahora.getTime() - VENTANA_REGISTRO_MS), max: ahora };
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
        <ion-title>{{ entrada ? (esMedico ? 'Editar indicación' : 'Editar registro') : (esMedico ? 'Nueva indicación' : 'Nuevo registro') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!texto.trim()"
            >Guardar</ion-button
          >
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      @if (esMedico) {
        <ion-note>
          Indicación para el equipo que cuida a {{ personaNombre || 'la persona' }}: la verán todos
          en Hoy y en la bitácora, y les llega como aviso importante.
        </ion-note>
      } @else {
        <ion-note>¿Qué pasó con {{ personaNombre || 'la persona cuidada' }}?</ion-note>
      }
      <!-- Con un solo tipo posible (el médico) no hay nada que elegir -->
      @if (tipos.length > 1) {
        <div class="tipos">
          @for (t of tipos; track t.valor) {
            <ion-chip [outline]="tipo() !== t.valor" [color]="t.color" (click)="tipo.set(t.valor)">
              <ion-icon [name]="t.icono" />
              <ion-label>{{ t.etiqueta }}</ion-label>
            </ion-chip>
          }
        </div>
      }

      @if (tipo() === 'incidente') {
        <ion-note>¿Fue una caída?</ion-note>
        <div class="tipos">
          <ion-chip [outline]="caida() !== true" color="danger" (click)="caida.set(true)">
            <ion-label>Sí, fue una caída</ion-label>
          </ion-chip>
          <ion-chip [outline]="caida() !== false" color="medium" (click)="caida.set(false)">
            <ion-label>No</ion-label>
          </ion-chip>
        </div>
        @if (caida()) {
          <ion-note>¿Hubo lesión (golpe, herida o dolor después)?</ion-note>
          <div class="tipos">
            <ion-chip [outline]="lesion() !== true" color="danger" (click)="lesion.set(true)">
              <ion-label>Sí</ion-label>
            </ion-chip>
            <ion-chip [outline]="lesion() !== false" color="medium" (click)="lesion.set(false)">
              <ion-label>No</ion-label>
            </ion-chip>
          </div>
        }
      }

      <ion-textarea
        [label]="esMedico ? 'Indicación' : 'Descripción'"
        labelPlacement="stacked"
        fill="outline"
        [autoGrow]="true"
        rows="4"
        name="texto"
        maxlength="2000"
        [counter]="true"
        [(ngModel)]="texto"
        [placeholder]="
          esMedico
            ? 'Ej. Subir Losartán a 100 mg desde mañana; tomar la presión en ayunas 7 días; cita de control en 2 semanas.'
            : 'Ej. Desayunó bien; a las 10 se quejó de dolor de cabeza…'
        "
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
            <h3>Fecha y hora</h3>
            <p>Hasta 12 horas atrás, aunque sea de ayer</p>
          </ion-label>
          <ion-datetime-button datetime="hora-entrada" />
        </ion-item>
        <ion-modal [keepContentsMounted]="true" (ionModalWillPresent)="actualizarLimites()">
          <ng-template>
            <ion-datetime
              id="hora-entrada"
              presentation="date-time"
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
  /** Rol de quien escribe: decide qué tipos se ofrecen (el médico solo indicaciones) */
  rol: Rol | null = null;

  /** El médico ve el formulario como "indicación", con sus textos */
  get esMedico(): boolean {
    return this.rol === 'medico';
  }

  tipos: TipoEntradaInfo[] = TIPOS_ENTRADA;
  readonly tipo = signal<TipoEntrada>('nota');
  /** Solo incidentes: si fue una caída y si hubo lesión (null = sin contestar) */
  readonly caida = signal<boolean | null>(null);
  readonly lesion = signal<boolean | null>(null);
  /** Límites del selector de hora (se refrescan cada vez que se abre). */
  readonly minIso = signal(aIsoLocal(ventanaRegistro().min));
  readonly maxIso = signal(aIsoLocal(new Date()));
  texto = '';
  fechaIso = aIsoLocal(new Date());
  /** Fecha del registro que se edita; no se cambia desde el formulario. */
  fechaOriginal: Date | null = null;

  ngOnInit() {
    this.tipos = tiposEntradaPara(this.rol);
    if (this.entrada) {
      this.tipo.set(this.entrada.tipo);
      this.texto = this.entrada.texto;
      this.fechaOriginal = this.entrada.fecha.toDate();
      if (typeof this.entrada.caida === 'boolean') this.caida.set(this.entrada.caida);
      if (typeof this.entrada.lesion === 'boolean') this.lesion.set(this.entrada.lesion);
    } else if (!this.tipos.some((t) => t.valor === this.tipo())) {
      // El médico solo tiene "Indicación médica": queda elegida de entrada
      this.tipo.set(this.tipos[0]?.valor ?? 'nota');
    }
  }

  /** Recalcula la ventana [hace 12 horas, ahora] y acerca la fecha elegida si quedó fuera. */
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
    const incidente = this.tipo() === 'incidente';
    const caida = incidente ? this.caida() : null;
    const datos: DatosEntrada = {
      tipo: this.tipo(),
      texto,
      fecha: this.fechaOriginal ?? this.fechaElegida(),
      // Solo se guarda lo que se contestó; una caída sin contestar la lesión cuenta como sin lesión
      ...(caida === null ? {} : { caida, lesion: caida && this.lesion() === true }),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }

  /** Fecha y hora elegidas, dentro de la ventana permitida al momento de guardar. */
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
