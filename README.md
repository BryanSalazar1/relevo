# Relevo — Bitácora compartida de cuidado

Proyecto modular · Universidad UNE · Bryan Salazar, Alfredo Santos Gutiérrez, Juan Pablo Rodríguez Torres

Aplicación multiplataforma (web/PWA y Android) para que familiares, enfermeros y médicos lleven un
historial compartido y en tiempo real del cuidado de una persona: bitácora, acceso por código/QR,
reportes en PDF y un asistente con IA que responde preguntas sobre la bitácora.

- **App en producción:** https://relevo-e5eaf.web.app
- **Código y guía técnica:** [`relevo-app/`](relevo-app/README.md) (Ionic 9 + Angular 20 + Capacitor 8 + Firebase)
- **Documentación del proyecto:** `Relevo_Documentacion.docx`, `Relevo_Presentacion.pptx`,
  `Relevo_Proyecto_Modular_v2.docx` (formato IEEE) y `Relevo_Registro_Proyecto.docx`

## Empezar

```bash
cd relevo-app
npm install
ionic serve          # web en http://localhost:8100
npm run test:rules   # reglas de seguridad contra el emulador
npm run test:e2e     # recorrido completo contra la app publicada
npm run android:apk  # APK de depuración (requiere JDK 21 y el SDK de Android)
```

Licencia: MIT.
