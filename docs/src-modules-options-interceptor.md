# Options response interceptor (`installOptionsResponseRecorder`)

## 1) Resumen / Propósito
Captura las respuestas HTTP de Robinhood Options desde Playwright, normaliza los payloads JSON y genera series CSV de cadenas de opciones por símbolo/expiración. Sirve como capa de ingesta en tiempo real para el módulo de orquestación de opciones.

## 2) Ruta & Nombre
- Ruta relativa: `src/modules/options`
- Nombre del fichero: `interceptor.ts`

## 3) Tipo de fichero
- Tipo: `TS`
- Formato/convenciones:
  - ESM con `moduleResolution: NodeNext`.
  - Compilación strict (`strict: true` en `tsconfig.json`).

## 4) Esquema / API del fichero

### 4.2 Si es **TS** (Código)
- **API (exports)**:
  - `installOptionsResponseRecorder(options: OptionsRecorderOptions): OptionsRecorderHandle`
  - `buildOptionsFilename(logPrefix: string, expiration?: string): string`
  - `computeDte(expiration: string | undefined, now: DateTime): number | undefined`
  - `collectOptionRecords(payload: unknown): Record<string, unknown>[]`
  - `deriveChainSymbol(record: Record<string, unknown>): string | undefined`
  - `formatExpirationForFilename(expiration: string | undefined): string`
  - `readLastTimestamp(filePath: string, headerLine: string): number | undefined`
  - `normalizeExpiration(raw: string | undefined): string | undefined`
  - `optionRowFromRecord(record, meta): OptionCsvRow | null`
  - `normaliseOptionType(value: string | undefined): string | undefined`
  - `isValidOptionRow(row: OptionCsvRow): boolean`
- **Contrato de `installOptionsResponseRecorder`**:
  - **Descripción**: Registra un listener `context.on('response')` que filtra peticiones `fetch/xhr` hacia dominios Robinhood relacionados con opciones, extrae registros y los persiste en CSV segmentado por símbolo y expiración.
  - **Parámetros** (`OptionsRecorderOptions`):
    - `page: Page` Playwright de origen.
    - `logPrefix: string` prefijo para nombrar CSVs y logs.
    - `symbols?: string[]` filtro whitelist (uppercase automático).
    - `optionsDate?: string` expiración primaria sugerida (`YYYY-MM-DD`).
    - `horizonDays?: number` límite de días a vencimiento para priorizar rutas.
    - `urlMode?: UrlMode` metadato propagado a `updateInfo`.
    - `onPrimaryExpirationChange?(exp: string | undefined)` callback cuando cambia la expiración principal derivada de tráfico.
    - `updateInfo?(info: Record<string, unknown>)` hook para telemetría hacia el orquestador.
  - **Retorno** (`OptionsRecorderHandle`):
    - `close(): Promise<void>` detiene el listener y cierra streams abiertos.
    - `getPrimaryExpiration(): string | undefined` exp actual inferida.
  - **Errores**: No lanza directamente; atrapa errores de lectura JSON y los reporta vía `console.warn` sin interrumpir el flujo.
  - **Side-effects**: Escritura de CSV en disco (`data/stocks/<SYMBOL>/<DATE>/options/...`), logs en `console.warn`.
- **Ejemplo de uso**:
  ```ts
  import { installOptionsResponseRecorder } from '../src/modules/options/interceptor.js';
  import { chromium } from 'playwright';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const recorder = installOptionsResponseRecorder({
    page,
    logPrefix: 'spy-chain',
    symbols: ['SPY', 'SPX'],
    horizonDays: 30,
    updateInfo: (info) => console.info(info),
  });
  await page.goto('https://robinhood.com/options/chains/SPY');
  // ... ejecutar scraping ...
  await recorder.close();
  ```

## 5) Variables, funciones y tipos clave

* **Variables de entorno**: No requiere variables específicas; utiliza `process.cwd()` para resolver `data/`.
* **Tipos internos**:
  * `OptionCsvRow`: `Partial<Record<OptionCsvHeader[number], string | number | undefined>>`.
  * `OptionsWriterEntry`: gestiona `write` y `lastTimestamp` por fichero.
* **Funciones internas relevantes**:
  * `shouldProcessResponse(response)` filtra por URL, dominio, `content-type`, tamaño y tipo de recurso Playwright.
  * `collectOptionRecords(payload)` recorre recursivamente payloads anidados (`market_data`, `greeks`, etc.).
  * `optionRowFromRecord(record, meta)` deriva `chainSymbol`, expiración, `dte`, precios y griegas.
  * `isValidOptionRow(row)` valida números finitos, rangos positivos y tipo CALL/PUT.
  * `readLastTimestamp(path, header)` permite reanudar sin duplicar ticks retrocediendo hasta 64 KB al final del CSV.

## 6) Interacciones / Dependencias

* **Lee de**:
  * Eventos `BrowserContext.on('response')` (Playwright) para `xhr/fetch`.
  * Endpoints Robinhood `marketdata/options`, `options/`, `option_marketdata`, `options_chains`.
* **Escribe en**:
  * `data/stocks/<SYMBOL>/<DATE>/options/<logPrefix>-options-<expiration>.csv`
  * `.../options/in_the_future/<expiration>/<logPrefix>-options-<expiration>.csv` cuando `dte > horizonDays`.
