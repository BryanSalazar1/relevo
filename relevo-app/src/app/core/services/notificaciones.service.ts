import { Injectable, inject } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, arrayRemove, arrayUnion, doc, updateDoc } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  ActionPerformed,
  Channel,
  PushNotificationSchema,
  PushNotifications,
  Token,
} from '@capacitor/push-notifications';
import { ToastController } from '@ionic/angular';

/** Clave en Preferences con el token FCM de este teléfono (para quitarlo al cerrar sesión). */
const CLAVE_TOKEN = 'fcmToken';

/** Canal de notificaciones en Android; las Cloud Functions envían a este mismo id. */
export const CANAL_ANDROID: Channel = {
  id: 'relevo',
  name: 'Relevo',
  description: 'Bitácora, tomas de medicamentos y recordatorios',
  importance: 4,
  visibility: 1,
};

/**
 * Notificaciones push en el teléfono (Android/iOS vía Capacitor + FCM).
 *
 * Al iniciar sesión pide permiso, registra el dispositivo y guarda el token en
 * `usuarios/{uid}.fcmTokens`; las Cloud Functions (functions/index.js) envían a esos tokens.
 * En web no hace nada: a quien no tiene token se le avisa por correo.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);

  /** Llamar una sola vez al arrancar la app (App). */
  iniciar() {
    if (!Capacitor.isNativePlatform()) return;
    authState(this.auth).subscribe((user) => {
      if (user) void this.registrarDispositivo(user.uid);
    });
  }

  /** Quita el token de este teléfono del perfil. Llamar ANTES de cerrar sesión (las rules lo exigen). */
  async quitarDispositivo(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    const uid = this.auth.currentUser?.uid;
    try {
      const { value: token } = await Preferences.get({ key: CLAVE_TOKEN });
      if (uid && token) {
        await updateDoc(doc(this.db, 'usuarios', uid), { fcmTokens: arrayRemove(token) });
      }
      await Preferences.remove({ key: CLAVE_TOKEN });
      await PushNotifications.removeAllListeners();
      await PushNotifications.unregister();
    } catch (error) {
      console.warn('No se pudo dar de baja el dispositivo de notificaciones', error);
    }
  }

  /** Registra este teléfono para recibir push (también al dar permiso desde Notificaciones). */
  async registrarDispositivo(uid: string) {
    try {
      let permiso = await PushNotifications.checkPermissions();
      if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
        permiso = await PushNotifications.requestPermissions();
      }
      if (permiso.receive !== 'granted') return;

      await PushNotifications.removeAllListeners();
      await PushNotifications.addListener('registration', (token: Token) => {
        void this.guardarToken(uid, token.value);
      });
      await PushNotifications.addListener('registrationError', (error) => {
        console.error('No se pudo registrar el dispositivo en FCM', error);
      });
      await PushNotifications.addListener(
        'pushNotificationReceived',
        (n: PushNotificationSchema) => {
          void this.mostrarEnPrimerPlano(n);
        },
      );
      await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (a: ActionPerformed) => {
          this.abrir(a);
        },
      );

      if (Capacitor.getPlatform() === 'android') {
        await PushNotifications.createChannel(CANAL_ANDROID);
      }
      await PushNotifications.register();
    } catch (error) {
      console.warn('Notificaciones push no disponibles en este dispositivo', error);
    }
  }

  private async guardarToken(uid: string, token: string) {
    try {
      await updateDoc(doc(this.db, 'usuarios', uid), { fcmTokens: arrayUnion(token) });
      await Preferences.set({ key: CLAVE_TOKEN, value: token });
    } catch (error) {
      console.warn('No se pudo guardar el token de notificaciones', error);
    }
  }

  /** Con la app abierta Android no muestra la notificación: se enseña como aviso dentro de la app. */
  private async mostrarEnPrimerPlano(n: PushNotificationSchema) {
    const url = this.urlDe(n.data);
    const t = await this.toast.create({
      header: n.title,
      message: n.body,
      duration: 5000,
      position: 'top',
      buttons: url
        ? [{ text: 'Ver', handler: () => void this.router.navigateByUrl(url) }]
        : undefined,
    });
    await t.present();
  }

  /** Al tocar la notificación se abre la pantalla que indica `data.url`. */
  private abrir(a: ActionPerformed) {
    const url = this.urlDe(a.notification.data);
    if (url) void this.router.navigateByUrl(url);
  }

  private urlDe(data: unknown): string | null {
    const url = (data as { url?: unknown } | undefined)?.url;
    return typeof url === 'string' && url.startsWith('/') ? url : null;
  }
}
