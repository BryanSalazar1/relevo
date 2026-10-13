import { Component, OnInit, inject } from '@angular/core';
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
import { LIMITES_DIASTOLICA, TIPOS_SIGNO, TipoSigno, TipoSignoInfo } from '../../core/models';
import { Medicion, resumenMediciones } from '../../core/services/signos.service';
import { NOTA_MAX } from '../../core/utils/notas';

/** Lo que devuelve el modal con rol 'guardar'. */
export interface DatosSignos {
  mediciones: Medicion[];
  nota?: string;
}

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

  /** Se rellenan desde componentProps */
  titulo = 'Signos vitales';
  /** Qué signos pide esta tarea; vacío = todos */
  tipos: TipoSigno[] = [];

  signos: TipoSignoInfo[] = TIPOS_SIGNO;
  readonly notaMax = NOTA_MAX;
  /** Lo escrito en cada campo (ion-input entrega texto o número) */
  valores: Partial<Record<TipoSigno, number | string | null>> = {};
  diastolica: number | string | null = null;
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
      return s.valor === 'presion'
        ? [{ tipo: s.valor, valor, valorSecundario: redondear(this.numero(this.diastolica)!, 0) }]
        : [{ tipo: s.valor, valor }];
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
