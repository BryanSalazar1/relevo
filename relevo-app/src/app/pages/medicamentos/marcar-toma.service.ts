import { Injectable, inject } from '@angular/core';
import { ActionSheetController, AlertController, ModalController, ToastController } from '@ionic/angular';
import { Medicamento, Toma } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import {
  DosisProgramada,
  EstadoToma,
  MedicamentosService,
  TomaNoPermitida,
  agotado,
} from '../../core/services/medicamentos.service';
import { haceCuanto, inicioDeDia, textoDuracion } from '../../core/utils/fechas';
import { revisarNuevaToma } from '../../core/utils/segun-necesidad';
import { DatosTomaSegunNecesidad, TomaSegunNecesidadModal } from './toma-segun-necesidad.modal';
import { confirmar, pedirNota } from '../../core/utils/notas';

/** Marcar una dosis con más de estos minutos de anticipación muestra un aviso en la confirmación. */
const DOSIS_ADELANTADA_MIN = 60;
/** Cambiar o quitar un registro ajeno lo impiden la app y las rules: solo quien lo hizo o el responsable. */
const SOLO_AUTOR_O_RESPONSABLE =
  'Solo quien registró la toma o el responsable pueden cambiar o quitar el registro.';

export interface OpcionesMarcarToma {
  /** Quien marca puede resurtir (responsable): cambia el aviso cuando el inventario está en 0 */
  puedeResurtir?: boolean;
  /** Quien marca es el responsable: puede quitar registros hechos por otros (igual que las rules) */
  puedeQuitarAjenos?: boolean;
}

/**
 * Registrar tomas de medicamentos, igual desde Hoy que desde el Semáforo: confirmación con nota
 * opcional, avisos (dosis adelantada, inventario en 0, posible duplicado según necesidad), las
 * opciones de una toma ya registrada y la edición de su nota. Es el par de MarcarTareaService.
 */
@Injectable({ providedIn: 'root' })
export class MarcarTomaService {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly authSvc = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toast = inject(ToastController);

  /** "Última toma: hace 3 h (10:15) · Ana · nota" o "Sin tomas registradas". */
  ultimaTomaTexto(t: Toma | undefined): string {
    if (!t) return 'Sin tomas registradas';
    const quien = t.registradoNombre ? ` · ${t.registradoNombre}` : '';
    const nota = t.nota ? ` · ${t.nota}` : '';
    return `Última toma: ${haceCuanto((t.horaReal ?? t.horaProgramada).toDate())}${quien}${nota}`;
  }

  /** Cambiar, anotar o quitar un registro: quien lo hizo o el responsable (misma regla que firestore.rules). */
  puedeQuitar(d: DosisProgramada, { puedeQuitarAjenos = false }: OpcionesMarcarToma = {}): boolean {
    const autor = d.toma?.registradoPor;
    return !autor || autor === this.authSvc.uid || puedeQuitarAjenos;
  }

  /**
   * Marca una dosis programada como tomada / no tomada (con confirmación y nota) o quita su
   * registro (con confirmación: no se puede deshacer). Devuelve false si se canceló. Los errores
   * se muestran aquí.
   */
  async marcar(
    personaId: string,
    d: DosisProgramada,
    estado: EstadoToma,
    opciones: OpcionesMarcarToma = {},
  ): Promise<boolean> {
    const { puedeResurtir = false } = opciones;
    let nota: string | undefined;
    // Se marca tomada (no lo estaba) y ya no quedan unidades: se registra, pero no hay de dónde descontar
    const sinUnidades = estado === 'tomada' && !d.toma?.tomado && agotado(d.medicamento);
    if (!this.puedeQuitar(d, opciones)) {
      await this.aviso(SOLO_AUTOR_O_RESPONSABLE, 'danger');
      return false;
    }
    if (estado === 'quitar') {
      if (!(await this.confirmarQuitar(d))) return false;
    } else {
      const faltanMin = (d.hora.getTime() - Date.now()) / 60000;
      const avisos = [
        faltanMin > DOSIS_ADELANTADA_MIN
          ? `Aún faltan ${textoDuracion(Math.round(faltanMin))} para esta dosis.`
          : '',
        sinUnidades ? this.avisoAgotado(d.medicamento) : '',
      ].filter(Boolean);
      const r = await pedirNota(this.alertCtrl, {
        header: `¿Marcar como ${estado === 'tomada' ? 'tomada' : 'no tomada'}?`,
        message: [
          `${d.medicamento.nombre} ${d.medicamento.dosis} · dosis de las ${d.horario}${avisos.length ? '.' : ''}`,
          ...avisos,
        ].join(' '),
        confirmar: 'Marcar',
      });
      if (!r.ok) return false;
      nota = r.nota;
    }
    try {
      await this.medsSvc.registrarToma(personaId, d, estado, nota);
      if (sinUnidades) await this.avisarAgotado(d.medicamento, puedeResurtir);
      else if (estado === 'quitar') await this.aviso('Registro quitado.', 'success');
      return true;
    } catch (error) {
      console.error(error);
      await this.aviso(this.mensajeError(error, estado), 'danger');
      return false;
    }
  }

