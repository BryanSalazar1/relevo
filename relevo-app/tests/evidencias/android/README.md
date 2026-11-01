# Recorrido en Android (emulador)

Prueba la app **instalada como APK** en Android 15 contra los emuladores de Firebase con la semilla: no
toca datos reales. Toques reales con `adb` (se ven en la grabación con "mostrar toques"); la página se
lee con la API de Android de Playwright (depurador del WebView del APK de depuración).

Resultado del 01/11/2026: `evidencias/2026-11-01/14_android_emulador.txt`.

## Qué recorre
1. Ana (responsable) abre la app instalada, inicia sesión, ve **Hoy**.
2. **Reporte → Exportar hoja**: el PDF se genera en el teléfono (se comprueba en `cache/` y se copia) y se
   abre el menú de compartir de Android; cerrarlo sin elegir app no muestra error.
3. **Equipo**: la invitación con su QR.
4. Pedro (familiar sin personas) toca "Tengo un código o QR" → **Escanear**: la cámara lee el QR y se une.
5. El Dr. Luis (médico) entra a **Seguimiento**; no tiene Hoy ni semáforo para registrar tomas.

## Requisitos
- Android SDK con `emulator`, `platform-tools` y `system-images;android-35;google_apis;x86_64`;
  `ANDROID_HOME` apuntando al SDK. En Windows, la aceleración WHPX activa (`emulator -accel-check`).
- Un AVD (p. ej. `pixel_6`, 6 núcleos y 4 GB: con menos, Android se satura en el primer arranque).

## Pasos
1. **APK de prueba contra los emuladores** (no se sube; revertir al terminar):
   - `src/environments/environment.development.ts`: `FORZAR_EMULADORES = true`;
   - `android/app/src/main/AndroidManifest.xml`: `android:usesCleartextTraffic="true"` en `<application>`;
   - `npx ng build --configuration development && npx cap sync android && cd android && ./gradlew assembleDebug`.
2. **Emuladores de Firebase y semilla**: `npm run emulators` y `npm run semilla`.
3. **Cuenta de Pedro, invitación y QR**: `node tests/evidencias/android/preparar-android.mjs qr.png`.
   La cámara del emulador escala la imagen para llenar el cuadro y recorta los lados: componer el QR
   pequeño sobre un fondo blanco cuadrado, en el 37 % horizontal y al centro vertical (p. ej. QR de 440 px
   en un lienzo de 1200 px con la esquina en 230, 380).
4. **Emulador con esa imagen como cámara trasera**:
   `emulator -avd <avd> -no-snapshot -cores 6 -memory 4096 -camera-back imagefile:<qr compuesto>.png`.
5. **Instalar y conectar puertos** (en el teléfono, `localhost` es la PC):
   `adb install -r app-debug.apk` y `adb reverse tcp:9099 tcp:9099` (lo mismo con 8080, 9199 y 5001);
   `adb shell settings put system show_touches 1`.
6. `node tests/evidencias/android/recorrido-android.mjs <carpeta>`: deja las grabaciones (`adb screenrecord`),
   las capturas, el PDF y `registro.txt`.
7. Revertir los cambios del paso 1 y volver a compilar el APK normal (`npm run android:apk`).
