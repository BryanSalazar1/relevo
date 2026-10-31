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
  IonToggle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { Medicamento } from '../../core/models';
import {
  DatosMedicamento,
  HORARIO_VALIDO,
  LIMITES_MEDICAMENTO,
  finTratamiento,
  unidadesRestantes,
} from '../../core/services/medicamentos.service';
import { claveDia, sumarDias } from '../../core/utils/fechas';
import { LIMITES_SEGUN_NECESIDAD, textoIndicacion } from '../../core/utils/segun-necesidad';

/** Minutos mínimos entre dos horarios del mismo medicamento. */
const SEPARACION_MIN = 30;

/** Alta / edición de un medicamento. Devuelve DatosMedicamento con rol 'guardar'. */
@Component({
  selector: 'app-medicamento-modal',
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
    IonToggle,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelar()">Cancelar</ion-button>
        </ion-buttons>
        <ion-title>{{ medicamento ? 'Editar medicamento' : 'Nuevo medicamento' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button [strong]="true" (click)="guardar()" [disabled]="!valido()">Guardar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-input
        label="Nombre"
        labelPlacement="stacked"
        fill="outline"
        name="nombre"
        placeholder="Ej. Losartán"
        [(ngModel)]="nombre"
        [maxlength]="L.nombre"
        (ionBlur)="tocado.nombre = true"
        autocapitalize="sentences"
        [class.ion-margin-bottom]="!verError('nombre')"
      />
      @if (verError('nombre')) {
        <ion-note color="danger" class="error">{{ errorNombre() }}</ion-note>
      }
      <ion-input
        label="Dosis"
        labelPlacement="stacked"
        fill="outline"
        name="dosis"
        placeholder="Ej. 50 mg, 1 tableta"
        [(ngModel)]="dosis"
        [maxlength]="L.dosis"
        (ionBlur)="tocado.dosis = true"
        [class.ion-margin-bottom]="!verError('dosis')"
      />
      @if (verError('dosis')) {
        <ion-note color="danger" class="error">{{ errorDosis() }}</ion-note>
      }

      <ion-toggle
        name="segunNecesidad"
        [(ngModel)]="segunNecesidad"
        labelPlacement="start"
        justify="space-between"
        class="ion-margin-bottom"
      >
        <div>
          Sin horario fijo
          <ion-note class="ayuda">Solo cuando lo necesite (p. ej. si siente dolor)</ion-note>
        </div>
      </ion-toggle>

      @if (segunNecesidad) {
        <ion-note color="medium" class="ayuda-bloque">
          Cada toma se registra en el momento desde la sección "Según necesidad". No se programan
          avisos.
        </ion-note>
        <!-- Indicación del médico: la app la recuerda al dar la dosis y avisa (sin impedir) si se pasa -->
        <ion-note class="titulo-indicacion">Indicación del médico (opcional)</ion-note>
        <ion-input
          label="Cuándo darlo"
          labelPlacement="stacked"
          fill="outline"
          name="condicion"
          placeholder="Ej. si hay dolor"
          [(ngModel)]="condicion"
          [maxlength]="LP.condicion"
          [counter]="true"
          class="ion-margin-bottom"
        />
        <div class="limites">
          <ion-input
            type="number"
            inputmode="numeric"
            label="Máximo al día"
            labelPlacement="stacked"
            fill="outline"
            name="maxAlDia"
            placeholder="Ej. 3"
            [(ngModel)]="maxAlDia"
            [min]="LP.maxAlDia.min"
            [max]="LP.maxAlDia.max"
          />
          <ion-input
            type="number"
            inputmode="numeric"
            label="Horas entre tomas"
            labelPlacement="stacked"
            fill="outline"
            name="horasEntreTomas"
            placeholder="Ej. 8"
            [(ngModel)]="horasEntreTomas"
            [min]="LP.horasEntreTomas.min"
            [max]="LP.horasEntreTomas.max"
          />
        </div>
        @if (errorLimites(); as e) {
          <ion-note color="danger" class="error">{{ e }}</ion-note>
        } @else if (indicacionTexto(); as t) {
          <ion-note color="medium" class="ayuda-bloque">Se mostrará al dar la dosis: {{ t }}.</ion-note>
        }
      } @else {
        <ion-note>Horarios de toma</ion-note>
        <div class="horarios">
          @for (h of horarios(); track h) {
            <ion-chip color="primary" (click)="quitarHora(h)">
              <ion-label>{{ h }}</ion-label>
              <ion-icon name="close-circle" />
            </ion-chip>
          } @empty {
            <ion-note color="medium">Agrega al menos una hora.</ion-note>
          }
        </div>
        <div class="agregar-hora" [class.con-error]="!!errorHora()">
          <ion-input type="time" label="Nueva hora" labelPlacement="stacked" fill="outline" name="nuevaHora" [(ngModel)]="nuevaHora" (ionInput)="errorHora.set('')" />
          <ion-button fill="outline" (click)="agregarHora()" [disabled]="!nuevaHora">Agregar</ion-button>
        </div>
        @if (errorHora()) {
          <ion-note color="danger" class="error">{{ errorHora() }}</ion-note>
        }
      }

      <ion-note>Duración del tratamiento</ion-note>
      <div class="duracion">
        <ion-input
          type="date"
          label="Empieza el"
          labelPlacement="stacked"
          fill="outline"
          name="inicio"
          [(ngModel)]="inicio"
          [min]="inicioMin"
          [max]="inicioMax"
        />
        <ion-select
          label="Duración"
          labelPlacement="stacked"
          fill="outline"
          interface="popover"
          name="modoDuracion"
          [(ngModel)]="modoDuracion"
        >
          <ion-select-option value="indefinido">Hasta que el médico lo indique</ion-select-option>
          <ion-select-option value="dias">Cierto número de días</ion-select-option>
        </ion-select>
      </div>
      @if (errorInicio()) {
        <ion-note color="danger" class="error">{{ errorInicio() }}</ion-note>
      }
      @if (modoDuracion === 'dias') {
        <ion-input
          type="number"
          inputmode="numeric"
          label="Número de días"
          labelPlacement="stacked"
          fill="outline"
          name="duracionDias"
          [(ngModel)]="duracionDias"
          min="1"
          [max]="L.duracionDias"
          [helperText]="finTexto()"
          [class.ion-margin-bottom]="!errorDias()"
        />
        @if (errorDias()) {
          <ion-note color="danger" class="error">{{ errorDias() }}</ion-note>
        }
      } @else {
        <ion-note color="medium" class="ayuda-bloque">
          Aparecerá todos los días hasta que lo suspendas o lo elimines.
        </ion-note>
      }

      <ion-input
        type="number"
        inputmode="numeric"
        label="Inventario (unidades restantes)"
        labelPlacement="stacked"
        fill="outline"
        name="inventario"
        placeholder="Déjalo vacío si no lo controlas"
        [(ngModel)]="inventario"
        (ionInput)="inventarioIlegible = entradaIlegible($event)"
        min="0"
        [max]="L.inventario"
        [helperText]="inventarioTexto()"
        [class.ion-margin-bottom]="!errorInventario()"
      />
      @if (errorInventario()) {
        <ion-note color="danger" class="error">{{ errorInventario() }}</ion-note>
      }
      <ion-textarea
        label="Notas (opcional)"
        labelPlacement="stacked"
        fill="outline"
        name="notas"
        [placeholder]="segunNecesidad ? 'Ej. Con agua; no dar con el estómago vacío' : 'Ej. Con alimentos; no combinar con…'"
        [autoGrow]="true"
        rows="2"
        [counter]="true"
        [maxlength]="L.notas"
        [(ngModel)]="notas"
      />
      @if (errorNotas()) {
        <ion-note color="danger" class="error">{{ errorNotas() }}</ion-note>
      }
    </ion-content>
  `,
  styles: [
    `
      .titulo-indicacion {
        display: block;
        margin: 4px 0 8px;
        font-weight: 600;
      }
      .limites {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 6px;
      }
    `,
    `
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
        &.con-error {
          margin-bottom: 0;
        }
      }
      .error {
        display: block;
        margin: 4px 0 16px;
        font-size: 0.8rem;
      }
      ion-toggle .ayuda {
        display: block;
        font-size: 0.8rem;
      }
      .duracion {
        display: flex;
        gap: 8px;
        margin: 6px 0 12px;
        ion-input,
        ion-select {
          flex: 1;
          min-width: 0;
        }
      }
      .ayuda-bloque {
        display: block;
        margin-bottom: 16px;
      }
    `,
  ],
})
export class MedicamentoModal implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Se rellena desde componentProps al editar */
  medicamento: Medicamento | null = null;
  /** Los medicamentos que ya tiene la persona, para no dar de alta uno repetido (componentProps) */
  existentes: Medicamento[] = [];

  readonly L = LIMITES_MEDICAMENTO;
  nombre = '';
  dosis = '';
  nuevaHora = '';
  segunNecesidad = false;
  readonly hoy = formatDate(new Date(), 'yyyy-MM-dd', 'es');
  readonly inicioMin = '2000-01-01';
  readonly inicioMax = formatDate(sumarDias(new Date(), 365), 'yyyy-MM-dd', 'es');
  inicio = this.hoy;
  modoDuracion: 'indefinido' | 'dias' = 'indefinido';
  duracionDias: number | string | null = 7;
  inventario: number | string | null = null;
  /** Lo escrito en Inventario no es un número (el campo lo entrega como vacío) */
  inventarioIlegible = false;
  notas = '';
  /** Según necesidad: indicación del médico (texto y límites opcionales) */
  condicion = '';
  maxAlDia: number | string | null = null;
  horasEntreTomas: number | string | null = null;
  readonly LP = LIMITES_SEGUN_NECESIDAD;
  /** Valores con que se abrió el formulario al editar: si no se tocan, no se envían (otro teléfono
   *  pudo descontar tomas mientras tanto, y un medicamento antiguo sin inicio debe seguir sin él). */
  private inventarioInicial: number | null = null;
  private inicioInicial?: string;
  readonly horarios = signal<string[]>([]);
  /** Por qué no se agregó la última hora (repetida, muy cercana a otra, demasiadas…) */
  readonly errorHora = signal('');
  /** Los campos obligatorios no muestran su error hasta que se pasa por ellos */
  readonly tocado = { nombre: false, dosis: false };

  ngOnInit() {
    if (this.medicamento) {
      this.nombre = this.medicamento.nombre;
      this.dosis = this.medicamento.dosis;
      this.horarios.set([...(this.medicamento.horarios ?? [])]);
      this.segunNecesidad = this.medicamento.segunNecesidad === true;
      this.inicio = this.medicamento.inicio ?? this.hoy;
      if (this.medicamento.duracionDias && this.medicamento.duracionDias > 0) {
        this.modoDuracion = 'dias';
        this.duracionDias = this.medicamento.duracionDias;
      }
      this.inventario = unidadesRestantes(this.medicamento);
      this.inventarioInicial = this.inventario;
      this.condicion = this.medicamento.condicion ?? '';
      this.maxAlDia = this.medicamento.maxAlDia ?? null;
      this.horasEntreTomas = this.medicamento.horasEntreTomas ?? null;
      this.inicioInicial = this.medicamento.inicio;
      this.notas = this.medicamento.notas ?? '';
    }
  }

  valido(): boolean {
    return (
      !this.errorNombre() &&
      !this.errorDosis() &&
      (this.segunNecesidad || this.horarios().length > 0) &&
      !this.errorInicio() &&
      !this.errorDias() &&
      !this.errorInventario() &&
      !this.errorNotas() &&
      (!this.segunNecesidad || !this.errorLimites())
    );
  }

  /** El error de nombre o dosis se enseña al salir del campo, o antes si ya hay algo escrito que corregir. */
  verError(campo: 'nombre' | 'dosis'): boolean {
    const error = campo === 'nombre' ? this.errorNombre() : this.errorDosis();
    return !!error && (this.tocado[campo] || this[campo].trim().length > 1);
  }

  errorNombre(): string {
    const nombre = this.nombre.trim();
    if (!nombre) return 'Escribe el nombre del medicamento.';
    if (nombre.length < 2) return 'El nombre es muy corto: escribe al menos 2 letras.';
    if (!/\p{L}/u.test(nombre)) return 'El nombre debe llevar letras.';
    if (this.repetido()) {
      return this.medicamento
        ? 'Ya hay otro medicamento igual (mismo nombre y dosis).'
        : 'Ya hay un medicamento igual (mismo nombre y dosis). Edita ese en lugar de crear otro.';
    }
    return '';
  }

  errorDosis(): string {
    return this.dosis.trim() ? '' : 'Escribe la dosis (ej. 50 mg, 1 tableta).';
  }

  errorInicio(): string {
    if (!this.inicio) return '';
    if (isNaN(new Date(`${this.inicio}T00:00:00`).getTime())) return 'La fecha de inicio no es válida.';
    if (this.inicio < this.inicioMin) return 'La fecha de inicio es demasiado antigua.';
    if (this.inicio > this.inicioMax) return 'La fecha de inicio no puede pasar de un año a partir de hoy.';
    return '';
  }

  errorDias(): string {
    if (this.modoDuracion !== 'dias') return '';
    const n = this.numero(this.duracionDias);
    if (n === null) return 'Escribe cuántos días dura el tratamiento.';
    if (!Number.isInteger(n)) return 'Usa días completos, sin decimales.';
    if (n < 1 || n > this.L.duracionDias) return `Debe estar entre 1 y ${this.L.duracionDias} días.`;
    // Con esa fecha y esos días el tratamiento ya habría terminado: solo se acepta si no se tocó
    // (editar las notas de uno terminado sigue siendo válido)
    const fin = finTratamiento({ inicio: this.inicio || this.hoy, duracionDias: n });
    const cambiado =
      !this.medicamento ||
      (this.inicio || this.hoy) !== (this.medicamento.inicio ?? this.hoy) ||
      n !== (this.medicamento.duracionDias ?? null);
    if (fin && cambiado && !this.errorInicio() && claveDia(fin) <= this.hoy) {
      return `Con esa fecha de inicio el tratamiento ya habría terminado el ${formatDate(sumarDias(fin, -1), "d 'de' MMMM", 'es')}: ajusta los días o la fecha.`;
    }
    return '';
  }

  errorInventario(): string {
    if (this.inventarioIlegible) return 'Escribe un número o deja el campo vacío.';
    if (this.inventario === '' || this.inventario === null) return '';
    const n = this.numero(this.inventario);
    if (n === null) return 'Escribe un número o deja el campo vacío.';
    if (n < 0) return 'El inventario no puede ser negativo.';
    if (!Number.isInteger(n)) return 'Usa unidades completas, sin decimales.';
    if (n > this.L.inventario) return `El máximo es ${this.L.inventario} unidades.`;
    return '';
  }

  /** Máximo al día y horas entre tomas: enteros dentro de los topes, o vacíos. */
  errorLimites(): string {
    const { maxAlDia: M, horasEntreTomas: H } = this.LP;
    const max = this.numero(this.maxAlDia);
    const horas = this.numero(this.horasEntreTomas);
    if (this.maxAlDia !== '' && this.maxAlDia !== null && (max === null || !Number.isInteger(max) || max < M.min || max > M.max)) {
      return `El máximo al día debe ser un número entero de ${M.min} a ${M.max}, o déjalo vacío.`;
    }
    if (this.horasEntreTomas !== '' && this.horasEntreTomas !== null && (horas === null || !Number.isInteger(horas) || horas < H.min || horas > H.max)) {
      return `Las horas entre tomas deben ser un número entero de ${H.min} a ${H.max}, o déjalo vacío.`;
    }
    return '';
  }

  /** "Si hay dolor · máximo 3 al día · cada 8 h" con lo escrito en el formulario. */
  indicacionTexto(): string {
    return textoIndicacion({
      condicion: this.condicion,
      maxAlDia: this.numero(this.maxAlDia),
      horasEntreTomas: this.numero(this.horasEntreTomas),
    });
  }

  errorNotas(): string {
    return this.notas.trim().length > this.L.notas
      ? `Las notas pasan de ${this.L.notas} caracteres: acórtalas para poder guardar.`
      : '';
  }

  /**
   * Un <input type="number"> entrega '' cuando lo escrito no es un número ("12-", "1.2.3"): sin esta
   * señal se confundiría con el campo vacío y se guardaría "no se controla el inventario".
   */
  entradaIlegible(ev: Event): boolean {
    const el = (ev as CustomEvent<{ event?: Event }>).detail?.event?.target;
    return el instanceof HTMLInputElement && el.validity.badInput;
  }

  /** Mismo nombre, dosis y modalidad que otro medicamento vigente (uno suspendido o terminado no cuenta). */
  private repetido(): boolean {
    const clave = (s?: string) =>
      (s ?? '').trim().toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');
    const nombre = clave(this.nombre);
    const dosis = clave(this.dosis);
    // Al editar sin cambiar nombre, dosis ni modalidad no se revisa: si ya convivía con otro igual
    // (uno estaba suspendido, o vienen de antes de esta validación) se tiene que poder guardar
    const o = this.medicamento;
    if (o && clave(o.nombre) === nombre && clave(o.dosis) === dosis && (o.segunNecesidad === true) === this.segunNecesidad) {
      return false;
    }
    const hoy = new Date();
    return this.existentes.some(
      (m) =>
        m.id !== this.medicamento?.id &&
        m.activo !== false &&
        (finTratamiento(m)?.getTime() ?? Infinity) > hoy.getTime() &&
        (m.segunNecesidad === true) === this.segunNecesidad &&
        clave(m.nombre) === nombre &&
        clave(m.dosis) === dosis,
    );
  }

  /** Número escrito en un campo, o null si está vacío o no es un número. */
  private numero(valor: number | string | null): number | null {
    if (valor === '' || valor === null) return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  private diasNumero(): number {
    return this.errorDias() ? 0 : (this.numero(this.duracionDias) ?? 0);
  }

  /** "Última toma el 21 sep (7 días)" para el campo de duración. */
  finTexto(): string {
    const dias = this.diasNumero();
    if (dias <= 0) return '';
    const fin = finTratamiento({ inicio: this.inicio || this.hoy, duracionDias: dias });
    if (!fin) return '';
    return `Última toma el ${formatDate(sumarDias(fin, -1), "d 'de' MMMM", 'es')} (${dias} ${dias === 1 ? 'día' : 'días'})`;
  }

  /** "Alcanza para 19 días (2 al día)", y cuántas faltan si no cubre lo que queda del tratamiento. */
  inventarioTexto(): string {
    const unidades = this.numero(this.inventario);
    const alDia = this.segunNecesidad ? 0 : this.horarios().length;
    if (unidades === null || this.errorInventario() || !alDia) return '';
    const alcanza = Math.floor(unidades / alDia);
    const texto = `Alcanza para ${alcanza} ${alcanza === 1 ? 'día' : 'días'} (${alDia} al día)`;
    const dias = this.modoDuracion === 'dias' ? this.diasNumero() : 0;
    const fin = finTratamiento({ inicio: this.inicio || this.hoy, duracionDias: dias });
    if (!fin || this.errorInicio()) return texto;
    const desde = Math.max(new Date(`${this.hoy}T00:00:00`).getTime(), new Date(`${this.inicio || this.hoy}T00:00:00`).getTime());
    const faltan = Math.round((fin.getTime() - desde) / 86_400_000) * alDia - unidades;
    return faltan > 0 ? `${texto}; faltan ${faltan} para terminar el tratamiento` : texto;
  }

  agregarHora() {
    const m = String(this.nuevaHora).match(/(\d{1,2}):(\d{2})/);
    const hora = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
    const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    // Dos tomas casi a la misma hora suelen ser un error de captura (la distancia da la vuelta a medianoche)
    const cercana = this.horarios().find((h) => {
      const d = Math.abs(minutos(h) - minutos(hora));
      return h !== hora && Math.min(d, 1440 - d) < SEPARACION_MIN;
    });
    if (!HORARIO_VALIDO.test(hora)) this.errorHora.set('Esa hora no es válida.');
    else if (this.horarios().includes(hora)) this.errorHora.set(`Las ${hora} ya están en la lista.`);
    else if (cercana) this.errorHora.set(`Ya hay una toma a las ${cercana}: deja al menos ${SEPARACION_MIN} minutos entre tomas.`);
    else if (this.horarios().length >= this.L.horarios) this.errorHora.set(`Máximo ${this.L.horarios} horarios al día.`);
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
    const datos: DatosMedicamento = {
      nombre: this.nombre.trim(),
      dosis: this.dosis.trim(),
      horarios: this.segunNecesidad ? [] : this.horarios(),
      segunNecesidad: this.segunNecesidad,
      inicio: this.inicio || this.hoy,
      duracionDias: this.modoDuracion === 'dias' ? this.diasNumero() : null,
      inventario: this.numero(this.inventario),
      notas: this.notas.trim(),
      // La indicación solo aplica a "según necesidad"; si se quita el modo, se borra
      condicion: this.segunNecesidad ? this.condicion.trim() : '',
      maxAlDia: this.segunNecesidad ? this.numero(this.maxAlDia) : null,
      horasEntreTomas: this.segunNecesidad ? this.numero(this.horasEntreTomas) : null,
    };
    // Un medicamento con horario que nunca tuvo indicación no necesita esos campos
    const teniaIndicacion =
      !!this.medicamento?.condicion || this.medicamento?.maxAlDia != null || this.medicamento?.horasEntreTomas != null;
    if (!this.segunNecesidad && !teniaIndicacion) {
      delete datos.condicion;
      delete datos.maxAlDia;
      delete datos.horasEntreTomas;
    }
    if (this.medicamento) {
      // Al editar, lo que no se tocó no se reescribe
      const editado: Partial<DatosMedicamento> = { ...datos };
      if (datos.inventario === this.inventarioInicial) delete editado.inventario;
      if (!this.inicioInicial && datos.inicio === this.hoy) delete editado.inicio;
      // ¿Cambió el tratamiento? (no basta con corregir notas, inventario o fechas)
      const m = this.medicamento;
      editado.cambioTratamiento =
        datos.nombre !== m.nombre ||
        datos.dosis !== m.dosis ||
        datos.segunNecesidad !== (m.segunNecesidad === true) ||
        datos.horarios.join(',') !== (m.horarios ?? []).join(',');
      void this.modalCtrl.dismiss(editado, 'guardar');
      return;
    }
    void this.modalCtrl.dismiss(datos, 'guardar');
  }
}
