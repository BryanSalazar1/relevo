import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActionSheetController,
  AlertController,
  IonAvatar,
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFab,
  IonFabButton,
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
import { switchMap } from 'rxjs';
import {
  EntradaBitacora,
  INFO_TAREA_BITACORA,
  INFO_TOMA,
  PUEDE_ESCRIBIR_BITACORA,
  TIPO_TAREA_INFO,
  TipoTarea,
  TIPOS_ENTRADA,
  TIPO_ENTRADA_INFO,
  TipoEntrada,
} from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { BitacoraService, DatosEntrada, ItemBitacora } from '../../core/services/bitacora.service';
import { TomaRegistrada } from '../../core/services/medicamentos.service';
import { RegistroReciente } from '../../core/services/tareas.service';
import { agruparPorDia, etiquetaDia } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { EntradaModal } from './entrada.modal';

/** Qué se muestra: un tipo de entrada, solo tomas de medicamentos, solo tareas, o todo (null). */
export type FiltroBitacora = TipoEntrada | 'toma' | 'tarea';

@Component({
  selector: 'app-bitacora',
  imports: [
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
    IonFab,
    IonFabButton,
    IonSpinner,
    IonText,
  ],
  templateUrl: './bitacora.page.html',
  styleUrl: './bitacora.page.scss',
})
export class BitacoraPage {
  private readonly auth = inject(AuthService);
  private readonly bitacoraSvc = inject(BitacoraService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;
  /** Entradas escritas + tomas de medicamentos, de lo más reciente a lo más antiguo. */
  readonly linea = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.bitacoraSvc.lineaDeTiempo(id))),
  );

  readonly filtro = signal<FiltroBitacora | null>(null);
  readonly etiquetaDia = etiquetaDia;
  readonly infoToma = INFO_TOMA;
  readonly infoTarea = INFO_TAREA_BITACORA;

  readonly grupos = computed(() => {
    const lista = this.linea();
    if (!lista) return undefined;
    const f = this.filtro();
    const filtradas = !f
      ? lista
      : f === 'toma' || f === 'tarea'
        ? lista.filter((i) => i.clase === f)
        : lista.filter((i) => i.clase === 'entrada' && i.entrada.tipo === f);
    return agruparPorDia(filtradas, (i) => i.fecha);
  });

  readonly total = computed(() => this.linea()?.length ?? 0);

  readonly puedeEscribir = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_ESCRIBIR_BITACORA.includes(r);
  });

  info(tipo: FiltroBitacora) {
    if (tipo === 'toma') return INFO_TOMA;
    if (tipo === 'tarea') return INFO_TAREA_BITACORA;
    return TIPO_ENTRADA_INFO[tipo];
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

  /** El cuidador principal edita todo; los demás solo lo que escribieron. */
  puedeEditar(e: EntradaBitacora): boolean {
    return this.rol() === 'cuidador_principal' || e.autorUid === this.auth.uid;
  }

  async abrirFiltro() {
    const sheet = await this.actionSheetCtrl.create({
      header: 'Mostrar solo…',
      buttons: [
        ...TIPOS_ENTRADA.map((t) => ({
          text: t.etiqueta,
          icon: t.icono,
          handler: () => {
            this.filtro.set(t.valor);
          },
        })),
        {
          text: 'Tomas de medicamentos',
          icon: INFO_TOMA.icono,
          handler: () => {
            this.filtro.set('toma');
          },
        },
        {
          text: 'Tareas de la rutina',
          icon: INFO_TAREA_BITACORA.icono,
          handler: () => {
            this.filtro.set('tarea');
          },
        },
        {
          text: 'Todas las entradas',
          icon: 'funnel-outline',
          handler: () => {
            this.filtro.set(null);
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
      componentProps: { entrada, personaNombre: this.persona()?.nombre ?? '' },
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
    if (!this.puedeEditar(e)) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${this.info(e.tipo).etiqueta} · ${e.autorNombre}`,
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => {
            void this.editar(e);
          },
        },
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
