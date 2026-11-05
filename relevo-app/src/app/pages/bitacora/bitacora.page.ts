import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonAvatar,
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { map, switchMap } from 'rxjs';
import {
  EntradaBitacora,
  INFO_SIGNO_BITACORA,
  INFO_TAREA_BITACORA,
  INFO_TOMA,
  PUEDE_ESCRIBIR_BITACORA,
  PUEDE_ESCRIBIR_INDICACION,
  PUEDE_REGISTRAR_TAREAS,
  SignoVital,
  TIPO_TAREA_INFO,
  TipoTarea,
  TIPOS_ENTRADA,
  TIPO_ENTRADA_INFO,
  TipoEntrada,
} from '../../core/models';
import { textoSigno } from '../../core/utils/entrega-turno';
import { MarcarTareaService } from '../rutina/marcar-tarea.service';
import { AuthService } from '../../core/services/auth.service';
import { BitacoraService, DatosEntrada, ItemBitacora } from '../../core/services/bitacora.service';
import { TomaRegistrada } from '../../core/services/medicamentos.service';
import { RegistroReciente } from '../../core/services/tareas.service';
import { agruparPorDia, etiquetaDia } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { EntradaModal } from './entrada.modal';
import { FabAsistente } from '../../shared/fab-asistente.component';

/**
 * Qué se muestra: un tipo de entrada, solo tomas de medicamentos, solo tareas, solo signos, lo
 * clínico (síntomas, incidentes, indicaciones y signos: lo que mira el médico) o todo (null).
 */
export type FiltroBitacora = TipoEntrada | 'toma' | 'tarea' | 'signo' | 'clinico';

/** Tipos de entrada que cuentan como "lo clínico" (junto con los signos vitales) */
const TIPOS_CLINICOS = new Set<TipoEntrada>(['sintoma', 'incidente', 'indicacion']);
const INFO_CLINICO = { etiqueta: 'Lo clínico', icono: 'pulse-outline', color: 'primary' };

/**
 * El filtro pedido en la URL: un filtro conocido, 'todo' (sin filtro, explícito) o undefined si la
 * URL no pide nada (entonces cada rol ve su vista por defecto).
 */
function filtroDeUrl(f: string | null): FiltroBitacora | null | undefined {
  if (f === 'todo') return null;
  const validos: string[] = ['toma', 'tarea', 'signo', 'clinico', ...TIPOS_ENTRADA.map((t) => t.valor)];
  return f && validos.includes(f) ? (f as FiltroBitacora) : undefined;
}

