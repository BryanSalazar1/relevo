import { Injectable, inject } from '@angular/core';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { Medicamento, Toma } from '../../core/models';
import {
  DosisProgramada,
  EstadoToma,
  MedicamentosService,
  TomaNoPermitida,
  agotado,
} from '../../core/services/medicamentos.service';
import { haceCuanto, textoDuracion } from '../../core/utils/fechas';
import { pedirNota } from '../../core/utils/notas';

/** Marcar una dosis con más de estos minutos de anticipación muestra un aviso en la confirmación. */
const DOSIS_ADELANTADA_MIN = 60;
/** Una toma según necesidad con otra registrada hace menos de estos minutos avisa de un posible duplicado. */
const TOMA_RECIENTE_MIN = 60;

export interface OpcionesMarcarToma {
  /** Quien marca puede resurtir (responsable): cambia el aviso cuando el inventario está en 0 */
  puedeResurtir?: boolean;
}

/**
 * Registrar tomas de medicamentos, igual desde Hoy que desde el Semáforo: confirmación con nota
 * opcional, avisos (dosis adelantada, inventario en 0, posible duplicado según necesidad), las
 * opciones de una toma ya registrada y la edición de su nota. Es el par de MarcarTareaService.
 */
@Injectable({ providedIn: 'root' })
export class MarcarTomaService {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly toast = inject(ToastController);

  /** "Última toma: hace 3 h (10:15) · Ana · nota" o "Sin tomas registradas". */
  ultimaTomaTexto(t: Toma | undefined): string {
    if (!t) return 'Sin tomas registradas';
    const quien = t.registradoNombre ? ` · ${t.registradoNombre}` : '';
    const nota = t.nota ? ` · ${t.nota}` : '';
    return `Última toma: ${haceCuanto((t.horaReal ?? t.horaProgramada).toDate())}${quien}${nota}`;
  }

  /**
   * Marca una dosis programada como tomada / no tomada (con confirmación y nota) o quita su
   * registro. Devuelve false si se canceló. Los errores se muestran aquí.
   */
  async marcar(
    personaId: string,
    d: DosisProgramada,
    estado: EstadoToma,
    { puedeResurtir = false }: OpcionesMarcarToma = {},
  ): Promise<boolean> {
    let nota: string | undefined;
    // Se marca tomada (no lo estaba) y ya no quedan unidades: se registra, pero no hay de dónde descontar
    const sinUnidades = estado === 'tomada' && !d.toma?.tomado && agotado(d.medicamento);
    if (estado !== 'quitar') {
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

  /** Registra una toma "ahora" de un medicamento según necesidad (con confirmación y nota). */
  async registrarAhora(
    personaId: string,
    m: Medicamento,
    ultima: Toma | undefined,
    { puedeResurtir = false }: OpcionesMarcarToma = {},
  ): Promise<boolean> {
    if (!m.id) return false;
    const haceMin = ultima
      ? (Date.now() - (ultima.horaReal ?? ultima.horaProgramada).toDate().getTime()) / 60000
      : null;
    const avisos = [
      haceMin !== null && haceMin < TOMA_RECIENTE_MIN
        ? 'Ya hay una toma de hace menos de una hora: revisa que no sea un registro repetido.'
        : '',
      this.avisoAgotado(m),
    ].filter(Boolean);
    const r = await pedirNota(this.alertCtrl, {
      header: `¿Registrar una toma de ${m.nombre}?`,
      message: [`${m.dosis} · ahora. ${this.ultimaTomaTexto(ultima)}.`, ...avisos].join(' '),
      confirmar: 'Registrar',
    });
    if (!r.ok) return false;
    try {
      await this.medsSvc.registrarToma(personaId, this.medsSvc.dosisAhora(m), 'tomada', r.nota);
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

  /** Hoja de opciones de una dosis: marcar, nota y quitar (una según necesidad solo nota y quitar). */
  async opciones(personaId: string, d: DosisProgramada, opciones: OpcionesMarcarToma = {}) {
    const notaYQuitar = d.toma
      ? [
          {
            text: d.toma.nota ? 'Editar nota' : 'Agregar nota',
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
        ]
      : [];
    const marcar = d.aDemanda
      ? []
      : [
          {
            text: 'Marcar como tomada',
            icon: 'checkmark-circle-outline',
            handler: () => {
              void this.marcar(personaId, d, 'tomada', opciones);
            },
          },
          {
            text: 'Marcar como no tomada',
            icon: 'close-circle-outline',
            handler: () => {
              void this.marcar(personaId, d, 'omitida', opciones);
            },
          },
        ];
    const sheet = await this.actionSheetCtrl.create({
      header: `${d.medicamento.nombre} · ${d.horario}${d.aDemanda ? ' · según necesidad' : ''}`,
      buttons: [...marcar, ...notaYQuitar, { text: 'Cancelar', role: 'cancel' }],
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
