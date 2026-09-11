// Configuración de PRODUCCIÓN (ng build). Siempre Firebase real.
import { firebaseConfig, vapidKey } from './firebase.config';

export const environment = {
  production: true,
  useEmulators: false,
  firebase: firebaseConfig,
  vapidKey,
};