  /**
   * Registra una toma "ahora" de un medicamento según necesidad. Revisa las tomas de hoy y de las
   * últimas horas contra la indicación del médico (máximo al día, horas entre tomas) y abre la
   * ventana de registro con la indicación, cuántas van y los avisos; pide motivo e intensidad
   * (opcionales). Si se pasa de lo indicado avisa, pero no impide: quien cuida decide.
   */
  async registrarAhora(
    personaId: string,
    m: Medicamento,
    ultima: Toma | undefined,
    { puedeResurtir = false }: OpcionesMarcarToma = {},
  ): Promise<boolean> {
    if (!m.id) return false;
    const ahora = new Date();
    const horas = Math.max(m.horasEntreTomas ?? 1, 1);
    const desde = new Date(Math.min(inicioDeDia(ahora).getTime(), ahora.getTime() - horas * 3_600_000));
    let recientes: Toma[];
    try {
      recientes = await this.medsSvc.tomasDesde(personaId, m.id, desde);
    } catch {
      // Sin conexión y sin caché: se revisa al menos contra la última toma conocida
      recientes = ultima ? [ultima] : [];
    }
    const revision = revisarNuevaToma(m, recientes, ahora);
    const modal = await this.modalCtrl.create({
      component: TomaSegunNecesidadModal,
      componentProps: {
        medicamento: m,
        revision,
        avisos: [...revision.avisos, this.avisoAgotado(m)].filter(Boolean),
        ultimaTexto: this.ultimaTomaTexto(ultima),
      },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosTomaSegunNecesidad>();
    if (role !== 'registrar' || !data) return false;
    try {
      await this.medsSvc.registrarToma(personaId, this.medsSvc.dosisAhora(m), 'tomada', data.nota, {
        motivo: data.motivo,
        intensidad: data.intensidad,
      });
      if (agotado(m)) await this.avisarAgotado(m, puedeResurtir);
      else await this.aviso(`Toma de ${m.nombre} registrada.`, 'success');
      return true;
    } catch (error) {
      console.error(error);
      await this.aviso(
        error instanceof TomaNoPermitida ? error.message : 'No se pudo registrar la toma.',
        'danger',
      );
      return false;
    }
  }

  /**
   * Hoja de opciones de una dosis: marcar (el estado contrario si ya tiene registro), nota y quitar;
   * una según necesidad, solo nota y quitar. Un registro de otra persona solo lo cambia quien lo hizo
   * o el responsable: a los demás se les dice quién lo registró y no se ofrecen acciones.
   */
  async opciones(personaId: string, d: DosisProgramada, opciones: OpcionesMarcarToma = {}) {
    const puedeCambiar = this.puedeQuitar(d, opciones);
    const t = d.toma;
    if (t && !puedeCambiar) {
      const alerta = await this.alertCtrl.create({
        header: `${d.medicamento.nombre} · ${d.horario}`,
        message: `${t.tomado ? 'Tomada' : 'No tomada'} · registrada por ${t.registradoNombre ?? 'otra persona'}${
          t.nota ? ` · ${t.nota}` : ''
        }. Si hay un error, pídele a esa persona o al responsable que lo corrija.`,
        buttons: ['Entendido'],
      });
      await alerta.present();
      return;
    }
    const botones = [];
    if (!d.aDemanda && (!t || !t.tomado)) {
      botones.push({
        text: 'Marcar como tomada',
        icon: 'checkmark-circle-outline',
        handler: () => {
          void this.marcar(personaId, d, 'tomada', opciones);
        },
      });
    }
    if (!d.aDemanda && (!t || t.tomado)) {
      botones.push({
        text: 'Marcar como no tomada',
        icon: 'close-circle-outline',
        handler: () => {
          void this.marcar(personaId, d, 'omitida', opciones);
        },
      });
    }
    if (t) {
      botones.push(
        {
          text: t.nota ? 'Editar nota' : 'Agregar nota',
          icon: 'create-outline',
          handler: () => {
            void this.editarNota(personaId, d);
          },
        },
        {
          text: 'Quitar registro',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.marcar(personaId, d, 'quitar', opciones);
          },
        },
      );
    }
    const sheet = await this.actionSheetCtrl.create({
      header: `${d.medicamento.nombre} · ${d.horario}${d.aDemanda ? ' · según necesidad' : ''}`,
      subHeader: t
        ? `${t.tomado ? 'Tomada' : 'No tomada'}${t.registradoNombre ? ` · ${t.registradoNombre}` : ''}`
        : undefined,
      buttons: [...botones, { text: 'Cancelar', role: 'cancel' }],
    });
    await sheet.present();
  }

  /** Agrega o corrige la nota de una toma ya registrada (quien la registró o el responsable). */
  async editarNota(personaId: string, d: DosisProgramada) {
    if (!d.medicamento.id || !d.toma?.id) return;
    const r = await pedirNota(this.alertCtrl, {
      header: 'Nota de la toma',
      message: `${d.medicamento.nombre} ${d.medicamento.dosis} · ${d.horario}`,
      confirmar: 'Guardar',
      nota: d.toma.nota,
    });
    if (!r.ok) return;
    try {
      await this.medsSvc.actualizarNotaToma(personaId, d.medicamento.id, d.toma.id, r.nota);
    } catch (error) {
      console.error(error);
      await this.aviso(
        'No se pudo guardar la nota. Solo quien registró la toma o el responsable pueden cambiarla.',
        'danger',
      );
    }
  }

  /** "¿Quitar el registro?": quién lo hizo, si la unidad vuelve al inventario y que no se deshace. */
  private confirmarQuitar(d: DosisProgramada): Promise<boolean> {
    const t = d.toma;
    const quien = t?.registradoNombre ? ` Registrada por ${t.registradoNombre}.` : '';
    const devuelve =
      t?.tomado && !t.sinDescuento && d.medicamento.inventario != null
        ? ' La unidad descontada vuelve al inventario.'
        : '';
    return confirmar(this.alertCtrl, {
      header: '¿Quitar el registro?',
      message: `${d.medicamento.nombre} ${d.medicamento.dosis} · ${d.horario}.${quien}${devuelve} Esta acción no se puede deshacer.`,
      confirmar: 'Quitar',
      destructivo: true,
    });
  }

  private mensajeError(error: unknown, estado: EstadoToma): string {
    if (error instanceof TomaNoPermitida) return error.message;
    const denegado = (error as { code?: string } | null)?.code === 'permission-denied';
    // Otro teléfono la registró al mismo tiempo: ya es un registro ajeno
    if (denegado) return SOLO_AUTOR_O_RESPONSABLE;
    return estado === 'quitar' ? 'No se pudo quitar el registro.' : 'No se pudo registrar la toma.';
  }

  /** "El inventario está en 0…" para la confirmación de una toma que ya no tiene de dónde descontarse. */
  private avisoAgotado(m: Medicamento): string {
    return agotado(m) ? 'El inventario está en 0: la toma se registra sin descontar.' : '';
  }

  /** Tras registrar una toma sin unidades: recuerda actualizar el inventario. */
  private avisarAgotado(m: Medicamento, puedeResurtir: boolean) {
    const quien = puedeResurtir
      ? 'actualiza el inventario'
      : 'avisa al responsable para que actualice el inventario';
    return this.aviso(
      `Toma registrada. ${m.nombre} está en 0 unidades: ${quien} si ya compraron más.`,
      'warning',
    );
  }

  private async aviso(message: string, color: 'success' | 'warning' | 'danger') {
    const t = await this.toast.create({
      message,
      color,
      duration: color === 'warning' ? 5000 : 2500,
      position: 'top',
    });
    await t.present();
  }
}
