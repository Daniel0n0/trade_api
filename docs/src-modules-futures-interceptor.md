# Futures response recorder (`installFuturesRecorder`)

## 1) Resumen / Propósito
Captura las respuestas HTTP relacionadas con futuros que recibe Playwright, normaliza sus payloads JSON y persiste CSVs de barras, snapshots, fundamentales y metadatos auxiliares. Es la capa de ingesta para alimentar las carpetas `data/futures/` y los `debug_results/`.

## 2) Ruta & Nombre
- Ruta relativa: `src/modules/futures`
- Nombre del fichero: `interceptor.ts`

## 3) Tipo de fichero
- Tipo: `TS`
- Formato/convenciones:
  - ESM (`moduleResolution: NodeNext`).
  - Compilación estricta (`strict: true`).

## 4) Esquema / API del fichero

### 4.2 Si es **TS** (Código)
- **API (exports)**:
  - `installFuturesRecorder(options: FuturesRecorderOptions): FuturesRecorderHandle`
  - `normalizeFuturesBars(payload, context): FuturesCsvRow[]`
  - `normalizeFuturesSnapshots(payload, context): FuturesCsvRow[]`
  - `normalizeFuturesFundamentals(payload, context): FuturesCsvRow[]`
  - `normalizeFuturesContracts(payload, context): FuturesCsvRow[]`
  - `normalizeFuturesTradingSessions(payload, context): FuturesCsvRow[]`
  - `normalizeFuturesMarketHours(payload, context): FuturesCsvRow[]`
  - Constantes `FUTURES_*_HEADER` y patrones RegExp (`FUTURES_HISTORICAL_PATTERN`, etc.).
- **Contrato de `installFuturesRecorder`**:
  - **Descripción**: suscribe `page.on('response')` para filtrar peticiones JSON de futuros, normalizarlas y escribir múltiples CSVs segmentados por símbolo.
  - **Parámetros** (`FuturesRecorderOptions`):
    - `page: Page` obligatorio, instancia Playwright.
    - `logPrefix?: string` prefijo opcional para logs (actualmente no se usa al nombrar ficheros).
    - `symbols?: string[]` lista de símbolos iniciales; el primero actúa como `fallbackSymbol`.
    - `onDiscoveredSymbols?(symbols)` callback opcional para reportar nuevos símbolos normalizados.
  - **Retorno** (`FuturesRecorderHandle`):
    - `close(): Promise<void>` desuscribe el listener y cierra streams CSV abiertos.
  - **Errores**: los errores de IO se capturan con `console.warn` (p.ej. al cerrar streams o al guardar `inbox-threads`).
  - **Side-effects**: escritura en `data/futures/<SYMBOL>/**` y `appendFile` de `overview/inbox-threads.jsonl`.
- **Contrato de normalizadores** (`normalizeFutures*`):
  - **Descripción**: convierten estructuras Robinhood (que varían entre `results`, `data`, objetos únicos) a filas `Partial<Record<HEADER, string|number>>`.
  - **Parámetros**:
    - `payload: unknown` fuente JSON (puede ser arrays anidados, objetos o wrappers `data/results`).
    - `context: { url?: string; fallbackSymbol?: string }` con URL de origen para extraer params y símbolo de respaldo.
  - **Retorno**: arrays de filas con timestamps ISO, números convertidos y símbolos normalizados.
  - **Errores**: filtran silenciosamente entradas inválidas (`if (!rowSymbol) continue`) sin lanzar.

## 5) Variables, funciones y tipos clave

* **Variables de entorno**: no requiere específicas; deriva rutas usando `process.cwd()` vía `dataPath`.
* **Tipos internos**:
  * `FuturesCsvRow<T>`: `Partial<Record<T[number], string | number>>`.
  * `NormalizeContext`: `{ url?: string; fallbackSymbol?: string }`.
  * `FuturesRecorderOptions`, `FuturesRecorderHandle`.
* **Funciones internas relevantes**:
  * `toNumber`, `toStringValue`, `toIsoString`, `normaliseSymbol` (helpers para limpiar datos).
  * `extractSymbol`, `extractQueryParams`, `hasNumericFields`.
  * `extractSymbolsFromRows` reúne símbolos para `onDiscoveredSymbols`.
  * `persistInboxThreadsSnapshot` persiste snapshots JSONL si la respuesta es `inbox/threads`.

## 6) Interacciones / Dependencias

* **Lee de**:
  * Eventos `BrowserContext/Page.on('response')` (Playwright).
  * Endpoints Robinhood `marketdata/futures/*` y `arsenal/v1/futures/*`.
