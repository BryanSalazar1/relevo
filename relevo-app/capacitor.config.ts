import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.relevo.app',
  appName: 'Relevo',
  webDir: 'www',
  plugins: {
    PushNotifications: {
      // iOS: cómo se muestra una notificación con la app abierta (Android usa el canal "relevo")
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
