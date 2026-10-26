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
npm run test:functions      # pruebas de la lógica de notificaciones (functions/logica.test.mjs)
npm run semilla             # usuarios y datos de prueba en los EMULADORES (ver §6)
npx ng test --watch=false --browsers=ChromeHeadless   # pruebas unitarias de la app (Karma)
npm run deploy:functions    # sube las Cloud Functions de notificaciones (requiere plan Blaze, §8)
# Si falla con "Cannot determine backend specification. Timeout after 10000" (la CLI tarda en
# descubrir las funciones en esta máquina), amplía el tiempo: FUNCTIONS_DISCOVERY_TIMEOUT=60 npm run deploy:functions
npm run semilla:real        # usuarios y datos de prueba en tu proyecto real
npm run semilla:historial:real  # cuenta demo con 60 días de historial (ver "Datos de demostración")
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
        ├── app.routes.ts        # /login, /home, /unirse/:codigo, /notificaciones, /personas/:id/(hoy|bitacora|plan/:seccion|equipo|reporte|ficha|semaforo)
        ├── core/
        │   ├── models/index.ts          # tipos del modelo de datos (sección 7 del doc) + invitaciones
        │   ├── guards/auth.guard.ts     # authGuard / noAuthGuard (recuerdan a dónde ibas con ?volver=)
        │   ├── utils/                   # fechas.ts, agenda-dia.ts (filas del día), entrega-turno.ts, semaforo.ts, persona-actual.ts
        │   └── services/
        │       ├── auth.service.ts      # registro, login, logout, usuarios/{uid}
        │       ├── personas.service.ts  # personas_cuidadas + miembros (batch)
        │       ├── miembros.service.ts  # miembros de una persona, mi rol, preferencias de avisos
        │       ├── bitacora.service.ts  # entradas_bitacora en tiempo real; línea de tiempo con tomas, tareas y signos
        │       ├── medicamentos.service.ts / tareas.service.ts  # plan, agenda del día, tomas y registros, inventario
        │       ├── signos.service.ts    # signos vitales (de una tarea o sueltos)
        │       ├── eventos.service.ts   # citas de una sola vez (eventos_calendario)
        │       ├── invitaciones.service.ts  # códigos/QR: crear, buscar, canjear, cancelar
        │       └── reporte.service.ts   # resumen semanal/mensual + PDF (jsPDF) + compartir
        └── pages/
            ├── login/           # correo + contraseña (login / registro)
            ├── home/            # lista "mis personas" + "Unirme con código o QR"
            ├── persona/         # pestañas de una persona: Hoy · Bitácora · Plan · Equipo · Reporte
            ├── hoy/             # agenda del día, semáforo, Entrega de turno, próximas citas, indicación del médico
            ├── plan/            # segmento Medicinas · Rutina · Citas (componentes en medicamentos/, rutina/, citas/)
            ├── bitacora/        # feed agrupado por día, filtro por tipo, modal de registro
            ├── ficha/           # ficha de emergencia a pantalla completa
            ├── semaforo/        # lo que sigue hoy en pantalla completa y un solo color (fuera de las pestañas)
            ├── equipo/          # ficha médica, miembros, turnos, invitaciones y modal con QR
            ├── notificaciones/  # centro de notificaciones (/notificaciones)
            ├── asistente/       # chat con IA; se abre como modal desde el botón flotante (shared/fab-asistente)
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
> Pendiente: Storage (§4.6) y desplegar las notificaciones (§8); ambos requieren plan Blaze.

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

### Datos de demostración con historial (15/09/2026)
`scripts/semilla-historial.mjs` (`npm run semilla:historial:real`) crea a **Elena Ramírez**
(`persona-elena`) con ficha médica completa y 60 días de historial: 5 medicamentos (uno según
necesidad y uno terminado) con sus tomas, 6 tareas de rutina con registros y notas, 1 a 3 entradas
de bitácora por día, glucosa y presión diarias, peso semanal, citas pasadas y próximas, y un equipo
con turnos. Es idempotente (ids deterministas) y sus documentos llevan `semilla: true` para que las
Cloud Functions no manden un aviso por cada uno. Cuentas (contraseña `Relevo.2026`; los correos son
alias de la cuenta de la app, así que cualquier aviso llega a su bandeja):

| Cuenta | Correo | Rol |
|---|---|---|
| Rosa Martínez (familiar) | `relevo740+rosa@gmail.com` | Responsable |
| Marta Ruiz (enfermera) | `relevo740+marta@gmail.com` | Enfermera, turno L-V 08:00–16:00 |
| Carlos Martínez (familiar) | `relevo740+carlos@gmail.com` | Familiar, turno L-V 16:00–22:00 y fines de semana |
| Dr. Javier Soto (médico) | `relevo740+doctor@gmail.com` | Médico (solo lectura) |

### Datos de prueba

Con los emuladores encendidos, `npm run semilla` crea usuarios de cada rol y una persona cuidada
con bitácora, medicamentos con inventario, rutina, signos vitales, dos citas próximas y una
indicación del médico (`scripts/semilla.mjs`, idempotente). Contraseña de todos: `relevo123`.
Para que `ionic serve` apunte a los emuladores aunque haya config real, pon
`FORZAR_EMULADORES = true` en `environment.development.ts` (y vuelve a `false` antes de hacer commit).

| Correo | Tipo de cuenta | Rol con Carmen |
|---|---|---|
| ana@relevo.test | Familiar | Responsable (creó a Carmen): edita el plan, resurte, invita |
| marta@relevo.test | Enfermero/a | Cuidadora de turno: registra tomas, tareas, signos y bitácora |
| sofia@relevo.test | Familiar | Familiar: escribe en la bitácora, registra tomas y agenda citas |
| luis@relevo.test | Médico | Médico: lee todo y escribe indicaciones médicas |

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

## 8. Notificaciones (push en el teléfono, correo en la web) — 15/09/2026

> **Estado:** desplegado el 15/09/2026 en `relevo-e5eaf` (ya en plan **Blaze**). Correo de avisos:
> `relevo740@gmail.com`; su contraseña de aplicación vive en Secret Manager (`CORREO_CONTRASENA`),
> nunca en el repositorio. Para desplegar desde otra máquina hay que recrear `functions/.env`
> (copiar `.env.example` y poner `CORREO_USUARIO=relevo740@gmail.com`), porque está ignorado por git.

