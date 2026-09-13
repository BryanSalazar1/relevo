# Relevo — bitácora compartida de cuidado

App multiplataforma (móvil + web/PWA) para que familiares, cuidadores y médicos lleven un
historial compartido y en tiempo real del cuidado de una persona. Ver `../Relevo_Documentacion.docx`.

| Capa | Tecnología |
| --- | --- |
| UI | Ionic 9 + Angular 20 (standalone, signals) |
| Nativo | Capacitor 8 (Android / iOS) + PWA con Service Worker |
| Backend | Firebase: Authentication, Firestore, Storage, Cloud Messaging |
| Integración | `@angular/fire` 20 (Firebase SDK 11) |

---

## 1. Requisitos

| Herramienta | Versión | Estado en esta máquina |
| --- | --- | --- |
| Node.js | ≥ 20.19 | ✅ 20.19.4 |
| npm | ≥ 10 | ✅ 10.8.2 |
| Ionic CLI | 7 | ✅ 7.2.1 (`npm i -g @ionic/cli`) |
| Firebase CLI | 15 | ✅ 15.29.0 (`npm i -g firebase-tools`) |
| JDK (Temurin) | 21 | ✅ 21.0.12 (`winget install EclipseAdoptium.Temurin.21.JDK`) — emuladores y Android |
| Android SDK (cmdline-tools, platform 36, build-tools 36) | — | ✅ en `%LOCALAPPDATA%\Android\Sdk` (sin Android Studio); `ANDROID_HOME` configurado |
| Android Studio | opcional | ⬜ solo si quieres emulador o depurar en el IDE; detecta el SDK anterior |
| Xcode | 15+ | ⬜ solo en macOS, para iOS |

---

## 2. Comandos del día a día

```bash
npm install                 # instala dependencias (usa .npmrc → legacy-peer-deps)
ionic serve                 # desarrollo web en http://localhost:8100 (o npm start → :4200)
ionic build                 # build de producción a la carpeta www/ (la que usa Capacitor)

# Android (requiere Android Studio instalado)
npx cap add android         # solo la primera vez: crea la carpeta android/
npx cap sync                # copia www/ y plugins al proyecto nativo (después de cada build)
npm run cap:sync            # atajo: ng build + cap sync
npx cap open android        # abre Android Studio para correr en emulador/dispositivo

# Firebase
npm run emulators           # emuladores locales SIN cuenta (Auth 9099, Firestore 8080, Storage 9199, UI 4000)
npm run test:rules          # prueba las Security Rules contra el emulador (tests/firestore.rules.test.mjs)
firebase login              # una sola vez, cuando ya tengas proyecto real
firebase use --add          # vincula esta carpeta con tu proyecto de Firebase (crea .firebaserc)
npm run deploy:rules        # sube firestore.rules al proyecto real
npm run deploy:storage      # sube storage.rules (solo si activaste Storage, §4.6)
npm run semilla:real        # usuarios y datos de prueba en tu proyecto real
npm run test:e2e            # prueba de humo con navegador real contra la app publicada (Playwright)
firebase deploy --only hosting   # publica la PWA (www/) en Firebase Hosting → https://relevo-e5eaf.web.app
```

---

## 3. Estructura del proyecto

