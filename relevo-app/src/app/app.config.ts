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
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

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

    // Cloud Functions invocables (asistente de IA). Misma región que functions/index.js.
    provideFunctions(() => {
      const fns = getFunctions(getApp(), 'us-central1');
      if (environment.useEmulators) {
        connectFunctionsEmulator(fns, 'localhost', 5001);
      }
      return fns;
    }),

    // App Check se retiró el 22/10/2026: solo hacía falta para Firebase AI Logic desde el cliente y
    // el asistente ya va por Cloud Functions con sesión; su reCAPTCHA solo producía errores 403.
  ],
};
