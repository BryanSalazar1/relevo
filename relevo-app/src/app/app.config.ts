import {
  ApplicationConfig,
  LOCALE_ID,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { provideServiceWorker } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';

import { getApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import {
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  provideAuth,
} from '@angular/fire/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  provideFirestore,
} from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { initializeAppCheck, provideAppCheck } from '@angular/fire/app-check';
import { ReCaptchaEnterpriseProvider } from 'firebase/app-check';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { recaptchaSiteKey } from '../environments/firebase.config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // paramsInheritanceStrategy: las pestañas de /personas/:id leen el :id del padre
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    { provide: LOCALE_ID, useValue: 'es' },
    provideIonicAngular({}),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    // ------------------------------------------------------------------
    // Firebase (ver README.md > "Conectar con Firebase")
    // ------------------------------------------------------------------
    provideFirebaseApp(() => initializeApp(environment.firebase)),

    provideAuth(() => {
      // En Android/iOS el WebView de Capacitor necesita persistencia explicita
      // para que la sesion sobreviva al cerrar la app.
      const auth = Capacitor.isNativePlatform()
        ? initializeAuth(getApp(), { persistence: indexedDBLocalPersistence })
        : getAuth();
      if (environment.useEmulators) {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      }
      return auth;
    }),

    provideFirestore(() => {
      // Cache local persistente = "modo offline": la app funciona sin conexion
      // y Firestore sincroniza solo al recuperar senal.
      const db = initializeFirestore(getApp(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
      if (environment.useEmulators) {
        connectFirestoreEmulator(db, 'localhost', 8080);
      }
      return db;
    }),

    provideStorage(() => {
      const storage = getStorage();
      if (environment.useEmulators) {
        connectStorageEmulator(storage, 'localhost', 9199);
      }
      return storage;
    }),

    // App Check: Google exige que la app demuestre ser legítima (reCAPTCHA Enterprise) para usar
    // Firebase AI Logic (el asistente). No se usa con los emuladores. Para pruebas automatizadas
    // se define `self.FIREBASE_APPCHECK_DEBUG_TOKEN` antes de cargar la app.
    ...(environment.useEmulators
      ? []
      : [
          provideAppCheck(() =>
            initializeAppCheck(getApp(), {
              provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
              isTokenAutoRefreshEnabled: true,
            }),
          ),
        ]),
  ],
};