* **Escribe en**:
  * `data/futures/<SYMBOL>/bars/futures-bars.csv`
  * `data/futures/<SYMBOL>/snapshots/futures-snapshots.csv`
  * `data/futures/<SYMBOL>/fundamentals/futures-fundamentals.csv`
  * `data/futures/<SYMBOL>/contracts/futures-contracts.csv`
* `data/futures/<SYMBOL>/sessions/futures-trading-sessions-detail.csv`
* `data/futures/<SYMBOL>/sessions/futures-trading-sessions-summary.csv`
  * `data/futures/<SYMBOL>/market-hours/futures-market-hours.csv`
  * `data/futures/GENERAL/overview/inbox-threads.jsonl`
* **Depende de**:
  * `src/io/csvWriter.ts` (`getCsvWriter`).
  * `src/io/paths.ts` (`dataPath`, sanitización de segmentos).
  * `src/io/row.ts` (`toCsvLine`).
  * `src/utils/payload.ts` (`safeJsonParse`).
  * `luxon` para normalizar fechas (a través de utilidades `toIsoString`).
* **Motivo**: mantener un pipeline consistente de datos de futuros (OHLCV, quotes, fundamentals, sesiones) para análisis y orquestación en CLI.

## 7) Entradas / Salidas esperadas

* **Entradas**:
  * Respuestas JSON (200 OK) de los endpoints anteriores.
  * `options.symbols` opcional para delimitar universo y establecer fallback.
* **Salidas**:
  * CSVs incrementales (cabecera única) escritos por símbolo.
  * Evento `onDiscoveredSymbols` con símbolos nuevos detectados.
  * JSONL en `inbox-threads.jsonl` cuando el payload no es parseable.

## 8) Errores conocidos & manejo

* Respuestas sin cuerpo o con JSON inválido: se registran con `console.warn` y se ignoran.
* `response.status() >= 400`: se descartan sin procesar.
* Streams CSV: al cerrar se gestionan eventos `finish/error` para evitar rechazos no controlados.
* Payloads sin campos numéricos clave (OHLC, precios) se omiten silenciosamente.

## 9) Logging y trazabilidad

* Prefijo `console.warn('[futures-recorder] ...')` para advertencias (respuestas vacías, errores en callbacks, problemas de guardado).
* `notifyDiscoveredSymbols` registra fallos del callback en consola.
* Los nombres de archivo incorporan símbolo sanitizado y carpeta temática (`bars/`, `snapshots/`, etc.).

## 10) Configuración / Flags

* No tiene flags propios. El comportamiento depende de `options.symbols` y `onDiscoveredSymbols`.
* Rutas gestionadas por `dataPath`, que usa `DATA_ROOT` si la aplicación lo define (ver documentación de IO).

## 11) Rendimiento

* `getCsvWriter` reutiliza streams abiertos para evitar overhead de IO.
* Se evita parsear respuestas grandes que no sean JSON (ver `isJsonContentType`).
* Filtrado temprano por RegExp previene trabajo innecesario en respuestas no relacionadas.

## 12) Seguridad

* Sanitiza símbolos y segmentos de ruta (`dataPath`).
* Sólo escribe datos de mercado públicos; no persiste cookies ni credenciales.
* Ignora endpoints no JSON para reducir riesgo de fuga de binarios.

## 13) Ejemplos

### 13.1 Uso básico en runner de futuros
```ts
import { installFuturesRecorder } from './modules/futures/interceptor.js';

const recorder = installFuturesRecorder({
  page,
  symbols: ['MESZ25'],
  onDiscoveredSymbols: (symbols) => console.info('nuevos símbolos', symbols),
});

await page.goto('https://robinhood.com/futures');
// ... ejecutar navegación y esperar tráfico ...
await recorder.close();
```

### 13.2 Ejemplo de filas CSV generadas
- Ver `docs/data-debug_results-futures-bars.csv.md`
- Ver `docs/data-debug_results-futures-snapshots.csv.md`
- Ver `docs/data-debug_results-futures-fundamentals.csv.md`

## 14) Tests & Validación

* **Unit**: `tests/futures-interceptor.test.ts` cubre todos los normalizadores y casos especiales (instrument IDs, sesiones, market hours).
* **Integración**: ejecución manual del módulo `futures` con Playwright verificando la creación de CSVs en `data/futures/` y `debug_results/`.
* **Chequeo de esquema**: `getCsvWriter` garantiza encabezado único; los tests aseguran que cada `FUTURES_*_HEADER` se respeta.

## 15) Mantenimiento

* **Propietario**: Equipo Trading API
* **Última actualización**: `2025-11-11`
* **Checklist al cambiar**:
  * Actualizar las secciones 4–7 si se añaden columnas o nuevos endpoints.
  * Añadir documentación enlazada para nuevos CSVs generados.
  * Extender tests en `tests/futures-interceptor.test.ts` para nuevos campos o cambios de normalización.
