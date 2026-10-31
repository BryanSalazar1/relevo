import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonInput,
  IonLabel,
  IonNote,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import {
  LIMITES_DIASTOLICA,
  MOMENTOS_GLUCOSA,
  MomentoGlucosa,
  TIPOS_SIGNO,
  TipoSigno,
  TipoSignoInfo,
} from '../../core/models';
import { Medicion, resumenMediciones } from '../../core/services/signos.service';
import { NOTA_MAX } from '../../core/utils/notas';

/** Momento de la glucosa que se propone según la hora: antes de las 10, en ayunas; desde las 21, antes de dormir. */
export function momentoSugerido(ahora = new Date()): MomentoGlucosa | null {
  const h = ahora.getHours();
  if (h < 10) return 'ayunas';
  if (h >= 21) return 'antes_dormir';
  return null;
}

/** Lo que devuelve el modal con rol 'guardar'. */
export interface DatosSignos {
  mediciones: Medicion[];
  nota?: string;
}

/** Indicaciones para medir bien la presión en casa (ESH, AHA). */
export const PASOS_MEDIR_PRESION = [
  '30 minutos antes: sin café, cigarro ni ejercicio, y con la vejiga vacía.',
  'Sentado, con la espalda apoyada y los pies en el piso, sin cruzar las piernas.',
  'Descansar 5 minutos en silencio antes de medir; no hablar durante la medición.',
  'Brazo apoyado en una mesa, con el manguito sobre la piel a la altura del corazón.',
  'Tomar 2 mediciones con 1 minuto de diferencia y anotar el promedio.',
  'De preferencia a la misma hora cada día (por la mañana, antes de los medicamentos).',
];

/**
 * Captura de signos vitales al marcar como hecha una tarea de tipo "Signos vitales".
 * Solo pide los signos que el responsable eligió para esa tarea. Todo es opcional: lo que no se
 * midió se deja vacío.
 */
