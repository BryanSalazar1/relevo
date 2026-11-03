import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonNote,
  IonTitle,
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { DIAS_SEMANA, Miembro, ROL_ETIQUETA, Turno } from '../../core/models';
import { textoDias } from '../../core/utils/fechas';
import {
  HORA_VALIDA,
  cruzaMedianoche,
  resumenCobertura,
  textoDuracionTurno,
  textoTurnos,
  turnosQueCubren,
  turnosTraslapados,
} from '../../core/utils/turnos';

/** Lo que devuelve el modal con rol 'guardar'. */
export interface DatosTurnos {
  turnos: Turno[];
}

/** Un turno mientras se edita: "todo el día" es explícito y al guardar se vuelve 00:00–00:00. */
interface TurnoEdicion extends Turno {
  todoElDia: boolean;
}

const TODOS = [1, 2, 3, 4, 5, 6, 0];
const ENTRE_SEMANA = [1, 2, 3, 4, 5];
const FIN_DE_SEMANA = [6, 0];
const HORARIO_NUEVO = { desde: '08:00', hasta: '16:00' };

const mismosDias = (a: number[], b: number[]) => a.length === b.length && b.every((d) => a.includes(d));

const aTurno = (t: TurnoEdicion): Turno => ({
  dias: [...new Set(t.dias)].sort((a, b) => a - b),
  desde: t.todoElDia ? '00:00' : t.desde,
  hasta: t.todoElDia ? '00:00' : t.hasta,
});