```
relevo-app/
├── capacitor.config.ts          # appId com.relevo.app, webDir www
├── firebase.json                # rules, hosting, emuladores
├── firestore.rules              # Security Rules por persona cuidada y rol
├── storage.rules                # Reglas de Storage (fotos/documentos)
├── firestore.indexes.json
├── ngsw-config.json             # Service Worker (PWA)
├── .npmrc                       # legacy-peer-deps=true (ver §8)
└── src/
    ├── environments/
    │   ├── firebase.config.ts           # ← ÚNICO lugar donde se pega el firebaseConfig
    │   ├── environment.ts               # producción: siempre Firebase real
    │   └── environment.development.ts   # ng serve: real si hay config, si no emuladores
    └── app/
        ├── app.config.ts        # providers: Ionic, Router, PWA y **Firebase**
        ├── app.routes.ts        # /login, /home, /unirse/:codigo, /personas/:id/(bitacora|equipo|reporte)
        ├── core/
        │   ├── models/index.ts          # tipos del modelo de datos (sección 7 del doc) + invitaciones
        │   ├── guards/auth.guard.ts     # authGuard / noAuthGuard (recuerdan a dónde ibas con ?volver=)
        │   ├── utils/                   # fechas.ts (agrupar por día, rangos), persona-actual.ts
        │   └── services/
        │       ├── auth.service.ts      # registro, login, logout, usuarios/{uid}
        │       ├── personas.service.ts  # personas_cuidadas + miembros (batch)
        │       ├── miembros.service.ts  # miembros de una persona, mi rol, quitar
        │       ├── bitacora.service.ts  # entradas_bitacora en tiempo real y por rango
        │       ├── invitaciones.service.ts  # códigos/QR: crear, buscar, canjear, cancelar
        │       └── reporte.service.ts   # resumen semanal/mensual + PDF (jsPDF) + compartir
        └── pages/
            ├── login/           # correo + contraseña (login / registro)
            ├── home/            # lista "mis personas" + "Unirme con código o QR"
            ├── persona/         # pestañas de una persona: Bitácora · Equipo · Reporte
            ├── bitacora/        # feed agrupado por día, filtro por tipo, modal de registro
            ├── equipo/          # perfil, miembros, invitaciones y modal con QR
            ├── unirse/          # escribir código o escanear QR con la cámara
            └── reporte/         # reporte en pantalla + "Exportar PDF para el médico"
android/                         # proyecto nativo Android (Capacitor 8) — ver §10
tests/                           # firestore.rules.test.mjs (emulador) · e2e.smoke.mjs (Playwright)
scripts/                         # con-java.js · semilla.mjs
```

---

## 4. Conectar con Firebase (paso a paso)

> **Estado (2026-09-10):** ya está hecho. Proyecto `relevo-e5eaf` (plan Spark, cuenta
> `2202110@universidad-une.com`), app web `Relevo web`, Auth Correo/Contraseña activo, Firestore
> en `nam5`, reglas publicadas y datos de prueba sembrados (`npm run semilla:real`). La carpeta
> está vinculada con `.firebaserc`. Los pasos de abajo quedan como referencia para rehacerlo.
> Pendiente: Storage (§4.6, requiere plan Blaze) y push (§7).

### 4.1 Crear el proyecto
1. Entra a <https://console.firebase.google.com> → **Agregar proyecto** → nombre `relevo`.
2. Google Analytics: puedes desactivarlo (no se usa en el MVP) → **Crear proyecto**.

