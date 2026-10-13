import { Component, OnInit, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
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

/**
 * Campos de la ficha médica, sin encabezado ni botones: los comparten el alta de una persona
 * (pages/home/persona.modal.ts) y "Editar ficha médica" en Equipo (ficha.modal.ts).
 * Quien lo usa lee el resultado con `datos()`.
 */
/** Teléfono aceptable: vacío, o de 7 a 15 dígitos con espacios, guiones, paréntesis o un + inicial. */
export function telefonoValido(telefono: string | null | undefined): boolean {
  const t = (telefono ?? '').trim();
  if (!t) return true;
  if (!/^\+?[\d\s().-]+$/.test(t)) return false;
  const digitos = t.replace(/\D/g, '').length;
  return digitos >= 7 && digitos <= 15;
}

@Component({
  selector: 'app-ficha-campos',
  imports: [
    FormsModule,
    IonButton,
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
      errorText="Revisa el teléfono: de 7 a 15 dígitos."
      [class.ion-invalid]="!telefonoValido(telefonoMedico)"
      [class.ion-touched]="!telefonoValido(telefonoMedico)"
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
              errorText="De 7 a 15 dígitos"
              [class.ion-invalid]="!telefonoValido(c.telefono)"
              [class.ion-touched]="!telefonoValido(c.telefono)"
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
  `,
  styles: [
    `
      :host {
        display: block;
      }
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
export class FichaCamposComponent implements OnInit {
  /** Ficha con la que se rellena el formulario (al editar); sin ella empieza vacío (alta) */
  readonly inicial = input<Partial<DatosFicha> | null>(null);

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
    const p = this.inicial();
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

  /**
   * La ficha tal como se guarda. Un texto vacío sale `undefined` (al actualizar borra el campo).
   * Lo escrito en "Nueva condición" / "Nueva alergia" sin tocar Agregar también cuenta: es fácil
   * olvidarlo al guardar.
   */
  /** Un teléfono vacío vale; si hay algo escrito, debe tener de 7 a 15 dígitos (se admiten espacios, guiones, paréntesis y +). */
  telefonoValido(telefono: string | null | undefined): boolean {
    return telefonoValido(telefono);
  }

  /** La ficha se puede guardar: los teléfonos escritos tienen sentido. */
  valido(): boolean {
    return telefonoValido(this.telefonoMedico) && this.contactos().every((c) => telefonoValido(c.telefono));
  }

  datos(): DatosFicha {
    this.agregar('condiciones');
    this.agregar('alergias');
    const texto = (v: string) => v.trim() || undefined;
    return {
      tipoSangre: texto(this.tipoSangre),
      condiciones: this.condiciones(),
      alergias: this.alergias(),
      medicoTratante: texto(this.medicoTratante),
      telefonoMedico: texto(this.telefonoMedico),
      seguro: texto(this.seguro),
      hospital: texto(this.hospital),
      notasMedicas: texto(this.notasMedicas),
      contactosEmergencia: this.contactos()
        .map((c) => {
          const relacion = c.relacion?.trim();
          // Sin `relacion: undefined`: Firestore rechaza un undefined dentro de una lista
          return {
            nombre: c.nombre.trim(),
            telefono: c.telefono.trim(),
            ...(relacion ? { relacion } : {}),
          };
        })
        .filter((c) => c.nombre || c.telefono),
    };
  }
}