/**
 * Guardias de un miembro del equipo. Qué avisos recibe lo elige cada quien en Notificaciones.
 * Los recordatorios de tomas y tareas se envían solo a quien está de guardia (functions/logica.js).
 * Abajo se ven los turnos del resto del equipo y las horas que quedan sin nadie de guardia.
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
    IonIcon,
    IonInput,
    IonNote,
    IonToggle,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Turnos</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()"
            >Guardar</ion-button
          >
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <h2 class="quien">{{ miembro?.nombre || 'Miembro' }}</h2>
      <ion-note>
        Cuándo está de guardia. Los recordatorios de tomas y tareas solo le llegan en estos
        horarios.
      </ion-note>

      @for (t of turnos(); track $index; let i = $index) {
        <ion-card class="turno">
          <ion-card-content>
            <div class="etiqueta">Días</div>
            <div class="atajos">
              @for (a of atajos; track a.texto) {
                <button
                  type="button"
                  class="atajo"
                  [class.activo]="mismosDias(t.dias, a.dias)"
                  (click)="usarDias(i, a.dias)"
                >
                  {{ a.texto }}
                </button>
              }
            </div>
            <div class="dias" role="group" aria-label="Días de la semana">
              @for (d of diasSemana; track d.valor) {
                <button
                  type="button"
                  class="dia"
                  [class.activo]="t.dias.includes(d.valor)"
                  [attr.aria-pressed]="t.dias.includes(d.valor)"
                  [attr.aria-label]="d.nombre"
                  (click)="alternarDia(i, d.valor)"
                >
                  {{ d.corto }}
                </button>
              }
            </div>

            <ion-toggle
              class="todo-el-dia"
              [checked]="t.todoElDia"
              (ionChange)="cambiarTodoElDia(i, $any($event).detail.checked)"
              justify="space-between"
              >Todo el día (24 h)</ion-toggle
            >

            @if (!t.todoElDia) {
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
              </div>
            }

            <div class="pie">
              <ion-note [color]="problema(t) ? 'danger' : 'medium'" class="resumen">
                {{ problema(t) || resumen(t) }}
              </ion-note>
              <ion-button fill="clear" color="danger" size="small" (click)="quitar(i)">
                <ion-icon slot="start" name="trash-outline" />
                Quitar
              </ion-button>
            </div>
          </ion-card-content>
        </ion-card>
      } @empty {
        <ion-card class="turno">
          <ion-card-content>
            <p class="vacio">
              Sin turnos. Si nadie del equipo tiene turnos, todos reciben los recordatorios; si otros
              sí los tienen, esta persona no los recibirá.
            </p>
            <ion-button expand="block" (click)="agregarSiempre()">
              <ion-icon slot="start" name="time-outline" />
              Todos los días, las 24 h
            </ion-button>
            <ion-button expand="block" fill="outline" (click)="agregar()">
              <ion-icon slot="start" name="add" />
              Elegir días y horario
            </ion-button>
          </ion-card-content>
        </ion-card>
      }

      @if (traslape(); as t) {
        <ion-note color="danger" class="bloque">{{ t }}</ion-note>
      }

      @if (turnos().length > 0) {
        <ion-button fill="outline" size="small" (click)="agregar()">
          <ion-icon slot="start" name="add" />
          Agregar otro turno
        </ion-button>
      }

      <h3 class="equipo-titulo">Guardias del equipo</h3>
      @for (o of otros(); track o.uid) {
        <p class="otro">
          <strong>{{ o.nombre }}</strong> · {{ etiquetaRol(o) }}<br />
          <span>{{ textoTurnos(o.turnos) }}</span>
        </p>
      } @empty {
        <p class="otro"><span>Nadie más del equipo hace guardias.</span></p>
      }
      <ion-note color="medium" class="bloque cobertura">{{ cobertura() }}</ion-note>
    </ion-content>
  `,
  styles: [
    `
      ion-note {
        display: block;
      }
      .quien {
        margin: 0 0 4px;
        font-size: 1.15rem;
        font-weight: 700;
      }
      .turno {
        margin: 12px 0;
      }
      .etiqueta {
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--ion-color-medium);
        margin-bottom: 6px;
      }
      button {
        font: inherit;
        cursor: pointer;
      }
      .atajos {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
      }
      .atajo {
        border: 1px solid var(--ion-color-primary);
        background: transparent;
        color: var(--ion-color-primary);
        border-radius: 999px;
        padding: 4px 12px;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .dias {
        display: flex;
        gap: 4px;
      }
      .dia {
        flex: 1;
        min-width: 0;
        aspect-ratio: 1;
        max-width: 44px;
        border-radius: 50%;
        border: 1px solid var(--ion-color-medium);
        background: transparent;
        color: var(--ion-color-medium-shade);
        font-weight: 700;
      }
      .atajo.activo,
      .dia.activo {
        background: var(--ion-color-primary);
        border-color: var(--ion-color-primary);
        color: var(--ion-color-primary-contrast);
      }
      .todo-el-dia {
        margin-top: 12px;
        font-weight: 600;
      }
      .horas {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        ion-input {
          flex: 1;
          min-width: 0;
        }
      }
      .pie {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
      }
      .resumen {
        flex: 1;
      }
      .vacio {
        margin: 0 0 12px;
      }
      .bloque {
        margin: 12px 0;
      }
      .equipo-titulo {
        margin: 24px 0 8px;
        font-size: 1rem;
        font-weight: 700;
      }
      .otro {
        margin: 0 0 8px;
        span {
          color: var(--ion-color-medium-shade);
        }
      }
      .cobertura {
        font-weight: 600;
      }
    `,
  ],
})
export class TurnosModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellenan desde componentProps */
  miembro: Miembro | null = null;
  equipo: Miembro[] = [];

  readonly diasSemana = DIAS_SEMANA;
  readonly mismosDias = mismosDias;
  readonly textoTurnos = textoTurnos;
  readonly atajos = [
    { texto: 'Todos los días', dias: TODOS },
    { texto: 'Lunes a viernes', dias: ENTRE_SEMANA },
    { texto: 'Fin de semana', dias: FIN_DE_SEMANA },
  ];
  readonly turnos = signal<TurnoEdicion[]>([]);
  /** Turnos cuyas horas ya tocó el usuario: al marcar los 7 días no se le cambia a "todo el día" */
  private readonly horasEditadas = new Set<number>();

  /** El resto del equipo que hace guardias (el médico no) */
  readonly otros = computed(() =>
    this.equipo.filter((m) => m.uid !== this.miembro?.uid && m.rol !== 'medico'),
  );

  /** Cobertura de la semana con los turnos que se están editando */
  readonly cobertura = computed(() => {
    const yo = this.miembro ? [{ ...this.miembro, turnos: this.turnos().map(aTurno) }] : [];
    return (
      resumenCobertura(turnosQueCubren([...yo, ...this.otros()])) ??
      'Nadie tiene turnos: los recordatorios llegan a todos los que registran.'
    );
  });

  ngOnInit() {
    this.turnos.set(
      (this.miembro?.turnos ?? []).map((t) => ({
        dias: [...t.dias],
        desde: t.desde,
        hasta: t.hasta,
        todoElDia: t.desde === t.hasta,
      })),
    );
    this.turnos().forEach((t, i) => {
      if (!t.todoElDia) this.horasEditadas.add(i);
    });
  }

  etiquetaRol(m: Miembro): string {
    return ROL_ETIQUETA[m.rol];
  }

  private actualizar(i: number, cambio: (t: TurnoEdicion) => TurnoEdicion) {
    this.turnos.update((lista) => lista.map((t, k) => (k === i ? cambio(t) : t)));
  }

  agregar() {
    this.turnos.update((lista) => [...lista, { dias: [...ENTRE_SEMANA], ...HORARIO_NUEVO, todoElDia: false }]);
  }

  /** Atajo para quien cuida siempre (p. ej. un familiar que vive con la persona). */
  agregarSiempre() {
    this.turnos.update((lista) => [...lista, { dias: [...TODOS], ...HORARIO_NUEVO, todoElDia: true }]);
  }

  quitar(i: number) {
    this.turnos.update((lista) => lista.filter((_, k) => k !== i));
    const editadas = [...this.horasEditadas].filter((k) => k !== i).map((k) => (k > i ? k - 1 : k));
    this.horasEditadas.clear();
    editadas.forEach((k) => this.horasEditadas.add(k));
  }

  /** Todos los días no necesita horario: pasa a 24 h salvo que ya se hayan elegido horas. */
  private conDias(i: number, t: TurnoEdicion, dias: number[]): TurnoEdicion {
    const todos = dias.length === 7;
    return { ...t, dias, todoElDia: t.todoElDia || (todos && !this.horasEditadas.has(i)) };
  }

  usarDias(i: number, dias: number[]) {
    this.actualizar(i, (t) => this.conDias(i, t, [...dias]));
  }

  alternarDia(i: number, valor: number) {
    this.actualizar(i, (t) =>
      this.conDias(i, t, t.dias.includes(valor) ? t.dias.filter((d) => d !== valor) : [...t.dias, valor]),
    );
  }

  cambiarTodoElDia(i: number, todoElDia: boolean) {
    if (!todoElDia) this.horasEditadas.add(i);
    // Un turno de 24 h guardado trae 00:00–00:00: al pasar a horario se propone uno normal
    this.actualizar(i, (t) =>
      !todoElDia && t.desde === t.hasta ? { ...t, ...HORARIO_NUEVO, todoElDia } : { ...t, todoElDia },
    );
  }

  cambiarHora(i: number, campo: 'desde' | 'hasta', valor: unknown) {
    const m = String(valor ?? '').match(/(\d{1,2}):(\d{2})/);
    const hora = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
    this.horasEditadas.add(i);
    this.actualizar(i, (t) => ({ ...t, [campo]: hora }));
  }

  /** Qué le falta a un turno para poder guardarse, o null. */
  problema(t: TurnoEdicion): string | null {
    if (!t.dias.length) return 'Elige al menos un día.';
    if (t.todoElDia) return null;
    if (!HORA_VALIDA.test(t.desde) || !HORA_VALIDA.test(t.hasta)) return 'Escribe la hora de inicio y de fin.';
    if (t.desde === t.hasta) return 'La hora de fin debe ser distinta; para 24 h activa «Todo el día».';
    return null;
  }

  /** "L, M, X, J y V · 8 h" o "Todos los días · 24 h", con aviso si termina al día siguiente. */
  resumen(t: TurnoEdicion): string {
    if (t.todoElDia) return `${textoDias(t.dias)} · las 24 h`;
    const turno = aTurno(t);
    return `${textoDias(t.dias)} · ${textoDuracionTurno(turno)}${cruzaMedianoche(turno) ? ' · termina al día siguiente' : ''}`;
  }

  valido(): boolean {
    return this.turnos().every((t) => !this.problema(t)) && !this.traslape();
  }

  /** Texto del problema si dos turnos se pisan el mismo día (o null si no hay traslape). */
  traslape(): string | null {
    const dia = turnosTraslapados(this.turnos().filter((t) => !this.problema(t)).map(aTurno));
    if (dia === null) return null;
    const nombre = DIAS_SEMANA.find((d) => d.valor === dia)?.nombre ?? 'el mismo día';
    return `Dos turnos se traslapan el ${nombre}: ajusta las horas o los días.`;
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.valido()) return;
    const datos: DatosTurnos = { turnos: this.turnos().map(aTurno) };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
