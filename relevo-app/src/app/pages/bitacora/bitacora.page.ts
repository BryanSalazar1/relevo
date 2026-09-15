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
  PUEDE_ESCRIBIR_BITACORA,
  TIPOS_ENTRADA,
  TIPO_ENTRADA_INFO,
  TipoEntrada,
} from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { BitacoraService, DatosEntrada } from '../../core/services/bitacora.service';
import { agruparPorDia, etiquetaDia } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';
import { EntradaModal } from './entrada.modal';

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
  readonly entradas = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.bitacoraSvc.entradas(id))),
  );

  readonly filtro = signal<TipoEntrada | null>(null);
  readonly etiquetaDia = etiquetaDia;

  readonly grupos = computed(() => {
    const lista = this.entradas();
    if (!lista) return undefined;
    const f = this.filtro();
    const filtradas = f ? lista.filter((e) => e.tipo === f) : lista;
    return agruparPorDia(filtradas, (e) => e.fecha.toDate());
  });

  readonly total = computed(() => this.entradas()?.length ?? 0);

  readonly puedeEscribir = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_ESCRIBIR_BITACORA.includes(r);
  });

  info(tipo: TipoEntrada) {
    return TIPO_ENTRADA_INFO[tipo];
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
