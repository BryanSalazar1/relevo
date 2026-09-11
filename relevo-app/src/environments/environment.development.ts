// Configuración de DESARROLLO (ionic serve). Reemplaza a environment.ts por
// `fileReplacements` en angular.json.
//
//  - Si ya pegaste tu config en firebase.config.ts  -> usa tu Firebase REAL.
//  - Si sigue con los placeholders "TU_..."          -> usa los EMULADORES (npm run emulators).
//  - FORZAR_EMULADORES = true obliga a usar emuladores aunque haya config real
//    (útil para probar sin tocar datos de verdad).
import { firebaseConfig, firebaseConfigurado, vapidKey } from './firebase.config';

const FORZAR_EMULADORES = false;
const useEmulators = FORZAR_EMULADORES || !firebaseConfigurado;

export const environment = {
  production: false,
  useEmulators,
  firebase: useEmulators
    ? {
        ...firebaseConfig,
        // el emulador se levanta con --project demo-relevo; el SDK debe usar el mismo id
        apiKey: 'demo-api-key',
        projectId: 'demo-relevo',
        authDomain: 'demo-relevo.firebaseapp.com',
        storageBucket: 'demo-relevo.appspot.com',
      }
    : firebaseConfig,
  vapidKey,
};