### 4.2 Registrar la app web y copiar la configuración
1. En la portada del proyecto toca el icono **`</>`** (Web).
2. Apodo: `Relevo web`. Marca *Firebase Hosting* solo si quieres publicar la PWA ahí. → **Registrar app**.
3. Copia el objeto `firebaseConfig` que te muestra:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "relevo-xxxx.firebaseapp.com",
     projectId: "relevo-xxxx",
     storageBucket: "relevo-xxxx.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef123456"
   };
   ```

4. Pégalo en **`src/environments/firebase.config.ts`** (reemplaza el objeto `firebaseConfig`).
   Es el único lugar; `environment.ts` y `environment.development.ts` lo importan de ahí.
   Si lo pierdes: ⚙️ *Configuración del proyecto → Tus apps → SDK setup*.
5. Guarda: `ionic serve` detecta que ya hay config y deja de usar los emuladores.

> La `apiKey` web de Firebase **no es secreta**: identifica el proyecto, no autoriza nada.
> Lo que protege los datos son las Security Rules (§4.5).

### 4.3 Activar Authentication
1. Menú **Compilación → Authentication → Comenzar**.
2. Pestaña **Sign-in method → Correo electrónico/contraseña → Habilitar → Guardar**.
3. (Opcional, después) Google, teléfono, etc.

### 4.4 Crear la base de datos Firestore
1. **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: la más cercana a tus usuarios (p. ej. `nam5 (us-central)` o `southamerica-east1`). **No se puede cambiar después.**
3. Modo **producción** (todo bloqueado hasta que subas tus reglas en §4.5) → **Crear**.

### 4.5 Subir las Security Rules
Las reglas ya están escritas en `firestore.rules` y `storage.rules`. Súbelas desde esta carpeta:

```bash
firebase login
firebase use --add        # elige tu proyecto y ponle alias "default"
npm run deploy:rules      # = firebase deploy --only firestore:rules
```

Alternativa sin CLI: copia el contenido de `firestore.rules` en *Firestore → Reglas → Publicar*.

### 4.6 Storage (fotos y documentos)
**Compilación → Storage → Comenzar** → modo producción → misma ubicación que Firestore.
Luego `npm run deploy:storage` (= `firebase deploy --only storage`).

> ⚠️ Desde finales de 2024, los proyectos nuevos necesitan el plan **Blaze** (pago por uso, con
> cuota gratuita generosa) para activar Storage. Si no quieres registrar tarjeta ahora, deja
> Storage para después: **Auth y Firestore funcionan en el plan gratuito Spark.**

### 4.7 Probar la conexión de punta a punta
```bash
npm run semilla:real      # opcional: crea ana/marta/sofia/luis@relevo.test (pass relevo123) y a Carmen
ionic serve
```
1. Se abre `/login`. Entra con `ana@relevo.test` / `relevo123`, o toca **¿No tienes cuenta? Regístrate**.
2. En la consola: **Authentication → Users** debe aparecer el correo, y
   **Firestore → usuarios/{uid}** el perfil creado por `AuthService.registrar()`.
3. En `/home` toca **+**, escribe un nombre y elige tu rol. Debe aparecer al instante en la lista
   (Firestore en tiempo real) y en la consola verás `personas_cuidadas/{id}` con su subcolección
   `miembros/{tu uid}`.
4. Abre la app en dos pestañas: al crear una persona en una, aparece en la otra sin recargar.

Si algo falla, el mensaje del toast te dice qué es (p. ej. "Falta habilitar Correo/Contraseña").
Abre la consola del navegador (F12) para ver el error completo de Firebase.

---

## 5. Cómo está hecha la conexión (para entenderla / defenderla)

`src/app/app.config.ts` registra Firebase con los providers de AngularFire:

```ts
provideFirebaseApp(() => initializeApp(environment.firebase)),  // 1. inicializa con tu config
provideAuth(() => getAuth()),                                    // 2. Authentication
provideFirestore(() => initializeFirestore(getApp(), {           // 3. Firestore con caché
  localCache: persistentLocalCache({ ... }),                     //    persistente = modo offline
})),
provideStorage(() => getStorage()),                              // 4. Storage
```

- En **Android/iOS** (`Capacitor.isNativePlatform()`) Auth se inicializa con
  `indexedDBLocalPersistence` para que la sesión no se pierda al cerrar la app.
- Con `environment.useEmulators = true` todo apunta a los emuladores locales. En desarrollo ese
  valor se calcula solo: emuladores mientras `firebase.config.ts` tenga placeholders, Firebase
  real en cuanto pegues tu config (o `FORZAR_EMULADORES = true` para obligar emuladores).
- Los servicios inyectan `Auth` y `Firestore` y usan la API modular (`collectionData`,
  `writeBatch`, `serverTimestamp`…). `PersonasService.misPersonas()` es un `Observable` en tiempo
  real convertido a signal con `toSignal()` en la página.

---

## 6. Emuladores locales (modo por defecto en desarrollo)

Permiten desarrollar **sin cuenta de Firebase**, sin gastar cuota y sin ensuciar datos reales.
Requieren Java (ya instalado: Temurin JDK 21).

```bash
npm run emulators      # terminal 1: Auth + Firestore + Storage con el proyecto ficticio demo-relevo
ionic serve            # terminal 2
```
UI de los emuladores: <http://localhost:4000> (ahí ves los usuarios y documentos que crea la app).

### Datos de prueba

Con los emuladores encendidos, `npm run semilla` crea usuarios de cada rol y una persona cuidada
con bitácora, medicamentos, signos vitales y citas (`scripts/semilla.mjs`, idempotente).
Contraseña de todos: `relevo123`.

| Correo | Tipo de cuenta | Rol con Carmen |
|---|---|---|
| ana@relevo.test | Familiar | Responsable (creó a Carmen) |
| marta@relevo.test | Enfermero/a | Cuidadora (escribe bitácora) |
| sofia@relevo.test | Familiar | Familiar (solo lectura + calendario) |
| luis@relevo.test | Médico | Médico (solo lectura) |

Los datos viven solo en el emulador: al cerrarlo se pierden y vuelves a correr la semilla.

¿Cuándo se usan? `environment.development.ts` decide solo: mientras `firebase.config.ts` tenga los
placeholders `TU_...`, `ionic serve` apunta a los emuladores (`projectId: demo-relevo`); en cuanto
pegues tu config real, apunta a tu proyecto de Firebase. Para volver a los emuladores sin borrar el
config, pon `FORZAR_EMULADORES = true` en `environment.development.ts`.

Para sembrar los mismos datos de prueba en tu **proyecto real**: `npm run semilla:real`
(requiere Auth Email/Contraseña habilitado, Firestore creado y reglas subidas; ver §4).

Los scripts `emulators` y `test:rules` pasan por `scripts/con-java.js`, que localiza el JDK
(JAVA_HOME, Eclipse Adoptium, Android Studio…) y lo antepone al PATH del proceso. Así funcionan
aunque la terminal se haya abierto antes de instalar Java. Si aun así ves
`Could not spawn java -version`, es que no hay ningún JDK instalado:
`winget install EclipseAdoptium.Temurin.21.JDK`.

Las reglas tienen pruebas automáticas en `tests/firestore.rules.test.mjs` (`npm run test:rules`):
cada vez que cambies `firestore.rules`, córrelas.

Los datos del emulador se pierden al cerrarlo. Para conservarlos:
`firebase emulators:export ./emulator-data` y luego arranca con
`firebase emulators:start --project demo-relevo --import=./emulator-data`.

---

## 7. Compilar a Android

1. Instala **Android Studio** (incluye JDK 21 y el SDK). Al terminar, en *SDK Manager* instala
   *Android SDK Platform 35* y *Build-Tools*.
2. En Firebase Console: ⚙️ → **Tus apps → Agregar app → Android**, nombre de paquete
   **`com.relevo.app`** → descarga `google-services.json`.
3. ```bash
   ionic build
   npx cap add android
   npx cap sync
   ```
   Copia `google-services.json` a `android/app/`. Luego `npx cap open android` y ejecuta en un
   emulador o teléfono con depuración USB.

Cada vez que cambies código web: `ionic build && npx cap sync`.

---

## 8. Siguiente paso delicado: notificaciones push (FCM)

La doc marca esto como lo más delicado; conviene probarlo pronto. Todo lo necesario ya está instalado
(`@angular/fire/messaging`, `@capacitor/push-notifications`). Pasos resumidos:

- **Web/PWA**: Console → *Cloud Messaging → Web configuration → Web Push certificates → Generar par
  de claves* → pega la clave pública en `vapidKey` de `firebase.config.ts`. Crear `public/firebase-messaging-sw.js`
  y añadir `provideMessaging(() => getMessaging())` en `app.config.ts` (solo si `isSupported()`).
- **Android**: con `google-services.json` en su lugar, `PushNotifications.register()` del plugin de
  Capacitor devuelve el token; guárdalo en `usuarios/{uid}.fcmTokens`.
- **Envío**: desde la consola (*Messaging → Nueva campaña*) para probar, y luego con Cloud Functions
  para recordatorios de medicamentos.

---

## 9. Notas de configuración

- **`.npmrc` con `legacy-peer-deps=true`**: `@angular/fire@20` declara un peer sobre
  `@angular/platform-browser-dynamic` que npm no logra resolver con Angular 20.3. Es un problema
  conocido y esta es la solución estándar; no afecta el funcionamiento.
- **Proyecto creado con Angular CLI + `ng add @ionic/angular`** en lugar de `ionic start`: la red
  bloquea el CDN de plantillas de Ionic (`d2ql0qc7j8u4b2.cloudfront.net`, *connection reset*). El
  resultado es el mismo proyecto que genera `ionic start blank --type=angular-standalone`.
- **El proyecto en `angular.json` se llama `app`** (no `relevo-app`): el CLI de Ionic ejecuta
  `ng run app:serve` / `ng run app:build` por defecto; con otro nombre `ionic serve` falla con
  `Unknown arguments: host, port`.
- **Build a `www/`**: `angular.json` usa `outputPath: { base: "www", browser: "" }` para que
  Capacitor y Firebase Hosting encuentren `index.html` directamente.
- **Presupuestos de bundle** ampliados (2 MB / 5 MB) porque Ionic + Firebase superan el límite
  por defecto de Angular.

---

## 10. Funcionalidades implementadas (10 de septiembre de 2026)

### Tipos de cuenta (al registrarse)
- **Familiar**: es el único que puede **dar de alta** a una persona cuidada; queda como
  **Responsable** de su bitácora (administra, invita, hace responsable a otro familiar).
- **Enfermero/a**: se une con un código y entra como cuidador: registra bitácora, tomas y signos.
- **Médico**: se une con un código y entra en solo lectura (bitácora y reportes).
- El tipo se guarda en `usuarios/{uid}.tipo`, no se puede cambiar después, y las reglas lo usan para
  decidir quién crea personas y con qué rol entra cada quien (`ROL_POR_TIPO`, `ROLES_COMPATIBLES`).
  Cuentas anteriores a esta versión lo eligen una sola vez al entrar.

### Bitácora (`/personas/:id/bitacora`)
- Feed en **tiempo real** agrupado por día (Hoy / Ayer / fecha), con 6 tipos: síntoma, ánimo,
  comida, sueño, incidente y nota. Filtro por tipo desde el embudo de la barra.
- Botón **+** abre el formulario (tipo, descripción, fecha y hora). Tocar un registro propio abre
  Editar / Eliminar.
- Permisos (en las rules y en la interfaz): responsable y enfermero/a **crean**; cada autor
  edita lo suyo y el responsable todo; familiar y médico **solo leen**.

### Compartir por código y QR (`Equipo` → *Crear invitación*)
- Al entrar a la persona → **Equipo**, el **responsable** ve de inmediato la tarjeta "Código de
  acceso" con el **QR permanente** de esa persona, su código de 8 caracteres (sin 0/O/1/I para
  dictarlo sin confusión) y botones **Compartir**, **Copiar código** y **Renovar**. Se genera solo la
  primera vez (vale 1 año y hasta 100 usos); *Renovar* crea uno nuevo e invalida el anterior. Tocar
  el QR lo abre en grande. El QR codifica `https://relevo-e5eaf.web.app/unirse/CODIGO`.
