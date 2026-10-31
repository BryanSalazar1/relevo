import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { MOTIVOS_TOMA, Medicamento, MotivoToma } from '../../core/models';
import { DetalleToma } from '../../core/services/medicamentos.service';
import { NOTA_MAX } from '../../core/utils/notas';
import { RevisionToma, textoHoy, textoIndicacion } from '../../core/utils/segun-necesidad';

/** Lo que devuelve la ventana al registrar (rol 'registrar'). */
export interface DatosTomaSegunNecesidad extends DetalleToma {
  nota?: string;
}

/**
 * Registrar una toma de un medicamento según necesidad: muestra la indicación del médico, cuántas
 * van hoy y los avisos si se pasa del máximo o del intervalo (avisa, no impide), y pide el motivo y,
 * si es dolor, su intensidad. Todo lo que pide es opcional.
 */
@Component({
  selector: 'app-toma-segun-necesidad-modal',
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonChip,
    IonLabel,
    IonNote,
    IonTextarea,
    IonIcon,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Registrar toma</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <h2 class="nombre">{{ medicamento.nombre }} <span>{{ medicamento.dosis }} · ahora</span></h2>

      @if (indicacion) {
        <div class="indicacion">
          <ion-icon name="document-text-outline" aria-hidden="true" />
          <div>
            <strong>Indicación del médico</strong>
            <p>{{ indicacion }}</p>
          </div>
        </div>
      }

      <p class="estado">{{ hoyTexto }} · {{ ultimaTexto }}</p>

      @for (aviso of avisos; track aviso) {
        <div class="aviso" role="alert">
          <ion-icon name="warning-outline" aria-hidden="true" />
          <span>{{ aviso }}</span>
        </div>
      }

      <ion-note class="titulo">¿Por qué se da? (opcional)</ion-note>
      <div class="chips">
        @for (m of motivos; track m.valor) {
          <ion-chip [outline]="motivo() !== m.valor" color="primary" (click)="elegirMotivo(m.valor)">
            <ion-label>{{ m.etiqueta }}</ion-label>
          </ion-chip>
        }
      </div>

      @if (motivo() === 'dolor') {
        <ion-note class="titulo">¿Qué tan fuerte es el dolor? (0 = nada, 10 = el peor)</ion-note>
        <div class="escala">
          @for (n of escala; track n) {
            <ion-chip [outline]="intensidad() !== n" color="warning" (click)="intensidad.set(intensidad() === n ? null : n)">
              <ion-label>{{ n }}</ion-label>
            </ion-chip>
          }
        </div>
      }

      <ion-textarea
        label="Nota (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="nota"
        placeholder="Ej. dolor de rodilla al caminar"
        [autoGrow]="true"
        rows="2"
        [maxlength]="notaMax"
        [(ngModel)]="nota"
      />

      <ion-button expand="block" class="registrar" [color]="avisos.length ? 'warning' : 'primary'" (click)="registrar()">
        {{ avisos.length ? 'Registrar de todos modos' : 'Registrar toma' }}
      </ion-button>
    </ion-content>
  `,
  styles: [
    `
      .nombre {
        margin: 0 0 10px;
        font-size: 1.25rem;
      }
      .nombre span {
        font-size: 0.95rem;
        font-weight: 400;
        color: var(--ion-color-medium);
      }
      .indicacion {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--ion-color-light);
        margin-bottom: 10px;
      }
      .indicacion ion-icon {
        font-size: 1.3rem;
        color: var(--ion-color-primary);
        flex: none;
        margin-top: 2px;
      }
      .indicacion p {
        margin: 2px 0 0;
      }
      .estado {
        margin: 0 0 10px;
        color: var(--ion-color-medium-shade);
      }
      .aviso {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        padding: 10px 12px;
        border-radius: 12px;
        margin-bottom: 8px;
        background: rgba(var(--ion-color-warning-rgb), 0.18);
        color: var(--ion-color-dark);
        font-weight: 600;
      }
      .aviso ion-icon {
        color: var(--ion-color-warning-shade);
        font-size: 1.2rem;
        flex: none;
      }
      .titulo {
        display: block;
        margin: 12px 0 4px;
      }
      .chips,
      .escala {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        margin-bottom: 6px;
      }
      .escala ion-chip {
        min-width: 42px;
        justify-content: center;
      }
      ion-textarea {
        margin-top: 10px;
      }
      .registrar {
        margin-top: 16px;
      }
    `,
  ],
})
export class TomaSegunNecesidadModal {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellenan desde componentProps */
  medicamento!: Medicamento;
  revision!: RevisionToma;
  /** Avisos a mostrar (los de la revisión más, p. ej., el de inventario en 0) */
  avisos: string[] = [];
  /** "Última toma: hace 3 h (10:15) · Ana" */
  ultimaTexto = '';

  readonly motivos = MOTIVOS_TOMA;
  readonly escala = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly notaMax = NOTA_MAX;
  readonly motivo = signal<MotivoToma | null>(null);
  readonly intensidad = signal<number | null>(null);
  nota = '';

  get indicacion(): string {
    return textoIndicacion(this.medicamento);
  }

  get hoyTexto(): string {
    return textoHoy(this.revision.tomadasHoy, this.revision.maxAlDia);
  }

  elegirMotivo(m: MotivoToma) {
    this.motivo.set(this.motivo() === m ? null : m);
    if (this.motivo() !== 'dolor') this.intensidad.set(null);
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  registrar() {
    const motivo = this.motivo() ?? undefined;
    const intensidad = motivo === 'dolor' ? (this.intensidad() ?? undefined) : undefined;
    const datos: DatosTomaSegunNecesidad = {
      ...(motivo ? { motivo } : {}),
      ...(intensidad !== undefined ? { intensidad } : {}),
      ...(this.nota.trim() ? { nota: this.nota.trim() } : {}),
    };
    void this.modalCtrl.dismiss(datos, 'registrar');
  }
}