* **Depende de**:
  * `src/io/csvWriter.ts` (gestiona streams y encabezados).
  * `src/io/paths.ts` (`dataPath` crea estructura de carpetas por activo).
  * `src/io/row.ts` (`toCsvLine`).
  * `luxon` (`DateTime`) para normalizar timestamps y `dte`.
  * Tipos `UrlMode` de `src/orchestrator/messages.ts` para telemetría.
* **Motivo**: consolidar toda la información de cotizaciones de opciones (precios, griegas, OI) en archivos CSV incrementales listos para análisis intradía y backtesting.

## 7) Entradas / Salidas esperadas

* **Entradas**:
  * Respuestas JSON de Robinhood Options (quotes, greeks, chains) recibidas en el `Page` de Playwright.
  * Opcionalmente `OptionsRecorderOptions.symbols`, `optionsDate`, `horizonDays` para acotar universo y vencimientos.
* **Salidas**:
  * CSVs con encabezado `t,chainSymbol,occSymbol,...,source` donde cada fila representa un snapshot normalizado.
  * Actualizaciones periódicas a `updateInfo` con métricas (`optionsLastCount`, `optionsPrimaryExpiration`, etc.).

## 8) Errores conocidos & manejo

* Payloads no-JSON o streams vacíos: se loguea un warning con URL, status y headers, y se ignora la respuesta.
* Respuestas con `content-length` > 5 MB se descartan preventivamente para evitar lecturas excesivas.
* Al cerrar (`close()`), se espera a que todas las promesas pendientes (`pending` Set) finalicen antes de liberar streams.

## 9) Logging y trazabilidad

* Mensajes `console.warn('[options-interceptor] ...')` cuando falla la lectura de JSON o se lee timestamp previo.
* `updateInfo` recibe snapshots de estado (última URL procesada, contador, expiración primaria, ISO timestamp).
* Identificadores clave en logs: `logPrefix`, `response.url()`, `primaryExpiration`.

## 10) Configuración / Flags

* `OptionsRecorderOptions.horizonDays` controla si los contratos futuros se guardan en `in_the_future/`.
* `OptionsRecorderOptions.urlMode` (propagado desde CLI/orquestador) documenta la estrategia de navegación (`auto`, `module`, `symbol`).
* Los CSV se nombran con `logPrefix` sanitizado (`sanitizeLogPrefixForFilename`).

## 11) Rendimiento

* Usa `getCsvWriter` para reusar streams y evitar reabrir archivos en cada fila.
* `readLastTimestamp` sólo lee hasta 64 KB desde el final de cada fichero para deduplicar, minimizando I/O.
* Filtrado temprano (`shouldProcessResponse`) evita parseos innecesarios de payloads grandes o irrelevantes.

## 12) Seguridad

* Filtra trackers/analytics (`TRACKER_URL_PATTERN`) para no capturar PII ni ruido externo.
* Sanitiza nombres de archivo y símbolos (`sanitizeLogPrefixForFilename`, `formatExpirationForFilename`).
* No persiste cookies ni tokens; opera sólo sobre respuestas ya interceptadas.

## 13) Ejemplos

### 13.1 Ejemplo — fila CSV generada

| Columna            | Valor ejemplo                     |
|--------------------|-----------------------------------|
| `t`                | `1731302400000` (ms UTC)          |
| `chainSymbol`      | `SPY`                             |
| `occSymbol`        | `SPY  241115C00470000`            |
| `instrumentId`     | `1b6d...`                         |
| `expiration`       | `2024-11-15`                      |
| `dte`              | `14.958333`                       |
| `strike`           | `470`                             |
| `type`             | `CALL`                            |
| `bid` / `ask`      | `1.15` / `1.20`                   |
| `impliedVolatility`| `0.235`                           |
| `delta`            | `0.32`                            |
| `underlyingPrice`  | `468.42`                          |
| `source`           | `https://api.robinhood.com/...`   |

### 13.2 Ejemplo — uso en runner de opciones

El `options` runner (`src/modules/options/runner.ts`) invoca `installOptionsResponseRecorder` al iniciar la navegación y se suscribe a `onPrimaryExpirationChange` para actualizar la UI CLI del orquestador.

## 14) Tests & Validación

* **Unit**:
  * `tests/options-interceptor.test.ts` cubre `buildOptionsFilename`, `formatExpirationForFilename`, `readLastTimestamp`, `collectOptionRecords` e `isValidOptionRow`.
* **Integración**:
  * `tests/options-runner.test.ts` valida que el runner enruta correctamente URLs y propaga `optionsDate/horizon` hacia el interceptor.
  * Escenarios manuales con Playwright lanzando `modules/options` observando CSVs en `data/`.
* **Chequeo de esquema**:
  * Cada stream escribe encabezado `OPTION_HEADER` antes de datos; `getCsvWriter` fuerza encabezado único.

## 15) Mantenimiento

* **Propietario**: Equipo Trading API
* **Última actualización**: `2025-11-11`
* **Checklist al cambiar**:
  * Actualizar secciones 4–7 si se agregan columnas nuevas o cambia la derivación de `dte`.
  * Documentar nuevas exclusiones en `shouldProcessResponse` (ej. trackers adicionales).
  * Revisar pruebas en `tests/options-interceptor.test.ts` y añadir casos para nuevos campos/griegas.

