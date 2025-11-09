# Checklist de QA para capturas

Usa esta lista antes de dar por válida una ejecución manual o automatizada.

## Archivos generados

- [ ] Confirmar que `data/<CLASE>/<AAAA-MM-DD>/<SÍMBOLO>/` contiene los CSV esperados.
- [ ] Verificar que los nombres siguen el prefijo impreso por la CLI
      (`<módulo>-<acción>-<timestamp>-<símbolos>`).
- [ ] Revisar que los archivos `.jsonl` asociados (Legend o sockets) existen
      cuando el runner debería producirlos.

## Encabezados y formato

- [ ] Abrir el CSV más reciente y comprobar que la fila de encabezados coincide
      con el esquema documentado para el módulo.
- [ ] Validar que las columnas de fecha/hora están en ISO 8601 y en UTC.
- [ ] Asegurarse de que no hay columnas adicionales en blanco ni separadores
      inconsistentes.

## Coherencia de datos

- [ ] Revisar que los *timestamps* estén dentro del intervalo solicitado (`--start`
      / `--end`).
- [ ] Comparar conteos (`optionsLastCount`, `legendOptions`, etc.) con el número
      de filas nuevas registradas.
- [ ] Corroborar que los símbolos capturados corresponden al módulo o a la lista
      pasada vía `--symbols`.
- [ ] Registrar cualquier discrepancia en los logs (`logs/<prefijo>-*.log`) antes
      de archivar los artefactos.