@Component({
  selector: 'app-bitacora',
  imports: [
    FabAsistente,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonChip,
    IonContent,
    IonList,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonAvatar,
    IonSpinner,
    IonText,
  ],
  templateUrl: './bitacora.page.html',
  styleUrl: './bitacora.page.scss',
})
export class BitacoraPage {
  private readonly auth = inject(AuthService);
  private readonly bitacoraSvc = inject(BitacoraService);
  private readonly marcarTareaSvc = inject(MarcarTareaService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;
  readonly enPausa = this.ctx.enPausa;
  /** Entradas escritas + tomas de medicamentos, de lo más reciente a lo más antiguo. */
  readonly linea = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.bitacoraSvc.lineaDeTiempo(id))),
  );

  /** Filtro por tipo; se puede abrir ya filtrada con ?filtro=indicacion (p. ej. desde Hoy o Seguimiento) */
  readonly filtro = signal<FiltroBitacora | null>(null);
  /** Filtro que pide la URL; las pestañas reutilizan la página, así que se sigue cada cambio */
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly filtroUrl = toSignal(
    this.route.queryParamMap.pipe(map((q) => filtroDeUrl(q.get('filtro')))),
  );
  readonly etiquetaDia = etiquetaDia;
  readonly infoToma = INFO_TOMA;
  readonly infoTarea = INFO_TAREA_BITACORA;

  readonly grupos = computed(() => {
    const lista = this.linea();
    if (!lista) return undefined;
    const f = this.filtro();
    const filtradas = !f
      ? lista
      : f === 'clinico'
        ? lista.filter(
            (i) => i.clase === 'signo' || (i.clase === 'entrada' && TIPOS_CLINICOS.has(i.entrada.tipo)),
          )
        : f === 'toma' || f === 'tarea' || f === 'signo'
          ? lista.filter((i) => i.clase === f)
          : lista.filter((i) => i.clase === 'entrada' && i.entrada.tipo === f);
    return agruparPorDia(filtradas, (i) => i.fecha);
  });

  constructor() {
    // Lo que pida la URL manda; sin filtro en la URL, el médico ve lo clínico y los demás todo
    effect(() => {
      const pedido = this.filtroUrl();
      const rol = this.rol();
      if (!rol) return;
      untracked(() => this.filtro.set(pedido !== undefined ? pedido : rol === 'medico' ? 'clinico' : null));
    });
  }

  readonly total = computed(() => this.linea()?.length ?? 0);

  /** Quien escribe registros, y el médico (solo indicaciones médicas; el formulario lo acota) */
  readonly puedeEscribir = computed(() => {
    const r = this.rol();
    if (!r || this.enPausa()) return false;
    if (PUEDE_ESCRIBIR_INDICACION.includes(r)) return true;
    // Enfermero/a solo en su turno; familiar con permiso del responsable
    return PUEDE_ESCRIBIR_BITACORA.includes(r) && this.ctx.puedeRegistrar();
  });
  /** Quienes marcan tareas también registran signos sueltos (mismos roles en firestore.rules) */
  readonly puedeRegistrarSignos = computed(() => {
    const r = this.rol();
    return !!r && this.ctx.puedeRegistrar() && PUEDE_REGISTRAR_TAREAS.includes(r);
  });
  readonly infoSigno = INFO_SIGNO_BITACORA;

  info(tipo: FiltroBitacora) {
    if (tipo === 'toma') return INFO_TOMA;
    if (tipo === 'tarea') return INFO_TAREA_BITACORA;
    if (tipo === 'signo') return INFO_SIGNO_BITACORA;
    if (tipo === 'clinico') return INFO_CLINICO;
    return TIPO_ENTRADA_INFO[tipo];
  }

  /** "Presión 130/85 mmHg · Glucosa 110 mg/dL" para una línea de mediciones sueltas. */
  textoSignos(signos: SignoVital[]): string {
    return signos.map(textoSigno).join(' · ');
  }

  /** Signos vitales ahora mismo, sin tarea de por medio (el botón del pulso en la barra). */
  async registrarSignos() {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrarSignos()) return;
    await this.marcarTareaSvc.registrarSueltos(personaId);
  }

  /** Icono y color del tipo de tarea (comida, baño…) para el registro en la bitácora. */
  infoTipoTarea(tipo: TipoTarea) {
    return TIPO_TAREA_INFO[tipo] ?? TIPO_TAREA_INFO['otro'];
  }

  /** Verde si se hizo, rojo si se marcó como no hecha. */
  colorRegistro(r: RegistroReciente): string {
    return r.registro.hecha ? 'success' : 'danger';
  }

  /**
   * Hora en que ocurrió lo escrito, solo si difiere de cuándo se registró (2 min o más);
   * la bitácora se ordena por el registro, pero el usuario pudo fechar el hecho un poco antes.
   */
  ocurrio(item: ItemBitacora): Date | null {
    if (item.clase !== 'entrada') return null;
    const hecho = item.entrada.fecha.toDate();
    return Math.abs(item.fecha.getTime() - hecho.getTime()) >= 2 * 60_000 ? hecho : null;
  }

  /** Verde si se tomó, rojo si se marcó como no tomada. */
  colorToma(t: TomaRegistrada): string {
    return t.toma.tomado ? 'success' : 'danger';
  }

  /** El autor edita lo suyo; el responsable, todo menos las indicaciones del médico (igual en firestore.rules). */
  puedeEditar(e: EntradaBitacora): boolean {
    if (this.enPausa()) return false;
    // Lo propio: la indicación el médico; lo demás, solo mientras puede registrar (en su turno)
    if (e.autorUid === this.auth.uid) return e.tipo === 'indicacion' || this.ctx.puedeRegistrar();
    return this.rol() === 'cuidador_principal' && e.tipo !== 'indicacion';
  }

  /** Además, el responsable puede quitar una indicación que ya no aplica (no editarla). */
  puedeEliminar(e: EntradaBitacora): boolean {
    return this.puedeEditar(e) || this.rol() === 'cuidador_principal';
  }

  /** Filtro elegido a mano: queda en la URL, así un enlace con otro filtro siempre lo cambia. */
  private elegirFiltro(f: FiltroBitacora | null) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { filtro: f ?? 'todo' },
      replaceUrl: true,
    });
  }

  async abrirFiltro() {
    const sheet = await this.actionSheetCtrl.create({
      header: 'Mostrar solo…',
      buttons: [
        ...TIPOS_ENTRADA.map((t) => ({
          text: t.etiqueta,
          icon: t.icono,
          handler: () => {
            this.elegirFiltro(t.valor);
          },
        })),
        {
          text: 'Tomas de medicamentos',
          icon: INFO_TOMA.icono,
          handler: () => {
            this.elegirFiltro('toma');
          },
        },
        {
          text: 'Tareas de la rutina',
          icon: INFO_TAREA_BITACORA.icono,
          handler: () => {
            this.elegirFiltro('tarea');
          },
        },
        {
          text: 'Signos vitales',
          icon: INFO_SIGNO_BITACORA.icono,
          handler: () => {
            this.elegirFiltro('signo');
          },
        },
        {
          text: 'Lo clínico (síntomas, incidentes, signos e indicaciones)',
          icon: INFO_CLINICO.icono,
          handler: () => {
            this.elegirFiltro('clinico');
          },
        },
        {
          text: 'Todas las entradas',
          icon: 'funnel-outline',
          handler: () => {
            this.elegirFiltro(null);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  nueva() {
    return this.editar(null);
  }

  async editar(entrada: EntradaBitacora | null) {
    const modal = await this.modalCtrl.create({
      component: EntradaModal,
      componentProps: { entrada, personaNombre: this.persona()?.nombre ?? '', rol: this.rol() },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosEntrada>();
    if (role !== 'guardar' || !data) return;

    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      if (entrada?.id) {
        await this.bitacoraSvc.actualizar(personaId, entrada.id, data);
        await this.aviso('Registro actualizado', 'success');
      } else {
        await this.bitacoraSvc.crear(personaId, data);
        await this.aviso('Registro guardado', 'success');
      }
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar. Revisa tu conexión o tus permisos.', 'danger');
    }
  }

  async opciones(e: EntradaBitacora) {
    if (!this.puedeEliminar(e)) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${this.info(e.tipo).etiqueta} · ${e.autorNombre}`,
      buttons: [
        ...(this.puedeEditar(e)
          ? [
              {
                text: 'Editar',
                icon: 'create-outline',
                handler: () => {
                  void this.editar(e);
                },
              },
            ]
          : []),
        {
          text: 'Eliminar',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.eliminar(e);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async eliminar(e: EntradaBitacora) {
    const alerta = await this.alertCtrl.create({
      header: '¿Eliminar este registro?',
      message: e.texto,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    const personaId = this.ctx.personaId();
    if (!personaId || !e.id) return;
    try {
      await this.bitacoraSvc.eliminar(personaId, e.id);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo eliminar.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