### Qué avisa y a quién
| Evento | Quién recibe |
|---|---|
| Alguien escribe en la bitácora (cualquier tipo) | Los demás miembros de la persona |
| Una toma se marca **no tomada**, o se registra una toma **según necesidad** | Los demás miembros (las tomas programadas realizadas solo si `NOTIFICAR_TOMAS_REALIZADAS=true`) |
| Una tarea de la rutina se marca **no hecha** | Los demás miembros (con la nota, si la hay) |
| Una dosis pasó de su hora y nadie la registró (revisión cada 10 min, hasta 2 h después, una sola vez) | **Quien está de guardia** (turnos de cada miembro, ver *Equipo*); sin turnos definidos, todos los que registran; nadie de guardia, el responsable |
| **Se acerca una tarea de la rutina o una toma** (revisión cada 5 min; tareas: minutos que eligió el responsable, medicamentos: `AVISO_MEDICAMENTOS_MIN`, 15 por defecto). Una sola vez y solo si aún no se registró | **Quien está de guardia** (igual que arriba) |
| **El inventario de un medicamento se está acabando** (alcanza para 5 días o menos) **o se agotó** (20/09/2026). Una vez por nivel; resurtir o corregir el inventario a mano desde el formulario (23/10/2026) rearma el aviso | **Responsables** (siempre) y **familiares** (salvo con las alertas apagadas) |
| **Se acerca una cita del calendario** (13/10/2026; `avisarMin` de la cita, 1 h si no dice, 0 = sin aviso). Una sola vez por cita y hora de inicio: si la mueven, vuelve a avisar | **Quien acompaña** (siempre), el **responsable** y los **familiares** que reciben avisos del equipo, y **quien está de guardia** (`destinatariosCita`) |
| **El médico escribe una indicación médica** (13/10/2026; tipo `indicacion`) | Como cualquier entrada de bitácora, pero cuenta como **importante** (llega también a quien eligió "Importantes") |

Tocar la notificación abre la pantalla correspondiente (`data.url`). Con la app abierta se muestra
como aviso dentro de la app.

### Turnos y alertas (15/09/2026)
- En *Equipo*, el responsable pulsa el botón **Turnos** de cada miembro (o a sí mismo desde el menú
  ⋯ → **Turnos y alertas**): franjas de
  guardia con días de la semana y hora desde/hasta (si "hasta" ≤ "desde" cruza la medianoche, p. ej.
  22:00–06:00), y el interruptor **Recibe incidentes siempre**. Se guardan en `miembros/{uid}.turnos`
  y `.alertas`; las rules ya permitían al responsable actualizar miembros sin cambiar `uid` ni `rol`.
- **Recordatorios de rutina** (tomas pendientes y avisos previos de tomas y tareas) → solo a quien
  está de guardia en ese momento (`deGuardia` en `functions/logica.js`). Si nadie del equipo tiene
  turnos, se comportan como antes (todos los que registran); si hay turnos pero nadie está de guardia,
  van al responsable.
- **Alertas** (cualquier registro en la bitácora, tomas no realizadas y tomas según necesidad) → a
  todos menos quien lo originó, salvo quien tenga las alertas apagadas (`destinatariosAlertas`).
  Incidentes y síntomas llevan ⚠️ en el título. El médico recibe alertas pero nunca recordatorios.

### Cómo llega
- **Teléfono (Android/iOS)**: al iniciar sesión la app pide permiso, se registra en FCM y guarda el
  token en `usuarios/{uid}.fcmTokens` (`NotificacionesService`); al cerrar sesión lo quita. Los
  tokens que FCM rechaza se limpian solos.
- **Web**: a quien **no** tiene ningún token (usa Relevo desde el navegador) se le avisa **por correo**
  con un enlace a la app. Mientras `CORREO_USUARIO` esté vacío, el correo se omite y solo salen push.

### Dónde está
- `functions/index.js` — nueve Cloud Functions (`notificarEntradaBitacora`, `notificarToma`,
  `notificarRegistroTarea`, `recordarTomasPendientes`, `avisarProximas`, `avisarInventarioBajo`,
  `limpiarUsuarioEliminado`, `preguntarAsistente`, `resumirReporte`) y el envío por FCM / SMTP (nodemailer).
- `functions/logica.js` — lógica pura (mensajes, destinatarios, dosis vencidas, zona horaria) con
  pruebas en `functions/logica.test.mjs` (`npm run test:functions`; también corren antes de cada deploy).
- `src/app/core/services/notificaciones.service.ts` — registro del teléfono y manejo de la notificación.
- `functions/.env.example` — parámetros; `recordatorios/` en Firestore guarda qué dosis ya se recordaron
  y el último nivel de inventario avisado de cada medicamento (`inventario-{medicamentoId}`).

### Pasos para activarlo
1. **Plan Blaze** en Firebase Console (Cloud Functions y Cloud Scheduler lo requieren; el nivel
   gratuito cubre de sobra el uso de la app).
2. **Android**: hecho el 15/09/2026. La app `com.relevo.app` está registrada y
   `android/app/google-services.json` en el repo; el APK ya se generó con él (`npm run android:apk`).
   Si se pierde el archivo, la app funciona igual, solo no recibe push.
3. **Correo (cuando exista la cuenta)**: copia `functions/.env.example` a `functions/.env`, pon
   `CORREO_USUARIO=correo@dominio` y define la contraseña como secreto:
   ```bash
   firebase functions:secrets:set CORREO_CONTRASENA
   ```
   Con Gmail usa una *contraseña de aplicación* (requiere verificación en dos pasos). Con otro
   proveedor ajusta `CORREO_SMTP_HOST` / `CORREO_SMTP_PUERTO`.
4. **Desplegar**: `npm run deploy:functions` (antes corre las pruebas de `functions/`). Avisos del
   primer despliegue, ya resueltos en este proyecto:
   - *"User code failed to load… Timeout after 10000"*: la CLI da 10 s para analizar el código y en
     Windows a veces no alcanza. Dale más margen: `$env:FUNCTIONS_DISCOVERY_TIMEOUT=60` antes del
     comando (PowerShell).
   - *"Permission denied while using the Eventarc Service Agent"* o *"failed to modify the IAM
     policy"*: Google todavía está creando las cuentas de servicio. Espera 2 o 3 minutos y repite.
   - *"No cleanup policy detected"*: se resolvió una vez con `--force`, que deja programado el borrado
     de imágenes viejas de contenedor (evita el "pequeño cargo mensual" del aviso).
5. Para probar sin desplegar: `npm run emulators` también levanta el emulador de funciones
   (puerto 5001); los disparadores de Firestore reaccionan a lo que hagas en la app apuntando a
   emuladores, y la función programada se dispara a mano desde la UI del emulador.

Notas: los horarios "HH:mm" de los medicamentos se interpretan en `ZONA_HORARIA`
(`America/Mexico_City`); si un teléfono está en otra zona, el recordatorio podría no coincidir con
la toma registrada. La web **no** recibe push (aunque hay `vapidKey` en `firebase.config.ts`), por
decisión: en la web se avisa por correo.

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

### Permisos afinados y confirmación al quitar registros — 23/10/2026
- **Perfiles privados**: `usuarios/{uid}` solo lo lee su dueño (antes cualquier cuenta con sesión
  podía leer el correo, los tokens y los equipos de todos, y listarlos). Las rules siguen
  consultando el tipo de cuenta de otros con `get()`, que no pasa por los permisos de lectura, y la
  app deduce el tipo de un miembro por su rol (`ROLES_COMPATIBLES`); `MiembrosService.tipoDe` se
  retiró.
- **Invitaciones**: el canje debe sumar exactamente 1 a `usos` en el mismo batch (`canjeSumaUnUso`,
  con `getAfter`), y sumar usos sin crear el miembro en ese batch ya no se permite. Antes un cliente
  modificado podía entrar sin gastar usos o agotar el código de una familia ajena.
