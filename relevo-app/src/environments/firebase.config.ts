// ============================================================================
//  ÚNICO lugar donde vive la configuración de Firebase.
//
//  Proyecto: relevo-e5eaf (app web "Relevo web"). Si necesitas volver a copiarla:
//  Firebase Console > (engrane) Configuración del proyecto > Tus apps > Relevo web > Config.
//
//  Si apiKey empieza con "TU_", la app usa los EMULADORES locales (npm run emulators).
// ============================================================================
export const firebaseConfig = {
  apiKey: 'AIzaSyDoPWjsZHeGFsA_j3GS83EUNCnwahYsZO4',
  authDomain: 'relevo-e5eaf.firebaseapp.com',
  projectId: 'relevo-e5eaf',
  storageBucket: 'relevo-e5eaf.firebasestorage.app',
  messagingSenderId: '765182515374',
  appId: '1:765182515374:web:3df670fec1f738b96ef53f',
};

// Clave pública de Web Push (Cloud Messaging > Web configuration > Web Push certificates).
// Solo hace falta para notificaciones push en web/PWA.
export const vapidKey = 'TU_VAPID_KEY';

/** true cuando ya se pegó un config real */
export const firebaseConfigurado = !firebaseConfig.apiKey.startsWith('TU_');

/** URL pública de la app (Firebase Hosting). Se usa en los enlaces y códigos QR de invitación. */
export const appUrl = 'https://relevo-e5eaf.web.app';

/**
 * Modelo de Gemini usado por el asistente (Firebase AI Logic, proveedor "Gemini Developer API",
 * gratis en el plan Spark). Cambia aquí el modelo si Google publica uno nuevo o retira este.
 */
export const modeloIA = 'gemini-3.6-flash';

/**
 * Llave de sitio de reCAPTCHA Enterprise (pública) para Firebase App Check. Google exige App Check
 * para usar Firebase AI Logic; la llave admite los dominios relevo-e5eaf.web.app,
 * relevo-e5eaf.firebaseapp.com y localhost (WebView de Android / ionic serve).
 */
export const recaptchaSiteKey = '6LfEfbYtAAAAAP1D7kxTfnkC-zltFk3HedEX3Lyu';
