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
  IonLabel,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { ContactoEmergencia, PersonaCuidada, TIPOS_SANGRE } from '../../core/models';

/** Campos de la ficha médica que edita el responsable. */
export type DatosFicha = Pick<
  PersonaCuidada,
  | 'tipoSangre'
  | 'alergias'
  | 'condiciones'
  | 'medicoTratante'
  | 'telefonoMedico'
  | 'seguro'
  | 'hospital'
  | 'notasMedicas'
  | 'contactosEmergencia'
>;

type Lista = 'alergias' | 'condiciones';

/** Ficha médica de la persona cuidada. Devuelve DatosFicha con rol 'guardar'. */
@Component({
  selector: 'app-ficha-modal',
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
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTextarea,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>Ficha médica</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()">Guardar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-note
        >Datos de {{ persona?.nombre || 'la persona' }} que todo el equipo debe tener a
        mano.</ion-note
      >

      <ion-select
        label="Tipo de sangre"
        labelPlacement="stacked"
        fill="outline"
        interface="popover"
        name="tipoSangre"
        [(ngModel)]="tipoSangre"
        placeholder="Sin registrar"
        class="campo"
      >
        <ion-select-option value="">Sin registrar</ion-select-option>
        @for (t of tiposSangre; track t) {
          <ion-select-option [value]="t">{{ t }}</ion-select-option>
        }
      </ion-select>

      <ion-note class="titulo">Condiciones y diagnósticos</ion-note>
      <div class="chips">
        @for (c of condiciones(); track c) {
          <ion-chip color="danger" (click)="quitar('condiciones', c)">
            <ion-label>{{ c }}</ion-label>
            <ion-icon name="close-circle" />
          </ion-chip>
        } @empty {
          <ion-note color="medium">Ninguna registrada.</ion-note>
        }
      </div>
      <div class="agregar">
        <ion-input
          label="Nueva condición"
          labelPlacement="stacked"
          fill="outline"
          name="nuevaCondicion"
          placeholder="Ej. Diabetes tipo 2"
          [(ngModel)]="nuevaCondicion"
          (keyup.enter)="agregar('condiciones')"
        />
        <ion-button
          fill="outline"
          (click)="agregar('condiciones')"
          [disabled]="!nuevaCondicion.trim()"
          >Agregar</ion-button
        >
      </div>

      <ion-note class="titulo">Alergias</ion-note>
      <div class="chips">
        @for (a of alergias(); track a) {
          <ion-chip color="warning" (click)="quitar('alergias', a)">
            <ion-label>{{ a }}</ion-label>
            <ion-icon name="close-circle" />
          </ion-chip>
        } @empty {
          <ion-note color="medium">Ninguna registrada.</ion-note>
        }
      </div>
      <div class="agregar">
        <ion-input
          label="Nueva alergia"
          labelPlacement="stacked"
          fill="outline"
          name="nuevaAlergia"
          placeholder="Ej. Penicilina"
          [(ngModel)]="nuevaAlergia"
          (keyup.enter)="agregar('alergias')"
        />
        <ion-button fill="outline" (click)="agregar('alergias')" [disabled]="!nuevaAlergia.trim()"
          >Agregar</ion-button
        >
      </div>

      <ion-note class="titulo">Atención médica</ion-note>
      <ion-input
        label="Médico tratante"
        labelPlacement="stacked"
        fill="outline"
        name="medico"
        placeholder="Ej. Dra. Ana López, geriatra"
        [(ngModel)]="medicoTratante"
        autocapitalize="words"
        class="campo"
      />
      <ion-input
        type="tel"
        label="Teléfono del médico"
        labelPlacement="stacked"
        fill="outline"
        name="telefonoMedico"
        placeholder="Ej. 33 1234 5678"
        [(ngModel)]="telefonoMedico"
        class="campo"
      />
      <ion-input
        label="Seguro médico"
        labelPlacement="stacked"
        fill="outline"
        name="seguro"
        placeholder="Ej. IMSS, número de afiliación…"
        [(ngModel)]="seguro"
        class="campo"
      />
      <ion-input
        label="Hospital o clínica"
        labelPlacement="stacked"
        fill="outline"
        name="hospital"
        placeholder="Ej. Hospital Civil, urgencias"
        [(ngModel)]="hospital"
        autocapitalize="words"
        class="campo"
      />
      <ion-textarea
        label="Notas médicas"
        labelPlacement="stacked"
        fill="outline"
        name="notasMedicas"
        placeholder="Ej. Usa marcapasos; dieta sin sal; camina con andadera; no puede tomar ibuprofeno."
        [autoGrow]="true"
        rows="3"
        [(ngModel)]="notasMedicas"
        autocapitalize="sentences"
        [counter]="true"
        maxlength="600"
        class="campo"
      />

      <ion-note class="titulo">Contactos de emergencia</ion-note>
      @for (c of contactos(); track $index; let i = $index) {
        <ion-card class="contacto">
          <ion-card-content>
            <ion-input
              label="Nombre"
              labelPlacement="stacked"
              fill="outline"
              [name]="'cnombre' + i"
              [ngModel]="c.nombre"
              (ngModelChange)="cambiarContacto(i, 'nombre', $event)"
              autocapitalize="words"
              class="campo"
            />
            <div class="fila">
              <ion-input
                type="tel"
                label="Teléfono"
                labelPlacement="stacked"
                fill="outline"
                [name]="'ctel' + i"
                [ngModel]="c.telefono"
                (ngModelChange)="cambiarContacto(i, 'telefono', $event)"
              />
              <ion-input
                label="Relación"
                labelPlacement="stacked"
                fill="outline"
                [name]="'crel' + i"
                placeholder="Hija, vecino…"
                [ngModel]="c.relacion"
                (ngModelChange)="cambiarContacto(i, 'relacion', $event)"
              />
              <ion-button
                fill="clear"
                color="danger"
                (click)="quitarContacto(i)"
                aria-label="Quitar contacto"
              >
                <ion-icon slot="icon-only" name="trash-outline" />
              </ion-button>
            </div>
          </ion-card-content>
        </ion-card>
      } @empty {
        <ion-note color="medium" class="bloque"
          >Sin contactos. Agrega a quién llamar en una emergencia.</ion-note
        >
      }
      <ion-button fill="outline" size="small" (click)="agregarContacto()">
        <ion-icon slot="start" name="add" />
        Agregar contacto
      </ion-button>
    </ion-content>
  `,
  styles: [
    `
      ion-note {
        display: block;
      }
      .titulo {
        margin: 18px 0 6px;
        font-weight: 600;
        color: var(--ion-text-color);
      }
      .campo {
        margin-top: 12px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        min-height: 32px;
        align-items: center;
      }
      .agregar {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        margin-top: 6px;
        ion-input {
          flex: 1;
        }
      }
      .contacto {
        margin: 8px 0;
      }
      .fila {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        margin-top: 12px;
        ion-input {
          flex: 1;
          min-width: 0;
        }
      }
      .bloque {
        margin: 8px 0;
      }
    `,
  ],
})
export class FichaModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellena desde componentProps */
  persona: PersonaCuidada | null = null;

  readonly tiposSangre = TIPOS_SANGRE;
  readonly condiciones = signal<string[]>([]);
  readonly alergias = signal<string[]>([]);
  readonly contactos = signal<ContactoEmergencia[]>([]);
  tipoSangre = '';
  nuevaCondicion = '';
  nuevaAlergia = '';
  medicoTratante = '';
  telefonoMedico = '';
  seguro = '';
  hospital = '';
  notasMedicas = '';

  ngOnInit() {
    const p = this.persona;
    if (!p) return;
    this.tipoSangre = p.tipoSangre ?? '';
    this.condiciones.set([...(p.condiciones ?? [])]);
    this.alergias.set([...(p.alergias ?? [])]);
    this.contactos.set((p.contactosEmergencia ?? []).map((c) => ({ ...c })));
    this.medicoTratante = p.medicoTratante ?? '';
    this.telefonoMedico = p.telefonoMedico ?? '';
    this.seguro = p.seguro ?? '';
    this.hospital = p.hospital ?? '';
    this.notasMedicas = p.notasMedicas ?? '';
  }

  private lista(cual: Lista) {
    return cual === 'alergias' ? this.alergias : this.condiciones;
  }

  agregar(cual: Lista) {
    const valor = (cual === 'alergias' ? this.nuevaAlergia : this.nuevaCondicion).trim();
    if (!valor) return;
    this.lista(cual).update((l) =>
      l.some((x) => x.toLowerCase() === valor.toLowerCase()) ? l : [...l, valor],
    );
    if (cual === 'alergias') this.nuevaAlergia = '';
    else this.nuevaCondicion = '';
  }

  quitar(cual: Lista, valor: string) {
    this.lista(cual).update((l) => l.filter((x) => x !== valor));
  }

  agregarContacto() {
    this.contactos.update((l) => [...l, { nombre: '', telefono: '', relacion: '' }]);
  }

  quitarContacto(i: number) {
    this.contactos.update((l) => l.filter((_, k) => k !== i));
  }

  cambiarContacto(i: number, campo: keyof ContactoEmergencia, valor: unknown) {
    this.contactos.update((l) =>
      l.map((c, k) => (k === i ? { ...c, [campo]: String(valor ?? '') } : c)),
    );
  }

  cancelar() {
    void this.modalCtrl.dismiss(null, 'cancelar');
  }

  guardar() {
    const texto = (v: string) => v.trim() || undefined;
    const datos: DatosFicha = {
      tipoSangre: texto(this.tipoSangre),
      condiciones: this.condiciones(),
      alergias: this.alergias(),
      medicoTratante: texto(this.medicoTratante),
      telefonoMedico: texto(this.telefonoMedico),
      seguro: texto(this.seguro),
      hospital: texto(this.hospital),
      notasMedicas: texto(this.notasMedicas),
      contactosEmergencia: this.contactos()
        .map((c) => ({
          nombre: c.nombre.trim(),
          telefono: c.telefono.trim(),
          relacion: c.relacion?.trim() || undefined,
        }))
        .filter((c) => c.nombre || c.telefono),
    };
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
