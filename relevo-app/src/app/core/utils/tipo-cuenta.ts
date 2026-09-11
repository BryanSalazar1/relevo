import { AlertController } from '@ionic/angular';
import { TIPOS_USUARIO, TipoUsuario } from '../models';

/**
 * Pide el tipo de cuenta a un usuario registrado antes de que existiera esta opción.
 * Devuelve null si cierra sin elegir.
 */
export async function pedirTipoCuenta(alertCtrl: AlertController): Promise<TipoUsuario | null> {
  const alerta = await alertCtrl.create({
    header: '¿Qué tipo de cuenta tienes?',
    message: 'Tu cuenta aún no lo tiene definido. Después no se puede cambiar.',
    backdropDismiss: false,
    inputs: TIPOS_USUARIO.map((t, i) => ({
      type: 'radio' as const,
      label: t.etiqueta,
      value: t.valor,
      checked: i === 0,
    })),
    buttons: [
      { text: 'Ahora no', role: 'cancel' },
      { text: 'Guardar', role: 'confirm' },
    ],
  });
  await alerta.present();
  const { role, data } = await alerta.onDidDismiss<{ values: TipoUsuario }>();
  return role === 'confirm' ? (data?.values ?? null) : null;
}