- **Quitar registros**: una toma, un registro de la rutina o una medición los quita solo quien los
  hizo o el responsable (`puedeQuitar` en las rules); corregirlos firmando como uno mismo sigue
  permitido. La app esconde «Quitar registro» cuando no se puede (y lo explica en la hoja de
  opciones), pide confirmación antes de quitar (en tomas avisa si la unidad vuelve al inventario)
  y confirma al terminar. Deshacer una tarea de signos vitales ajena, que borraría sus mediciones,
  también queda para su autor o el responsable (`MarcarTomaService`, `MarcarTareaService`,
  `confirmar` en `core/utils/notas.ts`).
- **Zoom en la web**: el viewport ya no bloquea el pellizco para acercar (`user-scalable=no`),
  importante para personas mayores, y `color-scheme` pasa a `light`, que es la paleta de la app.

### Cierre: lo que faltaba para usarla con una familia real — 22/10/2026
Tras recorrer la app completa con los cuatro roles y un usuario nuevo, se aplicaron estas
recomendaciones:

- **Recuperar y cambiar contraseña**: "¿Olvidaste tu contraseña?" en la pantalla de entrada
  (`sendPasswordResetEmail`) y "Cambiar contraseña" en Mi perfil (pide la actual y la nueva).
- **Aviso de privacidad** (`/privacidad`, `pages/privacidad`): texto en términos sencillos (quién
  trata los datos, qué se guarda, para qué, con quién se comparte, cuánto tiempo, derechos ARCO).
  Es obligatorio aceptarlo al registrarse (`usuarios.aceptoPrivacidadEn`) y se relee desde Mi perfil
  y desde la pantalla de entrada. **Es un borrador para que el equipo lo revise antes de la entrega.**
- **Eliminar persona y salir del equipo** (Equipo → "Zona de peligro"): el responsable elimina a la
  persona con todo su historial escribiendo su nombre (Cloud Function `eliminarPersona`: borra
  subcolecciones e invitaciones y la quita del perfil de cada miembro); cualquier otro miembro puede
  salir del equipo por su cuenta (`MiembrosService.salir`; rules: `soloQuitaMiUid`, y el responsable
  no puede borrar su propia membresía).
- **App Check retirado** (ver §8): nada en el servidor lo exigía y solo producía errores 403.
- **Semáforo**: lo pendiente de hace más de 2 h pasa de "atrasado" (rojo) a "sin registrar"
  (amarillo), para que el rojo signifique "todavía puedes darlo" y la pantalla no quede roja toda la
  noche por una dosis de la mañana (`SIN_REGISTRAR_MIN` en `core/utils/semaforo.ts`).
- **Código permanente del equipo**: 90 días y 20 usos (antes un año y 100); "Renovar" sigue igual.
  Las fechas de vencimiento llevan el año.
- **Reporte**: se quitaron la gráfica "Entradas por tipo" (repetía las chips) y las fichas de
  signos (repetían la lista clínica).
- **Semilla del emulador**: las tomas usan los ids de la app (Hoy y bitácora cuentan lo mismo) y
  hay tres tareas de rutina.

### Hoja para la consulta — 22/10/2026
El reporte completo era demasiada información para una consulta corta. Siguiendo lo que piden las
guías clínicas y los estudios con médicos (abajo), el PDF que se lleva al médico es ahora una
**hoja de una página** (`ReporteService.exportarHojaPdf`, `core/utils/hoja-consulta.ts`):

1. Encabezado: nombre, edad, condiciones, alergias, sangre y médico.
2. **Para comentar con el médico**: las **banderas** que detecta el sistema por reglas y las
   **preguntas de la familia** (`consulta/preguntas`, un texto compartido que escriben quienes
   escriben en la bitácora; el médico lo lee). Umbrales (`UMBRALES_HOJA`): caídas; pérdida de peso
   ≥ 5 % en el periodo (aviso desde 3 %); glucosa < 70 (hipoglucemia) o > 250; presión promedio de la
   última semana con lecturas ≥ 135/85 y lecturas ≥ 180/110; fiebre ≥ 38 °C; oxigenación < 92 %;
   pulso fuera de 50–100; adherencia < 80 % o la misma dosis omitida casi siempre.
3. **Medicamentos vigentes**: dosis y horario, tomas del periodo, dosis omitidas y su patrón
   ("3 de 4 a las 20:00"), si es nuevo en el periodo.
4. **Signos vitales del periodo** resumidos como los lee el médico: presión promedio de los últimos
   7 días con lecturas; glucosa con promedio por momento (ayunas, después de comer, antes de dormir)
   y conteo de bajas y altas; peso inicial, final y porcentaje; temperatura máxima; oxigenación
   mínima; pulso.
5. **Caídas, incidentes y síntomas** en una línea (el detalle va al anexo).
6. **Indicaciones médicas previas** (hasta 3 de los últimos 90 días), para comentar si se cumplieron.
7. Anexos opcionales, cada uno con su casilla: síntomas e incidentes, resumen con IA, bitácora
   completa. El **Reporte completo** anterior sigue disponible como segundo botón.

Para que la hoja sea buena se capturan dos datos nuevos: el **momento de la glucosa**
(`SignoVital.momento`, chips en el formulario de signos; se propone "en ayunas" antes de las 10 y
"antes de dormir" desde las 21) y si un incidente fue una **caída** y si hubo **lesión**
(`EntradaBitacora.caida`, `lesion`; la bitácora, la Entrega y la hoja las etiquetan así). Para la
tendencia de peso basta con una tarea semanal de signos "peso" en la rutina. Rules: `momento`,
`caida` y `lesion` validados; `consulta/preguntas` con tope de 1000 caracteres y firma de quien
guarda (29 pruebas). Pantalla de Reporte: tarjeta "Hoja para el médico" con banderas, preguntas y
anexos; la lista de signos usa el mismo resumen clínico.

