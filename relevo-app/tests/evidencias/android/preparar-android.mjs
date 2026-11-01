// Preparación del recorrido en Android, solo en los EMULADORES (después de la semilla):
//  1) cuenta familiar sin personas (Pedro), para unirse escaneando el QR;
//  2) invitación de Ana para Carmen (igual que InvitacionesService.crear);
//  3) imagen del QR de esa invitación, para la cámara virtual del emulador de Android.
//   node tests/evidencias/android/preparar-android.mjs <png del QR> [código]
// (después de `npm run semilla`; FIRESTORE_PORT si el emulador no está en 8080)
import { createRequire } from 'node:module';
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode');
const SALIDA = process.argv[2];
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const app = initializeApp({ projectId: 'demo-relevo', apiKey: 'demo-api-key' });
const auth = getAuth(app);
const db = getFirestore(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectFirestoreEmulator(db, '127.0.0.1', Number(process.env.FIRESTORE_PORT ?? 8080));

const { user } = await createUserWithEmailAndPassword(auth, 'pedro@relevo.test', 'relevo123');
await updateProfile(user, { displayName: 'Pedro Ramírez' });
await setDoc(doc(db, `usuarios/${user.uid}`), {
  uid: user.uid,
  nombre: 'Pedro Ramírez',
  email: 'pedro@relevo.test',
  tipo: 'familiar',
  fcmTokens: [],
  personas: [],
  creadoEn: serverTimestamp(),
});
await signOut(auth);

const ana = (await signInWithEmailAndPassword(auth, 'ana@relevo.test', 'relevo123')).user;
const codigo = process.argv[3] || Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => ALFABETO[b % ALFABETO.length]).join('');
const expira = new Date();
expira.setDate(expira.getDate() + 7);
await setDoc(doc(db, 'invitaciones', codigo), {
  codigo,
  personaId: 'persona-demo',
  personaNombre: 'Carmen Hernández',
  creadoPor: ana.uid,
  creadoEn: serverTimestamp(),
  expiraEn: Timestamp.fromDate(expira),
  activa: true,
  usos: 0,
  usosMax: 10,
});
const enlace = `https://relevo-e5eaf.web.app/unirse/${codigo}`;
await QRCode.toFile(SALIDA, enlace, { width: 900, margin: 4, errorCorrectionLevel: 'M' });
console.log('listo', codigo, enlace);
process.exit(0);
