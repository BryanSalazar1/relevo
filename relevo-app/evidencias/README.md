# Evidencias de la versión 1.0.0 (31/10/2026)

Registros de ejecución citados en `Relevo_Proyecto_Modular.docx` (preevaluación PM-2026B-ICOM-INC-0019).

| Archivo | Qué es | Cómo se reproduce |
|---|---|---|
| `2026-10-31/00_entorno.txt` | Sistema, Node.js, Java y Firebase CLI usados | — |
| `2026-10-31/01_tipos.txt` | Compilación estricta de TypeScript | `npx tsc -p tsconfig.app.json --noEmit` |
| `2026-10-31/02_reglas_firestore.txt` | 36 pruebas de reglas (permisos, invitaciones, aislamiento, revocación, canjes simultáneos, contador de la IA, fecha de cambio de tratamiento) | `npm run test:rules` |
| `2026-10-31/03_funciones.txt` | 55 pruebas de la lógica de las Cloud Functions (incluido el límite diario de la IA) | `npm run test:functions` |
| `2026-10-31/03b_eliminar_persona_emulador.txt` | Borrado en cascada de una persona contra el emulador | `firebase emulators:exec --only firestore "node --test functions/eliminar-persona.emulador.test.mjs"` |
| `2026-10-31/04_unitarias.txt` | 75 pruebas unitarias del cliente (incluidos los cambios respecto a lo habitual, la tendencia y el semáforo) | `npx ng test --watch=false --browsers=ChromeHeadless` |
| `2026-10-31/05_build.txt` | Build de producción y tamaño | `npm run build` |
| `2026-10-31/06_asistente_ia.txt` / `.json` | Banco de 8 preguntas con respuesta conocida y 2 accesos no autorizados contra la función publicada (corrido el 30/10/2026) | `RELEVO_DEMO_EMAIL=… RELEVO_DEMO_PASSWORD=… node tests/evidencias/prueba-asistente.mjs <salida>` |
| `2026-10-31/07_navegador_sincronizacion_revocacion.txt` | Latencia entre dos sesiones, revocación con la app abierta y borrado de la caché local | Emuladores + semilla + `ng serve --port 4300`, luego `node tests/evidencias/evidencias-navegador.mjs <salida>` |
| `2026-10-31/08_hoja_consulta_ejemplo.pdf` | Hoja para la consulta generada con los datos de demostración (incluye la bandera de presión inusual) | Reporte → Exportar hoja |
| `2026-10-31/09_mejoras_y_recorrido.txt` | Lecturas inusuales, contraseñas de 8 caracteres y recorrido de regresión por roles (19 pasos) | `node tests/evidencias/recorrido-roles.mjs http://localhost:4300 <salida>` con emuladores y semilla |
| `2026-10-31/10_cuota_ia_produccion.txt` | Límite diario de la IA en producción: el contador baja con cada consulta | `RELEVO_DEMO_EMAIL=… RELEVO_DEMO_PASSWORD=… node tests/evidencias/verificar-cuota-ia.mjs` |
| `2026-10-31/11_cambios_personales_navegador.txt` | Lecturas comparadas con lo habitual y la zona clínica en la app; reinicio por cambio de dosis; casos de las pruebas unitarias | Emuladores + semilla + `ng serve --port 4300` |

El recorrido completo por roles está en `tests/evidencias/recorrido-roles.mjs` (mismos requisitos que el de navegador).
Las pruebas de reglas y de navegador corren contra los emuladores con la semilla (`npm run semilla`): no tocan datos reales.
