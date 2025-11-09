# Seguimiento de expiraciones en opciones

Esta guía resume cómo capturar peticiones de *options chain* en Robinhood, validar el mapeo entre
expiraciones y archivos generados, y comprobar que los módulos para SPY y SPX funcionan tanto en la
vista tradicional como en **Legend**.

## Preparación

1. Asegúrate de tener una sesión válida ejecutando `npm run start:robinhood` y completando MFA si es
   necesario.
2. Si no has lanzado Playwright antes, instala los binarios con `npx playwright install chromium`.
3. Define un prefijo de salida (`--outPrefix`) para separar los artefactos de cada prueba. En los
   ejemplos se usa `spy-chain` y `spx-chain`.

## Capturar y cambiar expiraciones

1. Ejecuta el módulo de SPY con:
   ```bash
   npm run orchestrator -- --module spy-options-chain --action now --outPrefix=spy-chain
   ```
2. Espera a que el navegador abra `https://robinhood.com/options/SPY`. El estado del runner cambia a
   `sniffing` cuando el interceptor y el *socket sniffer* están activos.
3. En la interfaz de Robinhood, abre el desplegable **Expiration** y selecciona una fecha distinta.
   Cada cambio dispara solicitudes `options/` que se registran automáticamente.
4. Observa la consola del orquestador: después de cada respuesta válida se imprimen claves como
   `optionsLastUrl`, `optionsLastCount` y `optionsPrimaryExpiration`, lo que confirma la captura.
5. Verifica el archivo generado ejecutando:
   ```bash
   ls data/options/*/SPY/options/spy-chain-options-*.csv
   tail -n 5 data/options/$(date +%Y-%m-%d)/SPY/options/spy-chain-options-*.csv
   ```
   Selecciona el archivo que corresponda a la expiración elegida. El `tail` permite inspeccionar las
   filas nuevas sin cerrar la sesión.
6. Repite el proceso eligiendo otra expiración para comprobar que se crea un nuevo archivo o que se
   reutiliza el existente si ya hay registros para esa fecha.

## Validar el mapeo expiración ↔ archivo

El nombre del archivo se forma con la regla:

```
<outPrefix>-options-<expiración-sanitizada>.csv
```

- La sanitización reemplaza cualquier carácter que no sea letra, número o guion (`-`) por `-`.
- Cuando la expiración viene en formato ISO (`2024-01-19T09:30:00Z`), se conserva la porción de fecha
  y se normalizan los separadores: `2024-01-19T09-30-00Z`.
- Si la API no envía expiración, se usa el marcador `undated`.

Puedes comprobarlo revisando los archivos dentro de `data/options/<AAAA-MM-DD>/<SIMBOLO>/` o ejecutando los
tests unitarios:

```bash
npx tsx --test tests/options-interceptor.test.ts
```

El bloque `buildOptionsFilename` del test imprime los nombres esperados para distintos formatos de
expiración.

## Compatibilidad con SPX y Legend

1. Lanza el módulo de SPX:
   ```bash
   npm run orchestrator -- --module spx-options-chain --action now --outPrefix=spx-chain
   ```
2. Cambia la expiración igual que en SPY y confirma que aparecen archivos bajo
   `data/options/<fecha>/SPX/options/spx-chain-options-<expiracion>.csv`.
3. El *socket sniffer* se activa automáticamente para ambos módulos. Puedes inspeccionar la actividad
   de Legend con:
   ```bash
   ls data/options/*/SPX/spx-chain-*.jsonl
   tail -f data/options/$(date +%Y-%m-%d)/SPX/spx-chain-*.jsonl | grep legendOptions
   ```
   Verás eventos `legendOptions` y `legendNews` cuando la página Legend reciba actualizaciones.
4. Repite los pasos para SPY si necesitas validar ambas cadenas en paralelo. Usa prefijos distintos
   para separar los registros.

> ℹ️ Si necesitas cerrar el proceso, usa `Ctrl+C` en la terminal. El runner vacía los *buffers* antes
> de salir para evitar archivos truncados.

## Limpieza opcional

Al finalizar las pruebas, puedes eliminar los artefactos generados ejecutando:

```bash
rm -rf data/options logs/*-socket-sniffer.log
```

Esto mantiene el repositorio limpio para la siguiente sesión.
