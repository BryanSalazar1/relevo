// Verifica en producción el límite diario de la IA: dos preguntas cortas y el contador "restantes" debe bajar.
// Uso: RELEVO_DEMO_EMAIL=... RELEVO_DEMO_PASSWORD=... node tests/evidencias/verificar-cuota-ia.mjs
import { readFileSync } from 'node:fs';
const { initializeApp } = await import('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
const { getFunctions, httpsCallable } = await import('firebase/functions');
const src = readFileSync(new URL('../../src/environments/firebase.config.ts', import.meta.url), 'utf8');
const campo = (k) => src.match(new RegExp(`${k}:\\s*'([^']+)'`))[1];
const app = initializeApp({ apiKey: campo('apiKey'), authDomain: campo('authDomain'), projectId: campo('projectId'), appId: campo('appId') });
const auth = getAuth(app);
const preguntar = httpsCallable(getFunctions(app, 'us-central1'), 'preguntarAsistente');
await signInWithEmailAndPassword(auth, process.env.RELEVO_DEMO_EMAIL, process.env.RELEVO_DEMO_PASSWORD);
const persona = process.env.RELEVO_DEMO_PERSONA || 'persona-elena';
const contexto = 'PERSONA CUIDADA: Elena Ramírez. BITÁCORA: - (sin registros en este periodo)';
for (let i = 1; i <= 2; i++) {
  const { data } = await preguntar({ personaId: persona, contexto, pregunta: '¿Hay registros esta semana?', hoy: new Date().toISOString(), historial: [] });
  console.log(`consulta ${i}: restantes hoy = ${data.restantes} · respuesta: ${String(data.texto).slice(0, 90).replace(/\s+/g, ' ')}`);
}
await signOut(auth);
process.exit(0);
