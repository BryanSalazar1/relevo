# Relevo — Bitácora compartida de cuidado

Proyecto modular · Universidad UNE · Bryan Salazar, Alfredo Santos Gutiérrez, Juan Pablo Rodríguez Torres

Aplicación multiplataforma (web/PWA y Android) para que familiares, enfermeros y médicos lleven un
historial compartido y en tiempo real del cuidado de una persona: la agenda de **Hoy** con la
**Entrega de turno**, bitácora, plan de medicinas, rutina y citas, ficha de emergencia, acceso por
código/QR, reportes en PDF y un asistente con IA que responde preguntas sobre la bitácora.

- **App en producción:** https://relevo-e5eaf.web.app
- **Código y guía técnica:** [`relevo-app/`](relevo-app/README.md) (Ionic 9 + Angular 20 + Capacitor 8 + Firebase)
- **Documentación del proyecto:** `Relevo_Documentacion.docx`, `Relevo_Presentacion.pptx`,
  `Relevo_Proyecto_Modular_v2.docx` (formato IEEE) y `Relevo_Registro_Proyecto.docx`

## Qué hay en la app (13/10/2026)

Cada persona cuidada tiene cinco pestañas: **Hoy** (tomas y tareas del día para marcar, semáforo,
"Desde tu último turno", próximas citas e indicación del médico), **Bitácora** (registros, tomas,
tareas y signos vitales en una sola línea de tiempo), **Plan** (Medicinas · Rutina · Citas),
**Equipo** (ficha médica, miembros, turnos, código de acceso) y **Reporte** (hoja para la consulta de
una página con banderas, preguntas de la familia, medicamentos y signos resumidos; y el PDF completo). La **ficha de emergencia** se abre desde el inicio, Hoy y Equipo. Cada quien elige sus
notificaciones en `/notificaciones`. Roles: el familiar responsable administra el plan; familiares
y enfermeros registran; el médico lee todo y escribe indicaciones médicas.

## Empezar

```bash
cd relevo-app
npm install
npm run emulators    # terminal 1: Firebase local (sin cuenta); luego `npm run semilla` para datos de prueba
ionic serve          # terminal 2: web en http://localhost:8100 (ver FORZAR_EMULADORES en el README de la app)
npm run test:rules   # reglas de seguridad contra el emulador
npm run test:functions   # lógica de notificaciones
npm run test:e2e     # recorrido completo contra la app PUBLICADA (correrlo solo después de un deploy)
npm run android:apk  # APK de depuración (requiere JDK 21 y el SDK de Android)
```

Licencia: MIT.
