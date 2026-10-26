import { AlertController } from '@ionic/angular';

/** Longitud máxima de las notas de tomas y tareas. */
export const NOTA_MAX = 200;

/**
 * Cuadro de confirmación con un campo de nota opcional, para todo lo que se marca en la app
 * (tomas, tareas): "¿Marcar Desayuno como no hecha?" + "Nota (opcional)".
 */
export async function pedirNota(
  alertCtrl: AlertController,
  o: { header: string; message?: string; confirmar: string; nota?: string },
): Promise<{ ok: boolean; nota?: string }> {
  const alerta = await alertCtrl.create({
    header: o.header,
    message: o.message,
    inputs: [
      {
        name: 'nota',
        type: 'textarea',
        value: o.nota ?? '',
        placeholder: 'Nota (opcional): por qué, cómo estuvo…',
        attributes: { maxlength: NOTA_MAX, autocapitalize: 'sentences' },
      },
    ],
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: o.confirmar, role: 'confirm' },
    ],
  });
  await alerta.present();
  const { role, data } = await alerta.onDidDismiss<{ values: { nota?: string } }>();
  if (role !== 'confirm') return { ok: false };
  return { ok: true, nota: data?.values?.nota?.trim() || undefined };
}

/**
 * Cuadro de confirmación sin nota, para lo que no se puede deshacer ("¿Quitar el registro?").
 * Devuelve true si se confirmó. Con `destructivo`, el botón de confirmar se marca en rojo.
 */
export async function confirmar(
  alertCtrl: AlertController,
  o: { header: string; message?: string; confirmar: string; destructivo?: boolean },
): Promise<boolean> {
  const rolConfirmar = o.destructivo ? 'destructive' : 'confirm';
  const alerta = await alertCtrl.create({
    header: o.header,
    message: o.message,
    buttons: [
      { text: 'Cancelar', role: 'cancel' },
      { text: o.confirmar, role: rolConfirmar },
    ],
  });
  await alerta.present();
  const { role } = await alerta.onDidDismiss();
  return role === rolConfirmar;
}
