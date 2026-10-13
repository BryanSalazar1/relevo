import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Medicamento } from '../../core/models';
import {
  LIMITES_MEDICAMENTO,
  MedicamentosService,
  unidadesRestantes,
} from '../../core/services/medicamentos.service';

/**
 * El responsable suma al inventario las unidades que compraron. Se usa desde el plan de
 * medicamentos y desde el aviso "Por resurtir" de Hoy, con el mismo cuadro y las mismas reglas.
 */
@Injectable({ providedIn: 'root' })
export class ResurtirService {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);
  /** Hay un cuadro de "Resurtir" abierto: un doble toque abriría dos y sumaría dos veces */
  private abierto = false;

  /**
   * Pide las unidades (propone las del último resurtido, o 30) y las suma. `actual` devuelve el
   * medicamento más reciente, porque mientras el cuadro está abierto pudo registrarse una toma.
   */
  async resurtir(personaId: string, m: Medicamento, actual: () => Medicamento | undefined) {
    if (!m.id || this.abierto) return;
    this.abierto = true;
    try {
      await this.pedir(personaId, m, actual);
    } finally {
      this.abierto = false;
    }
  }

  /** Por qué no se pueden sumar esas unidades al inventario ('' si sí se puede). */
  private motivoInvalido(m: Medicamento, unidades: number): string {
    const maximo = LIMITES_MEDICAMENTO.inventario;
    if (!Number.isInteger(unidades) || unidades < 1) {
      return 'Escribe cuántas unidades compraron: un número entero de 1 en adelante.';
    }
    if ((unidadesRestantes(m) ?? 0) + unidades > maximo) {
      return `El inventario no puede pasar de ${maximo} unidades.`;
    }
    return '';
  }

  private async pedir(personaId: string, m: Medicamento, actual: () => Medicamento | undefined) {
    const quedan = unidadesRestantes(m);
    const alerta = await this.alertCtrl.create({
      header: `Resurtir ${m.nombre}`,
      message:
        quedan === null
          ? 'Este medicamento no lleva inventario. ¿Con cuántas unidades empieza?'
          : `${quedan === 0 ? 'Ya no quedan unidades' : quedan === 1 ? 'Queda 1' : `Quedan ${quedan}`}. ¿Cuántas compraron?`,
      inputs: [
        {
          name: 'unidades',
          type: 'number',
          min: 1,
          value: m.ultimoResurtido ?? 30,
          placeholder: 'Unidades que compraron',
          attributes: { inputmode: 'numeric' },
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Resurtir',
          role: 'confirm',
          handler: (valores: { unidades?: string }) => {
            const motivo = this.motivoInvalido(m, Number(valores?.unidades));
            if (!motivo) return true;
            // El cuadro sigue abierto para que corrija la cantidad
            void this.aviso(motivo, 'danger');
            return false;
          },
        },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{ values: { unidades?: string } }>();
    if (role !== 'confirm') return;
    const unidades = Number(data?.values?.unidades);
    const reciente = actual() ?? m;
    const motivo = this.motivoInvalido(reciente, unidades);
    if (motivo) return this.aviso(motivo, 'danger');
    try {
      await this.medsSvc.resurtir(personaId, reciente, unidades);
      const total = (unidadesRestantes(reciente) ?? 0) + unidades;
      await this.aviso(`Inventario de ${m.nombre}: ${total} unidades.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo actualizar el inventario.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
