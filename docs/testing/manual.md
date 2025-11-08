# Consideraciones de testing manual

Mantén estas verificaciones rápidas cuando hagas pases manuales sobre el
orquestador y los runners.

- **Verificar ausencia de compresión en capturas.** Abre el CSV más reciente con
  un editor de texto y confirma que los datos sean legibles (sin caracteres
  binarios ni encabezados `Content-Encoding` registrados en los logs).
- **Revisar la sesión del navegador.** En runners que reutilizan perfiles,
  comprueba que no aparezcan diálogos de consentimiento ni pantallas de login.
- **Monitorear uso de almacenamiento.** Evalúa que `data/` y `logs/` no excedan
  el espacio asignado en el entorno. El comando `du -sh data logs` ayuda a
  identificar acumulaciones inusuales.
- **Confirmar cierre limpio.** Tras usar `Ctrl+C` o `npx trade-api stop <ctxId>`,
  espera el mensaje de salida en consola y revisa que no queden procesos
  `playwright` o `chrome` huérfanos (`ps -A | grep playwright`).
- **Sincronizar relojes.** Para comparaciones con otras fuentes (p.ej., feeds de
  datos oficiales) valida que la hora del sistema esté en UTC (`date -u`).
