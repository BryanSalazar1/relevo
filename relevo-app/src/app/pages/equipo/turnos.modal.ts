import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonNote,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { DIAS_SEMANA, Miembro, Turno } from '../../core/models';
import { textoDias } from '../../core/utils/fechas';

/** Lo que devuelve el modal con rol 'guardar'. */
export interface DatosTurnos {
  turnos: Turno[];
}

const TURNO_NUEVO: Turno = { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '16:00' };

/** "HH:mm" de 00:00 a 23:59. */
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Día de la semana (0–6) en el que dos turnos se pisan, o null si ninguno. Un turno nocturno
 * (hasta <= desde) ocupa de `desde` a medianoche ese día y de medianoche a `hasta` el siguiente.
 */
export function turnosTraslapados(turnos: Turno[]): number | null {
  const tramos: { dia: number; desde: number; hasta: number; turno: number }[] = [];
  turnos.forEach((t, i) => {
    if (!HORA_VALIDA.test(t.desde) || !HORA_VALIDA.test(t.hasta)) return;
    const desde = minutos(t.desde);
    const hasta = minutos(t.hasta);
    for (const dia of t.dias) {
      if (desde < hasta) tramos.push({ dia, desde, hasta, turno: i });
      else {
        tramos.push({ dia, desde, hasta: 24 * 60, turno: i });
        tramos.push({ dia: (dia + 1) % 7, desde: 0, hasta, turno: i });
      }
    }
  });
  for (let a = 0; a < tramos.length; a++) {
    for (let b = a + 1; b < tramos.length; b++) {
      const x = tramos[a];
      const y = tramos[b];
      if (x.turno === y.turno || x.dia !== y.dia) continue;
      if (x.desde < y.hasta && y.desde < x.hasta) return x.dia;
    }
  }
  return null;
}

/**
 * Guardias de un miembro del equipo. Qué avisos recibe lo elige cada quien en Notificaciones.
 * Los recordatorios de tomas y tareas se envían solo a quien está de guardia (functions/logica.js).
 */
@Component({
  selector: 'app-turnos-modal',
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonCard,
    IonCardContent,
    IonChip,
    IonIcon,
    IonInput,
    IonNote,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Turnos de {{ miembro?.nombre || 'miembro' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()"
            >Guardar</ion-button
          >
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note>
        Cuándo está de guardia. Los recordatorios de tomas y tareas solo le llegan en estos
        horarios.
      </ion-note>

      @for (t of turnos(); track $index; let i = $index) {
        <ion-card class="turno">
          <ion-card-content>
            <div class="dias">
              @for (d of diasSemana; track d.valor) {
                <ion-chip
                  [outline]="!t.dias.includes(d.valor)"
                  color="primary"
                  (click)="alternarDia(i, d.valor)"
                  [attr.aria-label]="d.nombre"
                >
                  {{ d.corto }}
                </ion-chip>
              }
            </div>
            <ion-note color="medium" class="resumen">{{ textoDias(t.dias) }}</ion-note>
            <div class="horas">
              <ion-input
                type="time"
                label="Desde"
                labelPlacement="stacked"
                fill="outline"
                [name]="'desde' + i"
                [ngModel]="t.desde"
                (ngModelChange)="cambiarHora(i, 'desde', $event)"
              />
              <ion-input
                type="time"
                label="Hasta"
                labelPlacement="stacked"
                fill="outline"
                [name]="'hasta' + i"
                [ngModel]="t.hasta"
                (ngModelChange)="cambiarHora(i, 'hasta', $event)"
              />
              <ion-button fill="clear" color="danger" (click)="quitar(i)" aria-label="Quitar turno">
                <ion-icon slot="icon-only" name="trash-outline" />
              </ion-button>
            </div>
            @if (cruzaMedianoche(t)) {
              <ion-note color="medium">Termina al día siguiente.</ion-note>
            }
          </ion-card-content>
        </ion-card>
      } @empty {
        <ion-note color="medium" class="bloque">
          Sin turnos. Si nadie del equipo tiene turnos, todos reciben los recordatorios; si otros sí
          los tienen, esta persona no recibirá recordatorios de rutina.
        </ion-note>
      }

      @if (traslape(); as t) {
        <ion-note color="danger" class="bloque">{{ t }}</ion-note>
      }

      <ion-button fill="outline" size="small" (click)="agregar()">
        <ion-icon slot="start" name="add" />
        Agregar turno
      </ion-button>

    </ion-content>
  `,
  styles: [
    `
      ion-note {
        display: block;
      }
      .turno {
        margin: 12px 0;
      }
      .dias {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        ion-chip {
          min-width: 40px;
          justify-content: center;
          font-weight: 600;
        }
      }
      .resumen {
        margin: 4px 0 8px;
      }
      .horas {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        ion-input {
          flex: 1;
          min-width: 0;
        }
      }
      .bloque {
        margin: 12px 0;
      }
    `,
  ],
})
export class TurnosModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellena desde componentProps */
  miembro: Miembro | null = null;

  readonly diasSemana = DIAS_SEMANA;
  readonly textoDias = textoDias;
  readonly turnos = signal<Turno[]>([]);

  ngOnInit() {
    this.turnos.set((this.miembro?.turnos ?? []).map((t) => ({ ...t, dias: [...t.dias] })));
  }

  agregar() {
    this.turnos.update((lista) => [...lista, { ...TURNO_NUEVO, dias: [...TURNO_NUEVO.dias] }]);
  }

  quitar(i: number) {
    this.turnos.update((lista) => lista.filter((_, k) => k !== i));
  }

  alternarDia(i: number, valor: number) {
    this.turnos.update((lista) =>
      lista.map((t, k) =>
        k !== i
          ? t
          : {
              ...t,
              dias: t.dias.includes(valor) ? t.dias.filter((d) => d !== valor) : [...t.dias, valor],
            },
      ),
    );
  }

  cambiarHora(i: number, campo: 'desde' | 'hasta', valor: unknown) {
    const m = String(valor ?? '').match(/(\d{1,2}):(\d{2})/);
    const hora = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
    this.turnos.update((lista) => lista.map((t, k) => (k === i ? { ...t, [campo]: hora } : t)));
  }

  cruzaMedianoche(t: Turno): boolean {
    return !!t.desde && !!t.hasta && t.hasta <= t.desde;
  }

  valido(): boolean {
    return (
      this.turnos().every(
        (t) =>
          t.dias.length > 0 &&
          HORA_VALIDA.test(t.desde) &&
          HORA_VALIDA.test(t.hasta) &&
          t.desde !== t.hasta,
      ) && !this.traslape()
    );
  }

  /** Texto del problema si dos turnos se pisan el mismo día (o null si no hay traslape). */
  traslape(): string | null {
    const dia = turnosTraslapados(this.turnos());
    if (dia === null) return null;
    const nombre = DIAS_SEMANA.find((d) => d.valor === dia)?.nombre ?? 'el mismo día';
    return `Dos turnos se traslapan el ${nombre}: ajusta las horas o los días.`;
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.valido()) return;
    const datos: DatosTurnos = {
      turnos: this.turnos().map((t) => ({
        ...t,
        dias: [...new Set(t.dias)].sort((a, b) => a - b),
      })),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