- La invitación no lleva rol: **cada persona entra según su cuenta** (familiar → familiar,
  enfermero/a → cuidador, médico → solo lectura). Los códigos temporales antiguos siguen en
  "Otros códigos activos" hasta que venzan o se cancelen.
- Para unirse: **Inicio → Unirme con código o QR**, escribir el código, **escanear** el QR con la
  cámara (navegador o app Android) o abrir el enlace (si no hay sesión, pide login y regresa).
- En **Equipo**, el responsable toca a un miembro para *Hacer responsable* (solo familiares),
  *Quitar como responsable* o *Quitar del equipo*.
- La seguridad no depende de un servidor: `invitaciones/{codigo}` + reglas con `getAfter()`
  validan en el mismo batch que el rol coincida con el tipo de cuenta y que la invitación no esté
  vencida/cancelada (pruebas 12–15 de `npm run test:rules`).

### Reporte para el médico (`/personas/:id/reporte`)
- Periodo **semana** o **mes**, con flechas para moverse entre periodos.
- Contenido: datos de la persona, resumen por tipo, síntomas e incidentes, signos vitales
  (mín / promedio / máx / última), adherencia a medicamentos y la bitácora completa.
- **Exportar PDF** (jsPDF): en web descarga o abre la hoja de compartir; en Android abre la hoja
  nativa (WhatsApp, correo, Drive…). Los medicamentos y signos se leen si existen (la semilla los
  crea); la captura desde la app queda para una etapa posterior.