Fuentes de los umbrales: [AAFP, pérdida de peso involuntaria (2021)](https://aafp.org/afp/2021/0700/p34.html);
[CDC STEADI](https://www.cdc.gov/steadi/media/pdfs/steadi-pocketguide-508.pdf) y [AAFP, caídas (2024)](https://www.aafp.org/afp/2024/0500/falls-older-adults);
[ADA Standards of Care, adultos mayores](https://pmc.ncbi.nlm.nih.gov/articles/PMC12690186);
[RACGP, presión en casa](https://www.racgp.org.au/afp/2016/januaryfebruary/how-to-measure-home-blood-pressure-recommendations-for-healthcare-professionals-and-patients/) y [guía ESH 2023 (resumen ACC)](https://www.acc.org/latest-in-cardiology/articles/2024/02/05/11/43/2023-esh-hypertension-guideline-update);
[IMSS, valoración geriátrica integral](https://revistamedica.imss.gob.mx/index.php/revista_medica/article/view/1749);
[PQA, umbral de adherencia del 80 %](https://www.pqaalliance.org/assets/docs/PQA_PDC-CMP-PH_Rationale.pdf);
[IHI, SBAR](https://forms.ihi.org/tools/sbar-toolkit).

### Rediseño para uso diario — 13/10/2026
Cinco fases en la rama `mejoras-uso-diario` (commits "Fase 1" a "Fase 5"). Las pestañas de una
persona quedan en **Hoy · Bitácora · Plan · Equipo · Reporte**; el asistente sigue en el botón
flotante de cada pantalla.

- **Hoy** (`pages/hoy`, `core/utils/agenda-dia.ts`): la agenda del día (tomas y tareas en orden, con
  ✔ / ✘ y hoja de opciones para nota o deshacer), el semáforo arriba, "Según necesidad", "Por
  resurtir", "Próximas citas" y flechas para ver días anteriores (hasta 90). Botón **Registrar signos
  vitales** sin tarea de por medio.
- **Entrega de turno** (`core/utils/entrega-turno.ts`; tarjeta "Desde tu último turno" en Hoy): desde
  que terminó el turno anterior de quien mira (o las últimas 8 h, o su última visita en ese
  dispositivo), lista dosis no tomadas o sin registrar, tareas no hechas, incidentes y síntomas,
  signos fuera de rango (`RANGOS_SIGNO`, orientativos) y la última nota de otra persona; las
  indicaciones del médico van primero. Sin IA. "Ver en la bitácora" abre la bitácora filtrada por lo
  más delicado. La ventana se fija al entrar a Hoy: lo registrado durante la visita sale en la
  siguiente entrega.
- **Plan** (`pages/plan`): un segmento con **Medicinas**, **Rutina** y **Citas**; el + da de alta en la
  sección abierta. Las rutas viejas `/medicamentos` y `/rutina` redirigen. Medicinas muestra
  "Quedan N: alcanza para N días" (unidades si no hay horario fijo).
- **Ficha de emergencia** (`/personas/:id/ficha`, `pages/ficha`): pantalla completa con letra grande
  (edad, tipo de sangre, alergias destacadas, condiciones, medicamentos activos, médico, seguro,
  hospital y contactos que marcan con un toque). Se abre desde el inicio (icono por persona), la
  barra de Hoy y Equipo.
- **Signos vitales en cualquier momento**: `SignosService.guardarSueltas` (con `autorNombre` y `nota`
  ≤ 200, validada en rules). En la bitácora cada registro de signos es una línea y hay filtro
  "Signos vitales"; el botón del pulso de la barra los registra. Entran al reporte y al PDF.
- **Citas de una sola vez** (`EventoCalendario` en `eventos_calendario`,
  `core/services/eventos.service.ts`, `pages/citas`): título, tipo (cita médica / terapia o estudio),
  fecha y hora, duración, lugar, quién acompaña y aviso previo (`avisarMin`: sin aviso, 30 min, 1 h,
  2 h o 1 día). Las agendan, editan y borran el responsable y los familiares (`PUEDE_EDITAR_CITAS`);
  enfermeros y médicos las ven. `avisarProximas` avisa de las que se acercan (`citasProximas`,
  `mensajeCita`, `destinatariosCita` en `functions/logica.js`), una vez por cita y hora de inicio. El
  tipo de tarea "cita" ya no se ofrece en tareas nuevas (`TIPOS_TAREA_TODOS` conserva las existentes).
- **Indicación médica** (entrada de bitácora `tipo: 'indicacion'`): solo el médico la escribe y edita
  (`PUEDE_ESCRIBIR_INDICACION`; `tipoPermitido` en rules; el responsable puede borrarla pero no
  editarla). Se destaca en la bitácora, en Hoy (tarjeta con la última de los últimos 14 días) y en
  la Entrega, y cuenta como importante en las notificaciones.
- **Notificaciones**: una opción principal (Todos / Importantes / Ninguno) y un apartado "Avanzado"
  plegado (recordatorios de guardia, solo en turno). Un miembro nuevo entra con `AVISOS_POR_DEFECTO`
  (responsable y familiar: importantes; enfermero: todos; médico: importantes); a los miembros
  existentes no se les cambia nada (sin valor sigue siendo "todos"). La lógica de envío no cambió.
- **Limpieza**: sin pestaña Asistente (`/asistente` redirige a Hoy); `fotos` y `notaVozUrl` quedan
  obsoletos y ya no se escriben; el reporte no repite la "Bitácora del periodo" (sigue en el PDF); se
  retiró "Hacerme responsable" (interfaz y rule); los registros de bitácora se fechan hasta 12 h
  atrás, aunque caiga en el día anterior; la ayuda de Equipo es de una línea.
- **Rules** (`firestore.rules`): `eventoValido` y solo responsable y familiares escriben
  `eventos_calendario`; `tipoPermitido` para indicaciones; `signoValido` admite `nota`; `tomaValida`
  exige `horaProgramada` y medicamento activo (`getAfter`); los miembros nuevos pueden traer `avisos`
  (`preferenciasValidas` también al crear); se quitó la recuperación del rol de responsable. 28
  pruebas en `tests/firestore.rules.test.mjs`.
- **Cómo probarlo**: `npm run emulators` + `npm run semilla` (con `FORZAR_EMULADORES = true`) y
  entrar como ana (responsable), sofia (familiar), marta (enfermera) y luis (médico). Verificación
  completa: `npx tsc -p tsconfig.app.json --noEmit`, `npm run build`,
  `npx ng test --watch=false --browsers=ChromeHeadless` (37), `npm run test:functions` (52) y
  `npm run test:rules` (28).
- **Para publicarlo**, en este orden: `npm run deploy:rules` → `npm run deploy:functions` →
  `firebase deploy --only hosting`; después, `npm run test:e2e` contra la app publicada.

### Paleta clara "clínica amable" — 06/10/2026
- Se deja el tema oscuro azul marino por un tema claro pensado para salud: verde azulado (teal
  `#0f9d8a`) como color principal, fondo menta muy claro, tarjetas blancas con borde y sombra suaves,
  tinta verde-grisácea (`#163238`) y acentos cálidos solo para avisos (ámbar) y peligro (coral). El
  asistente de IA conserva su acento lavanda. Todo vive en `src/theme/variables.css` (colores de
  Ionic + tokens `--relevo-*`); `src/styles.scss` y las páginas solo usan tokens, salvo el semáforo
  (sus colores significan algo) y la paleta de series de las gráficas del reporte.
- Las barras siguen con `color="primary"` en las plantillas, pero `styles.scss` fuerza su contraste a
  la tinta oscura (Ionic lo fija con `!important` en `.ion-color-primary`).
- Logo e iconos regenerados con la nueva paleta: `public/favicon.svg` (degradado teal), favicon.ico,
  los iconos de la PWA (`public/icons/`), los de Android (`mipmap-*`, fondo adaptativo `#0F9D8A`) y
  los colores del manifest y de `theme-color`.

### Rediseño redondeado e inicio reorganizado — 06/10/2026
- Un solo juego de radios en `src/theme/variables.css` (`--relevo-radio`, `--relevo-radio-medio`,
  `--relevo-radio-pildora`) aplicado desde `src/styles.scss`: tarjetas y listas de 24 px, campos de
  16 px, botones, chips, insignias y selectores en píldora; modales y hojas de acciones con esquinas
  redondeadas. Sin tocar las plantillas de cada página.
- **Inicio** (`pages/home`): el perfil vive en la esquina (avatar con iniciales → *Mi perfil*,
  *Notificaciones*, *Cerrar sesión*), campana a Notificaciones, saludo con el tipo de cuenta, una
  tarjeta por persona (iniciales con color propio, edad, tamaño del equipo, descripción y acceso
  directo al semáforo) y *Unirme con código o QR* como tarjeta punteada al final. Las cuentas de
  familiar dan de alta con el botón flotante extendido **Nueva persona**.
- **Semáforo**: carcasa en cápsula con luces degradadas y latido, estado en píldora, botones en
  píldora, lista de "después" y barra de avance del día en una tarjeta redondeada.

### Centro de notificaciones — 06/10/2026
- `/notificaciones` (campana del inicio, menú del perfil o *Equipo → Mis notificaciones*). Por cada
  persona cuidada, cada quien elige en su documento de miembro:
  - `avisos`: **todos** (bitácora, tomas no tomadas o según necesidad, tareas no hechas, inventario),
    **importantes** (solo incidentes, síntomas, tomas no tomadas y medicamentos agotados) o **ninguno**;
  - `recordatorios`: si recibe los recordatorios de su guardia (tomas y tareas próximas o pendientes);
  - `soloEnTurno`: los avisos del equipo solo durante sus turnos (requiere turnos definidos).
- Arriba muestra por dónde llegan los avisos: push en el teléfono (con el estado del permiso y botón
  para pedirlo) o correo en la web.
- Las Cloud Functions los aplican (`functions/logica.js`: `modoAvisos`, `quiereAviso`,
  `destinatariosAlertas`, `destinatariosInventario`, `deGuardia`); `alertas: false` de la versión
  anterior sigue contando como "ninguno". Las rules (`preferenciasValidas`) dejan que cada quien
  cambie solo `nombre`, `avisos`, `recordatorios` y `soloEnTurno`; los turnos siguen siendo del
  responsable (el modal de turnos ya no trae el interruptor de alertas y rechaza turnos traslapados).
- Verificado: 48 pruebas unitarias de funciones, 24 de reglas y 13 de la app; las 9 funciones
  siguen desplegadas (`firebase functions:list`). Las nuevas preferencias se aplican en producción
  al redesplegar funciones y reglas: `npm run deploy:functions` y `npm run deploy:rules`.

### Medicamentos terminados y formularios — 06/10/2026
- Un medicamento **suspendido** o un tratamiento **terminado** (o que aún no empieza) ya no admite
  tomas: lo frena el servicio (`comprobarTomaPermitida`, con mensaje claro en pantalla) y, para los
  suspendidos, también las rules (`medicamentoActivo`); las tomas llevan `horaProgramada`
  obligatoria. El formulario no deja crear un tratamiento que ya habría terminado, y la agenda de
  tomas solo retrocede 90 días.
- Correcciones de la auditoría de formularios: Suspender/Reactivar avisan si fallan (medicamentos y
  rutina); doble toque protegido al marcar tomas y tareas; una tarea de signos vitales exige al menos
  una medición y guarda las mediciones con la fecha de la tarea (antes, siempre con la de hoy);
  notas de tareas recortadas a 200; login valida nombre, correo y contraseña antes de enviar; el
  registro deshace la cuenta de Auth si falla el perfil, y el inicio repara cuentas sin perfil;
  límites de longitud en persona, perfil, bitácora (2000) y tareas (nombre 60, notas 300, 12
  horarios); teléfonos de la ficha médica validados; fecha de nacimiento mínima 1900.
- Rules más estrictas: inventario máximo 9999 (igual que la app), `entradaValida`, `tareaValida`,
  `registroValido`; el autor de una entrada no puede cambiar de autor al editarla.

### Tipos de cuenta (al registrarse)
- **Familiar**: es el único que puede **dar de alta** a una persona cuidada; queda como
  **Responsable** de su bitácora (administra, invita, define medicamentos, hace responsable a otro
  familiar). Un familiar invitado escribe en la bitácora, registra tomas y coordina citas.
- **Enfermero/a**: se une con un código y entra como cuidador: registra bitácora, tomas y signos.
- **Médico**: se une con un código; lee todo (bitácora, plan, reportes) y solo escribe
  **indicaciones médicas** en la bitácora (13/10/2026).
- El tipo se guarda en `usuarios/{uid}.tipo`, no se puede cambiar después, y las reglas lo usan para
  decidir quién crea personas y con qué rol entra cada quien (`ROL_POR_TIPO`, `ROLES_COMPATIBLES`).
  Cuentas anteriores a esta versión lo eligen una sola vez al entrar.

### Logo — 15/09/2026
- Corazón blanco con línea de pulso sobre el azul de la app (`#3880ff`). El SVG fuente es
  `public/favicon.svg`; de él salen `public/favicon.ico` (16/32/48 px), los iconos de la PWA en
  `public/icons/` y los de Android (`mipmap-*/ic_launcher*.png`, con el frontal adaptativo sobre fondo
  `#3880FF` en `values/ic_launcher_background.xml`). Para regenerarlos tras cambiar el SVG, el script
  que los produjo usa Playwright para rasterizar cada tamaño; basta repetir el proceso con el mismo
  dibujo (o usar `npx @capacitor/assets generate` a partir de un PNG de 1024 px).

### Mi perfil y eliminar cuenta — 15/09/2026
- En *Mis personas*, tocar la tarjeta del usuario abre **Mi perfil**: cambia el nombre (se actualiza
  en Auth, en `usuarios/{uid}` y en `miembros/{uid}` de cada equipo; las rules permiten a cada quien
  cambiar solo su propio nombre). Correo y tipo de cuenta no se cambian.
- **Eliminar cuenta**: pide la contraseña (Firebase exige sesión reciente), borra el usuario de Auth y
  la Cloud Function `limpiarUsuarioEliminado` (disparador Auth de 1.ª gen) borra su perfil, lo quita
  de `miembros` y `miembrosUids` de cada equipo y, si era la única persona en una bitácora, borra a esa
  persona cuidada con todo su historial (`recursiveDelete`).

### Ficha médica — 15/09/2026
- En *Equipo*, la tarjeta de la persona muestra la **ficha médica**: tipo de sangre, condiciones y
  diagnósticos, alergias, médico tratante y su teléfono, seguro, hospital o clínica, notas médicas
  (marcapasos, dieta, movilidad…) y contactos de emergencia con enlace para llamar. La ve todo el
  equipo; el responsable la edita con **Editar ficha médica** (`FichaModal` → `PersonasService.actualizar`).
- Campos nuevos en `personas_cuidadas`: `telefonoMedico`, `seguro`, `hospital`, `notasMedicas`
  (`TIPOS_SANGRE` para el selector). Las reglas ya permitían al responsable actualizar la persona.
- La ficha entra en el reporte (pantalla y tabla "Datos de la persona" del PDF) y en el contexto del
  asistente, para que pueda responder "¿a quién llamo en una emergencia?" o "¿qué alergias tiene?".
- Los campos viven en un componente compartido, `pages/equipo/ficha-campos.component.ts`
  (`<app-ficha-campos>` + `datos()`), que usan el alta (`persona.modal.ts`) y `FichaModal`. Lo escrito
  en "Nueva condición" / "Nueva alergia" sin tocar **Agregar** también se guarda. Corregido el
  21/09/2026: un contacto sin "relación" mandaba `relacion: undefined` dentro de la lista y Firestore
  rechazaba toda la ficha ("No se pudo guardar la ficha médica").

### Personas cuidadas: alta y datos — 15/09/2026
- **+** en *Mis personas* (solo cuentas de familiar) abre un formulario completo: nombre, fecha de
  nacimiento (opcional, con la edad calculada al escribirla) y una descripción libre de hasta 500
  caracteres (quién es, qué padece, qué le gusta). La descripción la ve todo el equipo: aparece en
  la lista de inicio, en la tarjeta de *Equipo*, en el reporte (pantalla y PDF) y en el contexto
  que recibe el asistente.
- El responsable corrige esos datos desde *Equipo → Editar datos* (`PersonasService.actualizar`;
  las rules ya permitían al responsable actualizar la persona).
- **La ficha médica es parte del alta (21/09/2026):** debajo de los datos básicos, el mismo
  formulario captura tipo de sangre, condiciones, alergias, médico tratante, seguro, hospital, notas
  médicas y contactos de emergencia. Todo es opcional y se guarda junto con la persona, en el mismo
  batch (`crearPersona` descarta los campos sin llenar). Al **editar** datos básicos la ficha no
  aparece: se sigue editando aparte, con *Editar ficha médica*.

### Bitácora (`/personas/:id/bitacora`)
- Feed en **tiempo real** agrupado por día (Hoy / Ayer / fecha), con 5 tipos: síntoma, ánimo,
  sueño, incidente y nota ("comida" dejó de capturarse el 15/09/2026: las comidas son tareas de la
  rutina; los registros antiguos de comida se siguen mostrando y contando). Filtro por tipo desde el
  embudo de la barra.
- Las **tomas de medicamentos** (tomadas y no tomadas) aparecen en la misma línea de tiempo con
  quién las registró; el filtro tiene la opción "Tomas de medicamentos". Se leen de la agenda de
  medicamentos, no se editan desde aquí (`BitacoraService.lineaDeTiempo`).
- **Orden** (15/09/2026): todo se ordena por el momento en que se registró (`creadoEn` en las
  entradas, `registradoEn` en las tomas), de lo más reciente a lo más antiguo. La hora que se
  muestra junto al tipo es la del registro; si el hecho se fechó antes, la entrada añade "ocurrió a
  las HH:mm", y las tomas indican "dosis de las HH:mm". Registros anteriores a esta versión no tienen
  esos campos y se ordenan por su fecha u hora real.
- Botón **+** abre el formulario (tipo, descripción y hora). La fecha es siempre la de **hoy** y la
  hora solo puede ir **hasta una hora atrás** de la actual (sin pasar de las 00:00), para que la
  bitácora se escriba en el momento. Al editar se conservan la fecha y hora originales. Tocar un
  registro propio abre Editar / Eliminar.
- Permisos (en las rules y en la interfaz): responsable, enfermero/a **y familiar crean**; cada
  autor edita lo suyo y el responsable todo; el **médico solo lee**.

### Medicamentos (`/personas/:id/medicamentos`) — 13/09/2026
- Pestaña **Medicinas**: el responsable da de alta medicamentos (nombre, dosis, horarios "HH:mm",
  inventario opcional, notas), los edita, suspende/reactiva o elimina (con su historial de tomas).
- **Tomas del día**: por cada medicamento activo y cada horario aparece la dosis del día elegido
  (flechas para ver días anteriores) con estado Pendiente / Tomada / No tomada. Responsable,
  enfermero/a y familiar la marcan con un toque; al marcar se pide confirmación con una **nota
  opcional** (15/09/2026: "vomitó", "la tomó con leche"), y desde la toma se puede agregar o editar
  la nota después (quien la registró o el responsable; rules `hasOnly(['nota'])`). Marcar "tomada"
  resta 1 al inventario (y deshacerla lo devuelve). El id de cada toma es `yyyyMMdd-HHmm`, así que
  corregir una toma no crea duplicados.
- Reglas: solo el responsable crea/edita/elimina medicamentos; enfermero/a y familiar solo pueden
  tocar el campo `inventario` (al registrar tomas) y sus propias tomas; el médico solo lee.
- **Duración del tratamiento** (15/09/2026): cada medicamento tiene *Empieza el* (por defecto hoy) y
  *Duración*: "hasta que el médico lo indique" o "cierto número de días" (campos `inicio` y
  `duracionDias`). Solo aparece en *Tomas del día* y en la sección según necesidad los días en que
  está vigente; al pasar el último día se muestra como **Terminado** en la lista, sin recordatorios
  ni avisos previos. Los medicamentos anteriores a esta versión no tienen `inicio` y se tratan como
  vigentes siempre.
- **Según necesidad** (15/09/2026): al dar de alta un medicamento, el interruptor *Sin horario fijo*
  lo deja sin horarios (p. ej. "solo si siente dolor"). Aparece en una sección propia con su última
  toma ("hace 3 h · Ana") y el botón **Tomó ahora**, que pide confirmación, admite una **nota**
  opcional (motivo, cómo se sentía; campo `nota`) y registra la toma en ese instante (id
  `yyyyMMdd-HHmmss`, campo `aDemanda: true`, descuenta inventario). La nota se ve en la agenda, en
  la bitácora, en el aviso al equipo y en el contexto del asistente. Esas tomas salen en
  *Tomas del día* a la hora en que se dieron (solo se pueden quitar), en la bitácora y en el reporte
  como "N tomas en el periodo" sin porcentaje de adherencia. No generan recordatorios ni avisos
  previos, pero sí avisan al equipo cuando se registran (`notificarToma`).
- **Inventario nunca negativo y validaciones** (20/09/2026): antes, registrar una toma con el
  inventario en 0 lo dejaba en **-1** (`increment(-1)` sin tope). Ahora la toma se registra igual
  (la persona sí se la tomó) pero no descuenta: queda marcada con `sinDescuento: true` para que
  deshacerla no devuelva una unidad que nunca se restó, y la app avisa que hay que actualizar el
  inventario. Un negativo guardado por versiones anteriores se muestra como 0 y se repara a 0 en
  la siguiente toma. El formulario valida con mensajes visibles: nombre (2–60 caracteres, con
  letras, sin repetir un medicamento vigente con el mismo nombre, dosis y modalidad), dosis (≤ 40),
  horarios (válidos, sin repetir, ≥ 30 min entre sí, máximo 12), inicio (del año 2000 a un año desde
  hoy), duración (entero de 1 a 365), inventario (entero de 0 a 9999) y notas (≤ 300); además indica
  para cuántos días alcanza el inventario. Al confirmar una toma se avisa si la dosis está
  adelantada más de 1 h, si hay otra toma según necesidad de hace menos de 1 h o si el inventario
  está en 0. Las rules repiten los límites (`medicamentoValido`, `inventarioValido`), obligan a que
  enfermero/a y familiar muevan el inventario de uno en uno (`ajusteDeToma`) y validan las tomas
  (`tomaValida`); suspender/reactivar y el ajuste de inventario no revalidan el resto del
  documento, para no bloquear medicamentos anteriores a estos límites.
- **Inventario bajo y «Resurtir»** (20/09/2026): un medicamento está **por acabarse** cuando lo que
  queda alcanza para 5 días o menos (mínimo 5 unidades; los de según necesidad, 5 unidades) y
  **agotado** en 0; si lo que hay alcanza para los días que le faltan a un tratamiento con fin, no
  se avisa (el día de hoy no se cuenta: parte de sus dosis ya se descontó, y contarlo completo daba
  avisos falsos con un surtido exacto, p. ej. 21 pastillas para 7 días). La regla es
  `estadoInventario`, idéntica en `medicamentos.service.ts` y en `functions/logica.js` (si cambias
  una, cambia la otra). En la app: sección **Por resurtir** arriba de *Tomas del día* («Quedan 5:
  alcanza para 5 días»), el badge de la lista por nivel (rojo agotado, amarillo por acabarse) y un
  contador en la pestaña **Medicinas**, visibles para todo el equipo. El responsable tiene el botón
  **Resurtir** (también en el menú del medicamento): propone las unidades del último resurtido
  (`ultimoResurtido`, 30 la primera vez) y las suma al inventario. Por push/correo avisa la Cloud
  Function `avisarInventarioBajo` (§8): una vez al pasar a "queda poco" y otra al agotarse; deshacer
  y volver a marcar tomas no repite el aviso, y resurtir lo rearma. Corregir el inventario a mano
  desde el formulario también lo rearma (23/10/2026): al guardar, la app marca `editadoEn` en el
  medicamento y con eso la función distingue esa corrección (aunque suba una sola unidad) de
  deshacer una toma, que también suma 1. Si el medicamento ya estaba en
  0, el aviso de "se acabó" sale desde `notificarToma` (esas tomas llevan `sinDescuento` y no
  cambian el medicamento). Si el envío falla, la anotación se deshace para reintentar en la
  siguiente baja. Editar un medicamento sin tocar el campo Inventario ya no lo reescribe (antes
  pisaba las tomas registradas con el formulario abierto), y si las rules rechazan el descuento de
  una toma (dos teléfonos con la última unidad), la toma se guarda sola, sin descontar.
- El reporte y el asistente ya leen estos datos (adherencia, tomas omitidas).

### Rutina (`/personas/:id/rutina`) — 15/09/2026
- Pestaña **Rutina**: el responsable da de alta tareas con horario: comidas, baño,
  ejercicio, terapia, cita u otra (nombre, **días de la semana** en que aplica, horarios "HH:mm",
  **duración** de cada horario para tareas con rango, p. ej. ejercicio de 10:00 a 11:00
  (`duracionMin`; se muestra "10:00–11:00" y el aviso previo dice "de 10:00 a 11:00"), notas y con
  cuántos minutos de anticipación avisar: 5, 10, 15, 30 o 60). Las edita,
  suspende/reactiva o elimina (con su historial). Los días se guardan en `dias` como
  `Date.getDay()` (0 = domingo); sin días = todos. Una tarea de "L, X, V y D" solo aparece en la
  agenda y avisa esos días.
- **Tareas del día**: por cada tarea activa y cada horario aparece la tarea del día elegido (flechas
  para ver días anteriores) con estado Pendiente / Hecha / No hecha. Responsable, enfermero/a y
  familiar la marcan con un toque; al marcar se pide confirmación con una **nota opcional** ("comió
  poco", "no quiso bañarse"), y desde el registro se puede agregar o editar la nota después. El id
  del registro es `yyyyMMdd-HHmm`, como en las tomas.
- **Aviso previo**: la Cloud Function `avisarProximas` revisa cada 5 minutos y manda push (o correo,
  §8) a quienes cuidan cuando se acerca la hora de una tarea o de un medicamento, una sola vez por
  horario y solo si todavía no se registró.
- Datos en `personas_cuidadas/{id}/tareas/{id}` y `…/tareas/{id}/registros/{id}`. Rules: solo el
  responsable define tareas; responsable, enfermero/a y familiar registran (firmado por ellos); el
  médico solo lee. Probado en `tests/firestore.rules.test.mjs`.
- Los registros de tareas (hechas y no hechas, con su nota) aparecen en la **bitácora**, con el
  filtro "Tareas de la rutina". Pendiente: incluirlos en el reporte PDF.

### Tarea "Signos vitales" y captura de mediciones — 21/09/2026
- Nuevo tipo de tarea en la rutina: **Signos vitales** (propone el nombre "Revisar signos vitales").
  El responsable elige **qué se mide** en esa tarea: presión arterial, glucosa, temperatura,
  oxigenación, pulso y peso (`Tarea.signos`; por defecto presión y glucosa). Así "Glucosa en ayunas
  07:30" solo pide la glucosa. Avisa y aparece en el semáforo como cualquier otra tarea.
- Al marcarla como **hecha** (desde Rutina o desde el Semáforo) se abre la captura
  (`pages/rutina/signos.modal.ts`): solo los signos de esa tarea, todos opcionales, con límites que
  atajan errores de dedo (p. ej. glucosa 20–600, la presión pide sus dos números y la baja menor que
  la alta) y nota opcional. Es la **primera pantalla de la app que captura signos vitales**: antes
  el reporte y el asistente solo tenían los de la semilla.
- Se guarda en dos lugares (`pages/rutina/marcar-tarea.service.ts`, compartido por Rutina y Semáforo):
  - el registro de la tarea, con las mediciones resumidas en la nota («Presión 130/85 mmHg · Glucosa
    110 mg/dL — En ayunas»), así que se ven en la rutina y en la bitácora sin cambios;
  - una medición por signo en `personas_cuidadas/{id}/signos_vitales`, que ya leen el **reporte**
    (mín., máx., promedio, última) y el **asistente**. Su id es `{tareaId}-{idRegistro}-{tipo}`:
    corregir el registro reemplaza las mediciones, y marcarla "no hecha" o quitar el registro las borra.
- Rules (`signos_vitales`): crean y corrigen (firmado) responsable, enfermero/a y **familiar** —los
  mismos que marcan tareas—, con tipo conocido y valores numéricos válidos; el médico solo lee.
  Probado en `tests/firestore.rules.test.mjs` (22 pruebas). Etiqueta en los avisos: `functions/logica.js`.

### Semáforo (`/personas/:id/semaforo`) — 21/09/2026
- Pantalla completa para dejar el teléfono apoyado y entender de lejos qué sigue, sin abrir cada
  pestaña. Se entra con el icono de semáforo del encabezado de **Bitácora**, **Medicinas** y **Rutina**.
- Junta las tomas con horario y las tareas de la rutina de **hoy** que aún no tienen registro:
  - **Verde — "Todo al día"**: nada urgente; muestra lo que sigue y cuánto falta.
  - **Amarillo — "Ya casi" / "Es hora"**: algo entra en su aviso (los minutos de la tarea; 15 en los
    medicamentos) o ya es su hora. Una tarea con rango ("de 10:00 a 11:00") sigue en amarillo mientras dura.
  - **Rojo — "Atrasado"**: pasaron 15 min de la hora (o del fin del rango) sin registro. Manda el más
    antiguo y no baja hasta que se marca hecho o no hecho.
- Por defecto es **solo un vistazo**: el semáforo grande, el estado, qué toca y a qué hora. La idea es
  mirarlo de lejos y tomar el teléfono solo para marcar.
- **Al tocar la pantalla** aparecen los botones grandes **Tomada / No tomada** o **Hecha / No hecha**
  (misma confirmación con nota opcional y mismos permisos que en las pestañas; el médico solo mira),
  los siguientes 4 pendientes y el avance del día («Hoy: 5 de 9 registradas»). Se esconden solos a
  los 30 s, o con otro toque; si quedan más atrasados se pueden marcar seguidos.
- El color nunca va solo: siempre hay texto y la luz encendida cambia de posición (daltonismo).
- Mantiene la **pantalla encendida** mientras está abierto (`@capacitor-community/keep-awake`: en
  Android nativo; en la web usa Screen Wake Lock si el navegador lo permite). Se recalcula cada 15 s
  y a medianoche pasa a la agenda del día siguiente.
- La regla de colores es una función pura en `core/utils/semaforo.ts`, con 12 pruebas en
  `semaforo.spec.ts` (`npx ng test --watch=false --browsers=ChromeHeadless`).

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

### Resumen del reporte con IA — 15/09/2026
- En *Reporte*, la tarjeta **Resumen del periodo** tiene el botón *Generar resumen con IA*. La app
  arma el contexto del periodo elegido (semana o mes: bitácora, tomas, rutina, signos, citas) con
  `AsistenteService.resumirPeriodo` y la Cloud Function **`resumirReporte`** pide a Gemini un texto
  plano con secciones fijas (`INSTRUCCIONES_RESUMEN`): resumen general, medicamentos, síntomas e
  incidentes, rutina y alimentación, signos vitales y qué comentar con el médico. Máximo 400 palabras,
  solo con los datos, sin diagnósticos.
- El texto se muestra en pantalla y, si existe, el PDF lo incluye como sección "Resumen con IA"
  (títulos en negrita, con la nota "generado con IA… no sustituye el criterio médico"). Cambiar de
  periodo lo descarta; se genera a petición porque cada resumen consume crédito de la Gemini API.
- El contexto del asistente (chat y resumen) ahora también incluye la **rutina** (tareas y sus
  registros con notas), no solo bitácora, medicamentos, signos y citas.

### Asistente con IA (`/personas/:id/asistente`) — 11/09/2026, en el servidor desde el 15/09/2026
- Chat en lenguaje natural sobre la persona cuidada: "¿Cómo ha estado mi mamá esta semana?",
  "¿Cuántas veces se le olvidó la pastilla de la presión?", "¿Cuándo es la próxima cita?".
- `AsistenteService` arma un contexto compacto con los datos reales de Firestore de los últimos
  30 días (perfil, equipo, bitácora, medicamentos con cada toma, signos vitales, citas), leídos con
  los permisos del usuario, y lo manda a la Cloud Function invocable **`preguntarAsistente`**
  (`functions/index.js`). La función exige sesión iniciada y ser miembro de la persona, y llama a
  **Gemini** (`@google/genai`, modelo en el parámetro `MODELO_IA`, hoy `gemini-3.6-flash`) con la
  clave del servidor (secreto `GEMINI_API_KEY`) y las reglas de `INSTRUCCIONES_ASISTENTE`
  (`functions/logica.js`): responder solo con esos datos, citar fechas y autores, no inventar, no
  diagnosticar. Conversación con historial (últimas 8 vueltas); nada se guarda en Firestore.
- **Por qué en el servidor**: antes se llamaba a Firebase AI Logic desde la app, que exige App Check
  (reCAPTCHA Enterprise en web, Play Integrity en Android). reCAPTCHA empezó a rechazar la
  verificación ("App attestation failed") y Play Integrity nunca pasa en un APK de depuración, así que
  el asistente no funcionaba. La función no depende de App Check; la clave nunca viaja al cliente.
- **Dos formas de llamar a Gemini** (`IA_BACKEND` en `functions/.env`):
  - `vertex` (por defecto): Vertex AI con la identidad de la función; se factura al proyecto de
    Google Cloud (plan Blaze, cubierto por los créditos de prueba). Requiere habilitar la API
    https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=relevo-e5eaf y,
    si el asistente responde "no tiene permiso", dar el rol *Usuario de Vertex AI* a
    `765182515374-compute@developer.gserviceaccount.com` en IAM.
  - `gemini` (**la que usa el proyecto desde el 15/09/2026**): Gemini Developer API con una clave de
    AI Studio en el secreto `GEMINI_API_KEY` (`firebase functions:secrets:set GEMINI_API_KEY` y
    redesplegar). Esa vía se cobra en AI Studio con créditos de prepago
    (https://ai.studio/projects → proyecto → facturación); sin saldo responde "prepayment credits
    are depleted". `maxOutputTokens` va en 4096 porque el modelo gasta parte del presupuesto en razonar.
  Los mensajes de error del servidor se muestran tal cual en el chat para saber qué falta.
- App Check se retiró de `app.config.ts` el 22/10/2026: nada en el servidor lo exigía y su
  reCAPTCHA solo producía errores 403 en la consola del navegador. `recaptchaSiteKey` y `modeloIA`
  de `firebase.config.ts` quedan solo como referencia.

### Android
- Carpeta `android/` generada con Capacitor 8 (`compileSdk 36`, JDK 21) y permiso `CAMERA`
  para el escáner. Cada vez que cambies la app: `npm run cap:sync`.
- Compilar: `npm run android:apk` (= build web + `cap sync` + `gradlew assembleDebug`, sin Android
  Studio; la primera vez tarda ~13 min, después ~1 min) → `android/app/build/outputs/apk/debug/app-debug.apk`.
  También puedes abrir el proyecto en Android Studio con `npx cap open android`.
- **APK regenerado el 15/09/2026** (11.6 MB): copia en `../Relevo-debug.apk`. Pásalo al teléfono
  (cable, WhatsApp, Drive…) y ábrelo; Android pedirá permitir *Instalar apps desconocidas*. Es una
  build de depuración: sirve para probar y para la demo, no para Play Store (eso requiere firma).
- **Push activo desde el 15/09/2026**: la app Android `com.relevo.app` está registrada en Firebase y
  `android/app/google-services.json` está en el repo (no es secreto). Gradle aplica el plugin
  `google-services` solo cuando ese archivo existe. Al instalar el APK e iniciar sesión, la app pide
  el permiso de notificaciones y guarda el token del teléfono en `usuarios/{uid}.fcmTokens` (§8).
- `npm run android:apk` llama a `.\gradlew.bat` con ruta explícita: sin ella, en terminales con
  `NoDefaultCurrentDirectoryInExePath` cmd no encuentra el archivo aunque esté en la carpeta.

### Pruebas
- `npm run test:rules` — 31 pruebas de Security Rules contra el emulador.
- `npm run test:functions` — 54 pruebas de la lógica de notificaciones y del asistente (mensajes, destinatarios,
  turnos de guardia, alertas, dosis vencidas, avisos previos, duración de tratamientos, días de la
  semana, zona horaria, inventario bajo y su aviso). Corren con Node solo, sin emulador ni Java.
- `npm run test:e2e` — recorrido completo en Chromium contra la app publicada: login, bitácora,
  invitación con QR, reporte + PDF, unirse con código y limpieza de lo creado.

### Fuera de alcance por ahora
Fotos y notas de voz (Storage requiere plan Blaze), captura de signos vitales desde la app, traspaso
de turno, alertas inteligentes, SOS. Las notificaciones (§8) están
programadas pero no desplegadas.
