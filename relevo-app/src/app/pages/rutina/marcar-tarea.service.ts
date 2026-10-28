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

/** Cambiar o quitar un registro ajeno (y sus mediciones) lo impiden la app y las rules. */
const SOLO_AUTOR_O_RESPONSABLE =
  'Solo quien hizo el registro o el responsable pueden cambiarlo o quitarlo.';

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

  /** Cambiar, anotar o quitar un registro: quien lo hizo o el responsable (misma regla que firestore.rules). */
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

    // Un registro ajeno solo lo cambia o quita quien lo hizo o el responsable (igual en las rules)
    const deshaceMediciones = deSignos && !!p.registro?.hecha && estado !== 'hecha';
    if (!this.puedeQuitar(p, opciones)) {
      await this.aviso(SOLO_AUTOR_O_RESPONSABLE);
      return false;
    }
    if (estado === 'quitar' && !(await this.confirmarQuitar(p, deshaceMediciones))) return false;
    // Pasar a "no hecha" una tarea de signos borra sus mediciones: se confirma como algo destructivo
    if (estado === 'omitida' && deshaceMediciones && !(await this.confirmarNoHecha(p))) return false;

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
    if (estado !== 'quitar' && !deshaceMediciones) {
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
   * Hoja de opciones de una tarea programada: marcar (el estado contrario si ya tiene registro; en
   * una de signos ya hecha, corregir las mediciones), nota y quitar. Un registro de otra persona solo
   * lo cambia quien lo hizo o el responsable: a los demás se les dice quién lo registró.
   */
  async opciones(personaId: string, p: TareaProgramada, opciones: OpcionesMarcarTarea = {}) {
    const r = p.registro;
    if (r && !this.puedeQuitar(p, opciones)) {
      const alerta = await this.alertCtrl.create({
        header: `${p.tarea.nombre} · ${p.horario}`,
        message: `${r.hecha ? 'Hecha' : 'No hecha'} · registrada por ${r.registradoNombre ?? 'otra persona'}${
          r.nota ? ` · ${r.nota}` : ''
        }. Si hay un error, pídele a esa persona o al responsable que lo corrija.`,
        buttons: ['Entendido'],
      });
      await alerta.present();
      return;
    }
    const deSignos = p.tarea.tipo === 'signos';
    const botones = [];
    if (!r || !r.hecha || deSignos) {
      botones.push({
        text: r?.hecha ? 'Corregir mediciones' : 'Marcar como hecha',
        icon: r?.hecha ? 'pulse-outline' : 'checkmark-circle-outline',
        handler: () => {
          void this.marcarConAviso(personaId, p, 'hecha', opciones);
        },
      });
    }
    if (!r || r.hecha) {
      botones.push({
        text: 'Marcar como no hecha',
        icon: 'close-circle-outline',
        handler: () => {
          void this.marcarConAviso(personaId, p, 'omitida', opciones);
        },
      });
    }
    if (r) {
      botones.push(
        {
          text: r.nota ? 'Editar nota' : 'Agregar nota',
          icon: 'create-outline',
          handler: () => {
            void this.editarNota(personaId, p);
          },
        },
        {
          text: 'Quitar registro',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.marcarConAviso(personaId, p, 'quitar', opciones);
          },
        },
      );
    }
    const sheet = await this.actionSheetCtrl.create({
      header: `${p.tarea.nombre} · ${p.horario}`,
      subHeader: r
        ? `${r.hecha ? 'Hecha' : 'No hecha'}${r.registradoNombre ? ` · ${r.registradoNombre}` : ''}`
        : undefined,
      buttons: [...botones, { text: 'Cancelar', role: 'cancel' }],
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

  /** "¿Marcar como no hecha?" en una tarea de signos ya hecha: sus mediciones se borran. */
  private confirmarNoHecha(p: TareaProgramada): Promise<boolean> {
    return confirmar(this.alertCtrl, {
      header: '¿Marcar como no hecha?',
      message: `${p.tarea.nombre} · ${p.horario}. Las mediciones que se capturaron se borran (dejan de verse en la bitácora y el reporte).`,
      confirmar: 'Marcar como no hecha',
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
        denegado
          ? SOLO_AUTOR_O_RESPONSABLE
          : estado === 'quitar'
            ? 'No se pudo quitar el registro.'
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