### Asistente con IA (`/personas/:id/asistente`) — 11/09/2026
- Chat en lenguaje natural sobre la persona cuidada: "¿Cómo ha estado mi mamá esta semana?",
  "¿Cuántas veces se le olvidó la pastilla de la presión?", "¿Cuándo es la próxima cita?".
- `AsistenteService` arma un contexto compacto con los datos reales de Firestore de los últimos
  30 días (perfil, equipo, bitácora, medicamentos con cada toma, signos vitales, citas) y lo entrega
  como instrucción de sistema a **Gemini** (`gemini-3.6-flash`) a través de **Firebase AI Logic**,
  con reglas: responder solo con esos datos, citar fechas y autores, no inventar, no diagnosticar.
  Conversación con historial (últimas 8 vueltas); nada se guarda en Firestore.
- Cualquier miembro (familiar, enfermero/a, médico) puede usarlo; el acceso a los datos sigue
  siendo el de las reglas de Firestore (solo lee lo que el usuario ya puede leer).
- **Requisito de Google**: Firebase AI Logic solo funciona si el proyecto aplica **App Check**.
  Se configuró reCAPTCHA Enterprise (llave pública en `firebase.config.ts`, dominios
  `relevo-e5eaf.web.app`, `relevo-e5eaf.firebaseapp.com` y `localhost`) y App Check en modo
  *enforced* solo para el servicio de IA (`firebaseml.googleapis.com`); Auth y Firestore no cambian.
  Las pruebas automatizadas usan un token de depuración registrado en Firebase
  (`tests/.appcheck-debug.json`, fuera de git) inyectado como `self.FIREBASE_APPCHECK_DEBUG_TOKEN`.
