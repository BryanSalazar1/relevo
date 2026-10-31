# Evidencias de la versión 1.0.0 (30/10/2026)

Registros de ejecución citados en `Relevo_Proyecto_Modular.docx` (preevaluación PM-2026B-ICOM-INC-0019).

| Archivo | Qué es | Cómo se reproduce |
|---|---|---|
| `2026-10-30/00_entorno.txt` | Sistema, Node.js, Java y Firebase CLI usados | — |
| `2026-10-30/01_tipos.txt` | Compilación estricta de TypeScript | `npx tsc -p tsconfig.app.json --noEmit` |
| `2026-10-30/02_reglas_firestore.txt` | 34 pruebas de reglas (permisos, invitaciones, aislamiento, revocación, canjes simultáneos) | `npm run test:rules` |
| `2026-10-30/03_funciones.txt` | 54 pruebas de la lógica de las Cloud Functions | `npm run test:functions` |
| `2026-10-30/03b_eliminar_persona_emulador.txt` | Borrado en cascada de una persona contra el emulador | `firebase emulators:exec --only firestore "node --test functions/eliminar-persona.emulador.test.mjs"` |
| `2026-10-30/04_unitarias.txt` | 57 pruebas unitarias del cliente | `npx ng test --watch=false --browsers=ChromeHeadless` |
| `2026-10-30/05_build.txt` | Build de producción y tamaño | `npm run build` |
| `2026-10-30/06_asistente_ia.txt` / `.json` | Banco de 8 preguntas con respuesta conocida y 2 accesos no autorizados contra la función publicada | `RELEVO_DEMO_EMAIL=… RELEVO_DEMO_PASSWORD=… node tests/evidencias/prueba-asistente.mjs <salida>` |
| `2026-10-30/07_navegador_sincronizacion_revocacion.txt` | Latencia entre dos sesiones, revocación con la app abierta y borrado de la caché local | Emuladores + semilla + `ng serve --port 4300`, luego `node tests/evidencias/evidencias-navegador.mjs <salida>` |
| `2026-10-30/08_hoja_consulta_ejemplo.pdf` | Hoja para la consulta generada con los datos de demostración | Reporte → Exportar hoja |

El recorrido completo por roles está en `tests/evidencias/recorrido-roles.mjs` (mismos requisitos que el de navegador).
Las pruebas de reglas y de navegador corren contra los emuladores con la semilla (`npm run semilla`): no tocan datos reales.
