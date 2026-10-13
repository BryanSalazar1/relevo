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
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import {
  AVISO_MIN_POR_DEFECTO,
  DIAS_SEMANA,
  OPCIONES_AVISO_MIN,
  OPCIONES_DURACION_MIN,
  TIPOS_SIGNO,
  TIPOS_TAREA,
  TIPOS_TAREA_TODOS,
  Tarea,
  TipoSigno,
  TipoTarea,
  TipoTareaInfo,
} from '../../core/models';
import { DatosTarea } from '../../core/services/tareas.service';
import { rangoHorario, textoDias, textoDuracion } from '../../core/utils/fechas';

/** Alta / edición de una tarea de la rutina. Devuelve DatosTarea con rol 'guardar'. */
/** Horarios por tarea (el mismo tope que firestore.rules). */
const MAX_HORARIOS = 12;

@Component({
  selector: 'app-tarea-modal',
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
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>{{ tarea ? 'Editar tarea' : 'Nueva tarea' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()"
            >Guardar</ion-button
          >
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note>Tipo de tarea</ion-note>
      <div class="tipos">
        @for (t of tipos; track t.valor) {
          <ion-chip [outline]="tipo() !== t.valor" [color]="t.color" (click)="elegirTipo(t.valor)">
            <ion-icon [name]="t.icono" />
            <ion-label>{{ t.etiqueta }}</ion-label>
          </ion-chip>
        }
      </div>

      <ion-input
        label="Nombre"
        labelPlacement="stacked"
        fill="outline"
        name="nombre"
        placeholder="Ej. Desayuno, Baño de esponja, Caminata"
        [(ngModel)]="nombre"
        autocapitalize="sentences"
        maxlength="60"
        class="ion-margin-bottom"
      />

      @if (tipo() === 'signos') {
        <ion-note>Qué se mide</ion-note>
        <div class="tipos">
          @for (s of tiposSigno; track s.valor) {
            <ion-chip
              [outline]="!signos().includes(s.valor)"
              color="danger"
              (click)="alternarSigno(s.valor)"
            >
              <ion-label>{{ s.etiqueta }}</ion-label>
            </ion-chip>
          }
        </div>
        <ion-note color="medium" class="ayuda-dias">
          Al marcar la tarea como hecha se piden estas mediciones y se guardan para el reporte.
        </ion-note>
      }

      <ion-note>Días de la semana</ion-note>
      <div class="dias">
        @for (d of diasSemana; track d.valor) {
          <ion-chip
            [outline]="!dias().includes(d.valor)"
            color="primary"
            (click)="alternarDia(d.valor)"
            [attr.aria-label]="d.nombre"
          >
            {{ d.corto }}
          </ion-chip>
        }
      </div>
      <ion-note color="medium" class="ayuda-dias">{{ textoDias(dias()) }}</ion-note>

      <ion-note>Horarios</ion-note>
      <div class="horarios">
        @for (h of horarios(); track h) {
          <ion-chip color="primary" (click)="quitarHora(h)">
            <ion-label>{{ rangoHorario(h, duracionMin) }}</ion-label>
            <ion-icon name="close-circle" />
          </ion-chip>
        } @empty {
          <ion-note color="medium">Agrega al menos una hora.</ion-note>
        }
      </div>
      <div class="agregar-hora">
        <ion-input
          type="time"
          label="Nueva hora"
          labelPlacement="stacked"
          fill="outline"
          name="nuevaHora"
          [(ngModel)]="nuevaHora"
        />
        <ion-button fill="outline" (click)="agregarHora()" [disabled]="!nuevaHora"
          >Agregar</ion-button
        >
      </div>
      @if (errorHora()) {
        <ion-note color="danger" class="error-hora">{{ errorHora() }}</ion-note>
      }

      <ion-select
        label="Duración de cada horario"
        labelPlacement="stacked"
        fill="outline"
        interface="popover"
        name="duracionMin"
        [(ngModel)]="duracionMin"
        class="ion-margin-bottom"
      >
        @for (d of opcionesDuracion; track d) {
          <ion-select-option [value]="d">{{ textoDuracion(d) }}</ion-select-option>
        }
      </ion-select>

      <ion-select
        label="Avisar al cuidador"
        labelPlacement="stacked"
        fill="outline"
        interface="popover"
        name="avisarMin"
        [(ngModel)]="avisarMin"
        class="ion-margin-bottom"
      >
        @for (m of opcionesAviso; track m) {
          <ion-select-option [value]="m">{{ m }} minutos antes</ion-select-option>
        }
      </ion-select>

      <ion-textarea
        label="Notas (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="notas"
        placeholder="Ej. Dieta blanda; ayudarle a levantarse…"
        [autoGrow]="true"
        rows="2"
        maxlength="300"
        [counter]="true"
        [(ngModel)]="notas"
      />
    </ion-content>
  `,
  styles: [
    `
      .error-hora {
        display: block;
        margin: 4px 0 8px;
      }
      .tipos {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 8px 0 16px;
      }
      .dias {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 6px 0 2px;
        ion-chip {
          min-width: 40px;
          justify-content: center;
          font-weight: 600;
        }
      }
      .ayuda-dias {
        display: block;
        margin-bottom: 14px;
      }
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
export class TareaModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellena desde componentProps al editar */
  tarea: Tarea | null = null;

  /** Tipos que se ofrecen; al editar una tarea de un tipo que ya no se ofrece (cita), ese también */
  tipos: TipoTareaInfo[] = TIPOS_TAREA;
  readonly tiposSigno = TIPOS_SIGNO;
  readonly diasSemana = DIAS_SEMANA;
  readonly textoDias = textoDias;
  readonly opcionesAviso = OPCIONES_AVISO_MIN;
  readonly opcionesDuracion = OPCIONES_DURACION_MIN;
  readonly rangoHorario = rangoHorario;
  readonly textoDuracion = textoDuracion;
  duracionMin = 0;
  /** Días de la semana elegidos (Date.getDay()); por defecto todos */
  readonly dias = signal<number[]>(DIAS_SEMANA.map((d) => d.valor));
  readonly tipo = signal<TipoTarea>('comida');
  readonly horarios = signal<string[]>([]);
  /** Solo en tareas de signos vitales: qué se mide (por defecto, lo más común en casa) */
  readonly signos = signal<TipoSigno[]>(['presion', 'glucosa']);
  nombre = '';
  nuevaHora = '';
  avisarMin = AVISO_MIN_POR_DEFECTO;
  notas = '';

  ngOnInit() {
    if (this.tarea) {
      const actual = this.tarea.tipo;
      if (!TIPOS_TAREA.some((t) => t.valor === actual)) {
        this.tipos = TIPOS_TAREA_TODOS.filter((t) => TIPOS_TAREA.includes(t) || t.valor === actual);
      }
      this.tipo.set(this.tarea.tipo);
      this.nombre = this.tarea.nombre;
      this.horarios.set([...(this.tarea.horarios ?? [])]);
      if (this.tarea.dias?.length) this.dias.set([...this.tarea.dias]);
      this.avisarMin = this.tarea.avisarMin ?? AVISO_MIN_POR_DEFECTO;
      this.duracionMin = this.tarea.duracionMin ?? 0;
      if (this.tarea.signos?.length) this.signos.set([...this.tarea.signos]);
      this.notas = this.tarea.notas ?? '';
    }
  }

  valido(): boolean {
    const conSignos = this.tipo() !== 'signos' || this.signos().length > 0;
    return (
      !!this.nombre.trim() && this.horarios().length > 0 && this.dias().length > 0 && conSignos
    );
  }

  /** Al elegir "Signos vitales" en una tarea sin nombre se propone el que casi siempre llevará. */
  elegirTipo(valor: TipoTarea) {
    this.tipo.set(valor);
    if (valor === 'signos' && !this.nombre.trim()) this.nombre = 'Revisar signos vitales';
  }

  alternarSigno(valor: TipoSigno) {
    this.signos.update((s) => (s.includes(valor) ? s.filter((x) => x !== valor) : [...s, valor]));
  }

  alternarDia(valor: number) {
    this.dias.update((d) => (d.includes(valor) ? d.filter((x) => x !== valor) : [...d, valor]));
  }

  readonly errorHora = signal('');

  agregarHora() {
    const m = String(this.nuevaHora).match(/(\d{1,2}):(\d{2})/);
    const hora = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) this.errorHora.set('Esa hora no es válida.');
    else if (this.horarios().includes(hora)) this.errorHora.set(`Las ${hora} ya están en la lista.`);
    else if (this.horarios().length >= MAX_HORARIOS) this.errorHora.set(`Máximo ${MAX_HORARIOS} horarios al día.`);
    else {
      this.errorHora.set('');
      this.horarios.update((h) => [...h, hora].sort());
      this.nuevaHora = '';
    }
  }

  quitarHora(hora: string) {
    this.errorHora.set('');
    this.horarios.update((h) => h.filter((x) => x !== hora));
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    if (!this.valido()) return;
    const datos: DatosTarea = {
      tipo: this.tipo(),
      nombre: this.nombre.trim(),
      horarios: this.horarios(),
      avisarMin: Number(this.avisarMin) || AVISO_MIN_POR_DEFECTO,
      dias: [...this.dias()].sort((a, b) => a - b),
      duracionMin: Number(this.duracionMin) || 0,
      // En el orden en que se capturan; las demás tareas no llevan signos
      signos:
        this.tipo() === 'signos'
          ? TIPOS_SIGNO.map((s) => s.valor).filter((v) => this.signos().includes(v))
          : [],
      notas: this.notas.trim(),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