- Modelo y llave se cambian en `src/environments/firebase.config.ts` (`modeloIA`, `recaptchaSiteKey`).
  Cuota: nivel gratuito de la Gemini Developer API (plan Spark).

### Android
- Carpeta `android/` generada con Capacitor 8 (`compileSdk 36`, JDK 21) y permiso `CAMERA`
  para el escáner. Cada vez que cambies la app: `npm run cap:sync`.
- Compilar: `npm run android:apk` (= build web + `cap sync` + `gradlew assembleDebug`, sin Android
  Studio; la primera vez tarda ~13 min, después ~1 min) → `android/app/build/outputs/apk/debug/app-debug.apk`.
  También puedes abrir el proyecto en Android Studio con `npx cap open android`.
- **APK ya generado el 10/09/2026** (10.4 MB): copia en `../Relevo-debug.apk`. Pásalo al teléfono
  (cable, WhatsApp, Drive…) y ábrelo; Android pedirá permitir *Instalar apps desconocidas*. Es una
  build de depuración: sirve para probar y para la demo, no para Play Store (eso requiere firma).

### Pruebas
- `npm run test:rules` — 15 pruebas de Security Rules contra el emulador.
- `npm run test:e2e` — recorrido completo en Chromium contra la app publicada: login, bitácora,
  invitación con QR, reporte + PDF, unirse con código y limpieza de lo creado.

### Fuera de alcance por ahora
Fotos y notas de voz (Storage requiere plan Blaze), notificaciones push, edición del perfil de la
persona, captura de medicamentos/signos desde la app, traspaso de turno, alertas inteligentes, SOS.
