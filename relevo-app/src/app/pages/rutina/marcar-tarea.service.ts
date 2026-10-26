import { Injectable, inject } from '@angular/core';
import { claveDia } from '../../core/utils/fechas';
import { ActionSheetController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/services/auth.service';
import { SignosService, resumenMediciones } from '../../core/services/signos.service';
import {
  EstadoRegistro,
  TareaProgramada,
  TareasService,
} from '../../core/services/tareas.service';
import { NOTA_MAX, confirmar, pedirNota } from '../../core/utils/notas';
import { DatosSignos, SignosModal } from './signos.modal';

/** Quitar un registro ajeno (o deshacer sus mediciones) lo impiden la app y las rules. */
const SOLO_AUTOR_O_RESPONSABLE =
  'Solo quien hizo el registro o el responsable pueden quitarlo.';

export interface OpcionesMarcarTarea {
  /** Quien marca es el responsable: puede quitar registros hechos por otros (igual que las rules) */
  puedeQuitarAjenos?: boolean;
}

/**
 * Marcar una tarea de la rutina, igual desde Hoy que desde el Semáforo: confirmación con nota
 * opcional y, si la tarea es de signos vitales y se hizo, la captura de las mediciones (que además
 * se guardan en `signos_vitales` para el reporte y el asistente). También las opciones de un
 * registro ya hecho (nota, quitar). Es el par de MarcarTomaService.
 */
@Injectable({ providedIn: 'root' })
export class MarcarTareaService {
  private readonly tareasSvc = inject(TareasService);
  private readonly signosSvc = inject(SignosService);
  private readonly authSvc = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toast = inject(ToastController);

  /** Quitar un registro: quien lo hizo o el responsable (misma regla que firestore.rules). */
  puedeQuitar(p: TareaProgramada, { puedeQuitarAjenos = false }: OpcionesMarcarTarea = {}): boolean {
    const autor = p.registro?.registradoPor;
    return !autor || autor === this.authSvc.uid || puedeQuitarAjenos;
  }

  /** Devuelve false si se canceló (o no se tiene permiso); lanza si no se pudo guardar. */
  async marcar(
    personaId: string,
    p: TareaProgramada,
    estado: EstadoRegistro,
    opciones: OpcionesMarcarTarea = {},
  ): Promise<boolean> {
    const tareaId = p.tarea.id;
    if (!tareaId) throw new Error('Datos incompletos');
    const deSignos = p.tarea.tipo === 'signos';

    // Quitar un registro, o deshacer las mediciones que trajo, solo puede quien lo hizo o el
    // responsable (las rules lo exigen al borrar); se avisa antes de intentarlo
    const deshaceMediciones = deSignos && !!p.registro?.hecha && estado !== 'hecha';
    if ((estado === 'quitar' || deshaceMediciones) && !this.puedeQuitar(p, opciones)) {
      await this.aviso(SOLO_AUTOR_O_RESPONSABLE);
      return false;
    }
    if (estado === 'quitar' && !(await this.confirmarQuitar(p, deshaceMediciones))) return false;

    if (deSignos && estado === 'hecha') {
      const datos = await this.pedirSignos(p);
      if (!datos) return false;
      // Las mediciones van primero: si el registro fallara, al reintentar se reescriben las mismas
      // Las mediciones llevan la hora real si la tarea es de hoy; si se marca una de otro día, la
      // hora programada de esa tarea (si no, el reporte las pondría en el día equivocado)
      const fecha = claveDia(p.hora) === claveDia(new Date()) ? new Date() : p.hora;
      await this.signosSvc.guardarDeTarea(personaId, tareaId, p.idRegistro, datos.mediciones, fecha);
      const nota = [resumenMediciones(datos.mediciones), datos.nota].filter(Boolean).join(' — ');
      await this.tareasSvc.registrar(personaId, p, 'hecha', nota.slice(0, NOTA_MAX) || undefined);
      return true;
    }

    let nota: string | undefined;
    if (estado !== 'quitar') {
      const r = await pedirNota(this.alertCtrl, {
        header: `¿Marcar como ${estado === 'hecha' ? 'hecha' : 'no hecha'}?`,
        message: `${p.tarea.nombre} · ${p.horario}`,
        confirmar: 'Marcar',
      });
      if (!r.ok) return false;
      nota = r.nota;
    }
    await this.tareasSvc.registrar(personaId, p, estado, nota);
    // Ya no está hecha: sus mediciones (si las hubo) dejan de contar
    if (deshaceMediciones) {
      await this.signosSvc.quitarDeTarea(personaId, tareaId, p.idRegistro).catch(() => undefined);
    }
    if (estado === 'quitar') await this.aviso('Registro quitado.', 'success');
    return true;
  }

  /**
   * Registrar signos vitales en cualquier momento, sin tarea de por medio (desde Hoy o la
   * Bitácora). Devuelve false si se canceló; los errores se muestran aquí.
   */
  async registrarSueltos(personaId: string): Promise<boolean> {
    const modal = await this.modalCtrl.create({
      component: SignosModal,
      componentProps: { titulo: 'Signos vitales de ahora', tipos: [] },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosSignos>();
    if (role !== 'guardar' || !data?.mediciones.length) return false;
    try {
      await this.signosSvc.guardarSueltas(personaId, data.mediciones, data.nota);
      const t = await this.toast.create({
        message: `Registrado: ${resumenMediciones(data.mediciones)}.`,
        color: 'success',
        duration: 3000,
        position: 'top',
      });
      await t.present();
      return true;
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudieron guardar las mediciones.');
      return false;
    }
  }

  /**
   * Hoja de opciones de una tarea programada: marcar, nota y quitar el registro. «Quitar registro»
   * solo aparece para quien lo hizo o el responsable; si no, se explica por qué.
   */
  async opciones(personaId: string, p: TareaProgramada, opciones: OpcionesMarcarTarea = {}) {
    const puedeQuitar = this.puedeQuitar(p, opciones);
    const sheet = await this.actionSheetCtrl.create({
      header: `${p.tarea.nombre} · ${p.horario}`,
      subHeader:
        p.registro && !puedeQuitar
          ? `Registro de ${p.registro.registradoNombre ?? 'otra persona'}: solo esa persona o el responsable pueden quitarlo.`
          : undefined,
      buttons: [
        {
          text: 'Marcar como hecha',
          icon: 'checkmark-circle-outline',
          handler: () => {
            void this.marcarConAviso(personaId, p, 'hecha', opciones);
          },
        },
        {
          text: 'Marcar como no hecha',
          icon: 'close-circle-outline',
          handler: () => {
            void this.marcarConAviso(personaId, p, 'omitida', opciones);
          },
        },
        ...(p.registro
          ? [
              {
                text: p.registro.nota ? 'Editar nota' : 'Agregar nota',
                icon: 'create-outline',
                handler: () => {
                  void this.editarNota(personaId, p);
                },
              },
              ...(puedeQuitar
                ? [
                    {
                      text: 'Quitar registro',
                      icon: 'trash-outline',
                      role: 'destructive',
                      handler: () => {
                        void this.marcarConAviso(personaId, p, 'quitar', opciones);
                      },
                    },
                  ]
                : []),
            ]
          : []),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Agrega o corrige la nota de un registro ya hecho (quien lo registró o el responsable). */
  async editarNota(personaId: string, p: TareaProgramada) {
    if (!p.tarea.id || !p.registro?.id) return;
    const r = await pedirNota(this.alertCtrl, {
      header: 'Nota de la tarea',
      message: `${p.tarea.nombre} · ${p.horario}`,
      confirmar: 'Guardar',
      nota: p.registro.nota,
    });
    if (!r.ok) return;
    try {
      await this.tareasSvc.actualizarNota(personaId, p.tarea.id, p.registro.id, r.nota);
    } catch (error) {
      console.error(error);
      await this.aviso(
        'No se pudo guardar la nota. Solo quien registró la tarea o el responsable pueden cambiarla.',
      );
    }
  }

  /** "¿Quitar el registro?": quién lo hizo, si se borran mediciones y que no se deshace. */
  private confirmarQuitar(p: TareaProgramada, conMediciones: boolean): Promise<boolean> {
    const quien = p.registro?.registradoNombre ? ` Registro de ${p.registro.registradoNombre}.` : '';
    const mediciones = conMediciones ? ' Sus mediciones también se borran.' : '';
    return confirmar(this.alertCtrl, {
      header: '¿Quitar el registro?',
      message: `${p.tarea.nombre} · ${p.horario}.${quien}${mediciones} Esta acción no se puede deshacer.`,
      confirmar: 'Quitar',
      destructivo: true,
    });
  }

  /** `marcar` que muestra el error en vez de lanzarlo (para los botones de una hoja de opciones). */
  private async marcarConAviso(
    personaId: string,
    p: TareaProgramada,
    estado: EstadoRegistro,
    opciones: OpcionesMarcarTarea,
  ) {
    try {
      await this.marcar(personaId, p, estado, opciones);
    } catch (error) {
      console.error(error);
      const denegado = (error as { code?: string } | null)?.code === 'permission-denied';
      await this.aviso(
        estado === 'quitar'
          ? denegado
            ? SOLO_AUTOR_O_RESPONSABLE
            : 'No se pudo quitar el registro.'
          : 'No se pudo registrar la tarea.',
      );
    }
  }

  private async aviso(message: string, color: 'danger' | 'success' = 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }

  private async pedirSignos(p: TareaProgramada): Promise<DatosSignos | null> {
    const modal = await this.modalCtrl.create({
      component: SignosModal,
      componentProps: { titulo: `${p.tarea.nombre} · ${p.horario}`, tipos: p.tarea.signos ?? [] },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosSignos>();
    return role === 'guardar' && data ? data : null;
  }
}
