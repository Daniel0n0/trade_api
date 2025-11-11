# Futures bars CSV (`futures-bars.csv`)

## 1) Resumen / Propósito
Serie histórica de barras de futuros normalizada a partir de respuestas Robinhood (`marketdata/futures/historicals`). Contiene OHLCV y metadatos de sesión para análisis intradía/backtesting y para alimentar visualizaciones en el pipeline de futuros.

## 2) Ruta & Nombre
- Ruta relativa: `debug_results`
- Nombre del fichero: `futures-bars.csv`

> **Nota**: en ejecución normal, el interceptor escribe en `data/futures/<SYMBOL>/<DATE>/bars/futures-bars.csv`; este archivo en `debug_results/` es un volcado de prueba.

## 3) Tipo de fichero
- Tipo: `CSV`
- Formato/convenciones:
  - Delimitador `,`
  - Codificación `utf-8`
  - Encabezado: sí (`beginsAt,open,high,low,close,volume,session,symbol,instrumentId,interval,span,bounds`)

## 4) Esquema / API del fichero

### 4.1 Si es **CSV/JSON/JSONL** (Datos)
- **Granularidad temporal**: variable (`1minute`, `5minute`, `10minute`, etc.) según parámetro `interval` de la solicitud.
- **Claves de particionado**: símbolo de contrato (`symbol`) y fecha de carpeta (`YYYY-MM-DD`) al persistirse en `data/`.
- **Columnas**:

| Columna      | Tipo     | Requerida | Descripción                                                                 | Ejemplo                           |
|--------------|----------|-----------|-----------------------------------------------------------------------------|-----------------------------------|
| `beginsAt`   | string   | sí        | Timestamp ISO8601 UTC del inicio de la barra.                               | `2025-11-11T04:15:00.000Z`        |
| `open`       | number   | sí        | Precio de apertura normalizado.                                            | `6858.75`                         |
| `high`       | number   | sí        | Precio máximo de la ventana.                                               | `6859.50`                         |
| `low`        | number   | sí        | Precio mínimo de la ventana.                                               | `6857.50`                         |
| `close`      | number   | sí        | Precio de cierre/último disponible en la ventana.                          | `6857.75`                         |
| `volume`     | number   | no        | Volumen agregado (contratos) para la barra; puede venir vacío según feed.  | `455`                             |
| `session`    | string   | no        | Sesión de negociación (`REGULAR`, `GLOBEX`, etc.), uppercase.               | `REGULAR`                         |
| `symbol`     | string   | sí        | Símbolo del contrato normalizado (fallback a `GENERAL` si no llega).       | `MESZ25`                          |
| `instrumentId` | string | no        | UUID/slug del instrumento; si falta se rellena con símbolo/fallback.       | `CONTRACTS`                       |
| `interval`   | string   | no        | Resolución solicitada (`5minute`, `10minute`, `hour`, ...).                | `5minute`                         |
| `span`       | string   | no        | Horizonte histórico (`day`, `week`, ...); deriva de query o payload.       | `week`                            |
| `bounds`     | string   | no        | Restricción temporal (`trading`, `extended`) o ISO when provided downstream | `trading`                         |

> **Notas de derivación**: Los campos numéricos aceptan strings numéricas; `normalizeFuturesBars` convierte y filtra filas sin OHLC/volumen válidos.

## 5) Variables, funciones y tipos clave

* **Productor principal**: `normalizeFuturesBars` + `handleBars` en `src/modules/futures/interceptor.ts`.
* **Tipos asociados**: `FUTURES_BARS_HEADER` define el orden de columnas; las filas son `Partial<Record<string, string | number>>`.

## 6) Interacciones / Dependencias

* **Generado por**: `installFuturesResponseRecorder` (mismo fichero) cuando intercepta `marketdata/futures/historicals`.
* **Consumidores**:
  * Scripts de análisis en `debug_results/`.
  * Módulos downstream que esperan OHLCV para cálculo de indicadores o sincronización con snapshots (`futures-snapshots.csv`).
* **Motivo**: Consolidar en CSV simple las barras de precio y metadatos necesarios para reconstruir sesiones.

## 7) Entradas / Salidas esperadas

* **Entradas**: Arrays JSON (payload Robinhood) con campos `begins_at`, `open_price`, `volume`, etc.; query params `interval`, `span`, `bounds`.
* **Salidas**: Filas CSV ordenadas cronológicamente según llegan; no hay garantizada ordenación previa por timestamp.

## 8) Errores y logging

* Filas sin `beginsAt` o sin al menos un valor numérico en OHLCV se descartan silenciosamente.
* Símbolos descubiertos se reportan vía `options.onDiscoveredSymbols`; errores en callbacks generan `console.warn('[futures-recorder] ...')` (ver `interceptor.ts`).

## 9) Configuración (env vars/flags)

* Sin flags dedicados. El destino final depende de `dataPath`, que toma `process.cwd()` y parámetros `assetClass` / `symbol` / `date`.

## 10) Uso & ejemplos

```csv
beginsAt,open,high,low,close,volume,session,symbol,instrumentId,interval,span,bounds
2025-11-11T04:15:00.000Z,6858.75,6859.5,6857.5,6857.75,455,,MESZ25,CONTRACTS,5minute,,trading
```

* Consumir en Python:
  ```python
  import pandas as pd
  df = pd.read_csv('data/futures/MESZ25/2025-11-11/bars/futures-bars.csv', parse_dates=['beginsAt'])
  df.set_index('beginsAt').sort_index()
  ```

## 11) Tests y validación

* `tests/futures-interceptor.test.ts` cubre la normalización de históricos, garantizando que se convierten los campos y que se omiten filas sin OHLC.
* Validación manual: ejecutar el módulo `futures` y confirmar generación de CSVs junto a `futures-snapshots.csv` y `futures-fundamentals.csv`.

## 12) Rendimiento

* Escritura en streaming mediante `getCsvWriter` evita reabrir archivos.
* `readLastTimestamp` no aplica directamente, pero el writer reutiliza el mismo descriptor para anexar sin reprocesar datos previos.

## 13) Seguridad

* Nombres de símbolo/archivo sanitizados via `dataPath` (`sanitizeSegment`).
* No contiene información sensible más allá de datos de mercado públicos.

## 14) Ejemplos cruzados

* Relacionado con `docs/src-modules-options-interceptor.md` en cuanto al patrón de interceptores.
* Complementa `futures-snapshots.csv` (quotes en tiempo real) y `futures-fundamentals.csv` (metadata de contrato).

## 15) Mantenimiento

* **Propietario**: Equipo Trading API
* **Última actualización**: `2025-11-11`
* **Checklist al cambiar**:
  * Si se añaden columnas en `FUTURES_BARS_HEADER`, actualizar la tabla de la sección 4.
  * Documentar nuevos valores posibles de `interval`, `session` o `bounds`.
  * Confirmar que los tests en `tests/futures-interceptor.test.ts` cubren las transformaciones nuevas.

