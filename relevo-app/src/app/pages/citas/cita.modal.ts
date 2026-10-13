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
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import {
  AVISO_CITA_MIN_POR_DEFECTO,
  EventoCalendario,
  Miembro,
  OPCIONES_AVISO_CITA_MIN,
  OPCIONES_DURACION_CITA_MIN,
  TIPOS_EVENTO,
  TipoEvento,
} from '../../core/models';
import { DatosEvento } from '../../core/services/eventos.service';
import { textoAnticipacion, textoDuracion } from '../../core/utils/fechas';

/** Alta / edición de una cita del calendario. Devuelve DatosEvento con rol 'guardar'. */
@Component({
  selector: 'app-cita-modal',
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
        <ion-title>{{ evento ? 'Editar cita' : 'Nueva cita' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()"
            >Guardar</ion-button
          >
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note>Tipo</ion-note>
      <div class="tipos">
        @for (t of tipos; track t.valor) {
          <ion-chip [outline]="tipo() !== t.valor" [color]="t.color" (click)="tipo.set(t.valor)">
            <ion-icon [name]="t.icono" />
            <ion-label>{{ t.etiqueta }}</ion-label>
          </ion-chip>
        }
      </div>

      <ion-input
        label="Título"
        labelPlacement="stacked"
        fill="outline"
        name="titulo"
        placeholder="Ej. Cardiólogo, Análisis de sangre, Fisioterapia"
        [(ngModel)]="titulo"
        autocapitalize="sentences"
        maxlength="80"
        class="campo"
      />

      <div class="cuando">
        <ion-input
          type="date"
          label="Fecha"
          labelPlacement="stacked"
          fill="outline"
          name="fecha"
          [(ngModel)]="fecha"
          [min]="fechaMin"
          (ionInput)="revisar()"
        />
        <ion-input
          type="time"
          label="Hora"
          labelPlacement="stacked"
          fill="outline"
          name="hora"
          [(ngModel)]="hora"
          (ionInput)="revisar()"
        />
      </div>
      @if (error()) {
        <ion-note color="danger" class="error">{{ error() }}</ion-note>
      }

      <ion-select
        label="Duración"
        labelPlacement="stacked"
        fill="outline"
        interface="popover"
        name="duracionMin"
        [(ngModel)]="duracionMin"
        class="campo"
      >
        @for (d of opcionesDuracion; track d) {
          <ion-select-option [value]="d">{{ textoDuracion(d) }}</ion-select-option>
        }
      </ion-select>

      <ion-input
        label="Lugar (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="lugar"
        placeholder="Ej. Hospital Ángeles, consultorio 4"
        [(ngModel)]="lugar"
        autocapitalize="sentences"
        maxlength="120"
        class="campo"
      />

      <ion-select
        label="Quién acompaña"
        labelPlacement="stacked"
        fill="outline"
        interface="popover"
        name="responsableUid"
        [(ngModel)]="responsableUid"
        class="campo"
      >
        <ion-select-option [value]="null">Nadie en particular</ion-select-option>
        @for (m of miembros; track m.uid) {
          <ion-select-option [value]="m.uid">{{ m.nombre }}</ion-select-option>
        }
      </ion-select>

      <ion-select
        label="Avisar al equipo"
        labelPlacement="stacked"
        fill="outline"
        interface="popover"
        name="avisarMin"
        [(ngModel)]="avisarMin"
        class="campo"
      >
        @for (m of opcionesAviso; track m) {
          <ion-select-option [value]="m">{{ textoAnticipacion(m) }}</ion-select-option>
        }
      </ion-select>

      <ion-textarea
        label="Notas (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="notas"
        placeholder="Ej. Llevar el reporte de la semana; ir en ayunas…"
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
      .tipos {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 8px 0 16px;
      }
      .campo {
        margin-bottom: 16px;
      }
      .cuando {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        ion-input {
          flex: 1;
        }
      }
      .error {
        display: block;
        margin: -8px 0 12px;
      }
    `,
  ],
})
export class CitaModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellenan desde componentProps: la cita a editar (null = nueva) y el equipo para "acompaña" */
  evento: EventoCalendario | null = null;
  miembros: Miembro[] = [];

  readonly tipos = TIPOS_EVENTO;
  readonly opcionesAviso = OPCIONES_AVISO_CITA_MIN;
  opcionesDuracion: number[] = OPCIONES_DURACION_CITA_MIN;
  readonly textoDuracion = textoDuracion;
  readonly textoAnticipacion = textoAnticipacion;

  readonly tipo = signal<TipoEvento>('cita');
  readonly error = signal('');
  titulo = '';
  fecha = '';
  hora = '';
  duracionMin = 60;
  lugar = '';
  responsableUid: string | null = null;
  avisarMin = AVISO_CITA_MIN_POR_DEFECTO;
  notas = '';
  /** Una cita nueva no se agenda en el pasado; al editar se respeta la fecha que tenga */
  fechaMin: string | null = null;

  ngOnInit() {
    if (this.evento) {
      const inicio = this.evento.inicio.toDate();
      this.tipo.set(this.evento.tipo === 'terapia' ? 'terapia' : 'cita');
      this.titulo = this.evento.titulo;
      this.fecha = formatDate(inicio, 'yyyy-MM-dd', 'es');
      this.hora = formatDate(inicio, 'HH:mm', 'es');
      const duracion = Math.round((this.evento.fin.toDate().getTime() - inicio.getTime()) / 60000);
      this.duracionMin = duracion > 0 ? duracion : 60;
      if (!this.opcionesDuracion.includes(this.duracionMin)) {
        this.opcionesDuracion = [...this.opcionesDuracion, this.duracionMin].sort((a, b) => a - b);
      }
      this.lugar = this.evento.lugar ?? '';
      this.responsableUid = this.evento.responsableUid ?? null;
      this.avisarMin = this.evento.avisarMin ?? AVISO_CITA_MIN_POR_DEFECTO;
      this.notas = this.evento.notas ?? '';
    } else {
      this.fechaMin = formatDate(new Date(), 'yyyy-MM-dd', 'es');
    }
  }

  /** Fecha y hora elegidas como Date local; null si falta algo o no es válido */
  inicio(): Date | null {
    const f = String(this.fecha).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const h = String(this.hora).match(/(\d{1,2}):(\d{2})/);
    if (!f || !h) return null;
    const d = new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  /** Avisa si una cita nueva quedó en el pasado (al editar una pasada no se reclama). */
  revisar() {
    const inicio = this.inicio();
    if (!this.evento && inicio && inicio.getTime() < Date.now()) {
      this.error.set('Esa fecha y hora ya pasaron.');
    } else {
      this.error.set('');
    }
  }

  valido(): boolean {
    const inicio = this.inicio();
    if (!this.titulo.trim() || !inicio) return false;
    return !!this.evento || inicio.getTime() >= Date.now();
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    const inicio = this.inicio();
    if (!this.valido() || !inicio) return;
    const duracion = Number(this.duracionMin) > 0 ? Number(this.duracionMin) : 60;
    const datos: DatosEvento = {
      tipo: this.tipo(),
      titulo: this.titulo.trim(),
      inicio,
      fin: new Date(inicio.getTime() + duracion * 60000),
      lugar: this.lugar.trim(),
      notas: this.notas.trim(),
      responsableUid: this.responsableUid || null,
      avisarMin: Number(this.avisarMin) >= 0 ? Number(this.avisarMin) : AVISO_CITA_MIN_POR_DEFECTO,
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