@Component({
  selector: 'app-signos-modal',
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
    IonChip,
    IonLabel,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Signos vitales</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()">Guardar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note>{{ titulo }}. Escribe lo que mediste (al menos una medición); lo que no, déjalo vacío.</ion-note>

      @for (s of signos; track s.valor) {
        @if (s.valor === 'presion') {
          <ion-note class="titulo">{{ s.etiqueta }}</ion-note>
          <!-- Cómo medir bien en casa (guías de presión en casa: ESH, AHA): una medición mal tomada
               cambia el promedio que ve el médico -->
          <details class="como-medir" open>
            <summary>Antes de medir la presión</summary>
            <ul>
              @for (paso of pasosPresion; track paso) {
                <li>{{ paso }}</li>
              }
            </ul>
          </details>
          <div class="presion">
            <ion-input
              type="number"
              inputmode="numeric"
              label="Alta (sistólica)"
              labelPlacement="stacked"
              fill="outline"
              name="presion"
              [placeholder]="'Ej. ' + s.ejemplo"
              [(ngModel)]="valores[s.valor]"
            />
            <span class="barra">/</span>
            <ion-input
              type="number"
              inputmode="numeric"
              label="Baja (diastólica)"
              labelPlacement="stacked"
              fill="outline"
              name="diastolica"
              placeholder="Ej. 80"
              [(ngModel)]="diastolica"
            />
            <span class="unidad">{{ s.unidad }}</span>
          </div>
        } @else {
          <div class="signo">
            <ion-input
              type="number"
              [attr.inputmode]="s.decimales ? 'decimal' : 'numeric'"
              [label]="s.etiqueta"
              labelPlacement="stacked"
              fill="outline"
              [name]="s.valor"
              [placeholder]="'Ej. ' + s.ejemplo"
              [(ngModel)]="valores[s.valor]"
            />
            <span class="unidad">{{ s.unidad }}</span>
          </div>
          @if (s.valor === 'glucosa') {
            <div class="momento">
              @for (m of momentos; track m.valor) {
                <ion-chip
                  [outline]="momento() !== m.valor"
                  color="primary"
                  (click)="momento.set(momento() === m.valor ? null : m.valor)"
                >
                  <ion-label>{{ m.etiqueta }}</ion-label>
                </ion-chip>
              }
            </div>
          }
        }
        @if (error(s); as e) {
          <ion-note color="danger" class="error">{{ e }}</ion-note>
        }
      }

      <ion-textarea
        label="Nota (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="nota"
        placeholder="Ej. En ayunas; se sentía mareada; brazo izquierdo…"
        [autoGrow]="true"
        rows="2"
        [(ngModel)]="nota"
        autocapitalize="sentences"
        [maxlength]="notaMax"
        class="nota"
      />
      @if (resumen(); as r) {
        <ion-note color="medium" class="resumen">Se guardará: {{ r }}</ion-note>
      }
    </ion-content>
  `,
  styles: [
    `
      .como-medir {
        margin: 6px 0 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--ion-color-light);
        font-size: 0.9rem;
      }
      .como-medir summary {
        font-weight: 600;
        cursor: pointer;
      }
      .como-medir ul {
        margin: 8px 0 0;
        padding-left: 18px;
      }
      .como-medir li {
        margin: 3px 0;
      }
    `,
    `
      ion-note {
        display: block;
      }
      .signo,
      .presion {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 14px;
        ion-input {
          flex: 1;
          min-width: 0;
        }
      }
      .titulo {
        margin: 16px 0 -8px;
        font-weight: 600;
        color: var(--ion-text-color);
      }
      .momento {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 6px 0 0;
      }
      .barra {
        font-size: 1.6rem;
        color: var(--ion-color-medium);
      }
      .unidad {
        min-width: 48px;
        color: var(--ion-color-medium);
      }
      .error {
        margin: 4px 0 0;
        font-size: 0.8rem;
      }
      .nota {
        margin-top: 18px;
      }
      .resumen {
        margin-top: 10px;
      }
    `,
  ],
})
export class SignosModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /**
   * Cómo medir la presión en casa para que el valor sirva (guías de medición en casa de la ESH y la
   * AHA). Se muestran antes de capturarla; se pueden ocultar.
   */
  readonly pasosPresion = PASOS_MEDIR_PRESION;

  /** Se rellenan desde componentProps */
  titulo = 'Signos vitales';
  /** Qué signos pide esta tarea; vacío = todos */
  tipos: TipoSigno[] = [];

  signos: TipoSignoInfo[] = TIPOS_SIGNO;
  readonly notaMax = NOTA_MAX;
  readonly momentos = MOMENTOS_GLUCOSA;
  /** Lo escrito en cada campo (ion-input entrega texto o número) */
  valores: Partial<Record<TipoSigno, number | string | null>> = {};
  diastolica: number | string | null = null;
  /** Momento de la glucosa (propuesto por la hora; se puede cambiar o quitar) */
  readonly momento = signal<MomentoGlucosa | null>(momentoSugerido());
  nota = '';

  ngOnInit() {
    if (this.tipos?.length) this.signos = TIPOS_SIGNO.filter((s) => this.tipos.includes(s.valor));
  }

  /** Número escrito en un campo, o null si está vacío. NaN si no es un número. */
  private numero(v: number | string | null | undefined): number | null {
    if (v === '' || v === null || v === undefined) return null;
    return Number(v);
  }

  /** Por qué no se acepta lo escrito en ese signo ('' si está bien o vacío). */
  error(s: TipoSignoInfo): string {
    const v = this.numero(this.valores[s.valor]);
    const fuera = (n: number, min: number, max: number) => !Number.isFinite(n) || n < min || n > max;
    if (s.valor === 'presion') {
      const d = this.numero(this.diastolica);
      if (v === null && d === null) return '';
      if (v === null || d === null) return 'Escribe los dos números de la presión (ej. 120 / 80).';
      if (fuera(v, s.min, s.max) || fuera(d, LIMITES_DIASTOLICA.min, LIMITES_DIASTOLICA.max)) {
        return `Revisa la presión: la alta va de ${s.min} a ${s.max} y la baja de ${LIMITES_DIASTOLICA.min} a ${LIMITES_DIASTOLICA.max}.`;
      }
      return d >= v ? 'La baja (diastólica) debe ser menor que la alta.' : '';
    }
    if (v === null) return '';
    return fuera(v, s.min, s.max) ? `Revisa el valor: debe estar entre ${s.min} y ${s.max} ${s.unidad}.` : '';
  }

  /** Sin errores y con al menos una medición: una tarea de signos "hecha" sin mediciones no tiene sentido. */
  valido(): boolean {
    return this.signos.every((s) => !this.error(s)) && this.mediciones().length > 0;
  }

  private mediciones(): Medicion[] {
    const redondear = (n: number, decimales: number) => Math.round(n * 10 ** decimales) / 10 ** decimales;
    return this.signos.flatMap((s): Medicion[] => {
      const v = this.numero(this.valores[s.valor]);
      if (v === null || this.error(s)) return [];
      const valor = redondear(v, s.decimales);
      if (s.valor === 'presion') {
        return [{ tipo: s.valor, valor, valorSecundario: redondear(this.numero(this.diastolica)!, 0) }];
      }
      if (s.valor === 'glucosa') return [{ tipo: s.valor, valor, momento: this.momento() }];
      return [{ tipo: s.valor, valor }];
    });
  }

  resumen(): string {
    return resumenMediciones(this.mediciones());
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.valido()) return;
    const datos: DatosSignos = { mediciones: this.mediciones(), nota: this.nota.trim() || undefined };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
