# Futures snapshots CSV (`futures-snapshots.csv`)

## 1) Resumen / Propósito
Serie de snapshots intradía de contratos de futuros con precios bid/ask, último trade y open interest. Se genera al interceptar `marketdata/futures/quotes|prices|snapshots` y sirve para monitoreo en tiempo real, dashboards y reconciliación contra barras OHLC.

## 2) Ruta & Nombre
- Ruta relativa: `debug_results`
- Nombre del fichero: `futures-snapshots.csv`

> **Nota**: en producción se emite en `data/futures/<SYMBOL>/snapshots/futures-snapshots.csv`. El fichero en `debug_results/` es un volcado de la sesión de depuración.

## 3) Tipo de fichero
- Tipo: `CSV`
- Formato/convenciones:
  - Delimitador `,`
  - Codificación `utf-8`
  - Encabezado: sí (`asOf,markPrice,...,outOfBand`)

## 4) Esquema / API del fichero

### 4.1 Si es **CSV/JSON/JSONL** (Datos)
- **Granularidad temporal**: eventos en tiempo real; cada fila representa el snapshot recibido (sin agregación por intervalo).
- **Claves de particionado**: símbolo (`symbol`) y fecha de carpeta (`YYYY-MM-DD`) cuando se guarda en `data/futures/<SYMBOL>/snapshots/`.
- **Columnas**:

| Columna                  | Tipo    | Requerida | Descripción                                                                 | Ejemplo                         |
|--------------------------|---------|-----------|-----------------------------------------------------------------------------|---------------------------------|
| `asOf`                   | string  | sí        | Timestamp ISO normalizado del snapshot (`mark_price_timestamp`, etc.).     | `2025-11-11T04:16:34.905Z`      |
| `markPrice`              | number  | sí        | Precio mark / medio reportado.                                             | `1.1577`                        |
| `bidPrice`               | number  | no        | Mejor bid disponible.                                                      | `1.1577`                        |
| `bidSize`                | number  | no        | Tamaño (contratos) del bid.                                                | `9`                             |
| `bidVenueTimestamp`      | string  | no        | Timestamp del venue para el bid.                                           | `2025-11-11T04:16:34.905Z`      |
| `askPrice`               | number  | no        | Mejor ask disponible.                                                      | `1.15775`                       |
| `askSize`                | number  | no        | Tamaño del ask.                                                            | `38`                            |
| `askVenueTimestamp`      | string  | no        | Timestamp del venue para el ask.                                           | `2025-11-11T04:16:34.819Z`      |
| `lastTradePrice`         | number  | no        | Precio del último trade.                                                   | `1.1577`                        |
| `lastTradeSize`          | number  | no        | Tamaño del último trade.                                                   | `1`                             |
| `lastTradeVenueTimestamp`| string  | no        | Timestamp venue del último trade.                                          | `2025-11-11T04:15:56.611Z`      |
| `previousClose`          | number  | no        | Precio de cierre previo reportado.                                         | `1.1576`                        |
| `openInterest`           | number  | no        | Open interest (contratos abiertos).                                        | `57556`                         |
| `state`                  | string  | no        | Estado operativo (`active`, `halted`, etc.).                               | `active`                        |
| `symbol`                 | string  | sí        | Símbolo del contrato (normalizado manteniendo slashes).                    | `/6EZ25:XCME`                   |
| `instrumentId`           | string  | no        | UUID/slug del contrato en mayúsculas.                                      | `55652D05-F6A2-4056-A804-5FDA5FEC18F6` |
| `outOfBand`              | string  | no        | Flag textual cuando la cita está fuera de banda (`'true'|'false'`).        | `false`                         |

> **Notas de derivación**: números aceptan strings y bigints; el normalizador (`normalizeFuturesSnapshots`) convierte a `number` y descarta filas sin ningún precio válido (`markPrice`, `bidPrice`, `askPrice`, `lastTradePrice`, `previousClose`, `openInterest`). Los timestamps se convierten a UTC ISO (con sufijo `Z`).

## 5) Variables, funciones y tipos clave

* **Productor**: `handleSnapshots` dentro de `installFuturesRecorder` (`src/modules/futures/interceptor.ts`).
* **Tipos asociados**: `FUTURES_SNAPSHOT_HEADER` (orden de columnas) y filas `Partial<Record<string, string | number>>`.

## 6) Interacciones / Dependencias

* **Generado por**: `normalizeFuturesSnapshots` a partir de respuestas de `marketdata/futures/(quotes|prices|snapshots)`.
* **Consumidores**:
  * Scripts de depuración (`debug_results/*.md`).
  * Pipelines de analítica que cruzan snapshots con barras (`futures-bars.csv`) o fundamentales.
* **Motivo**: proveer datos tick-level para cálculo de spreads, monitor de liquidez y validación de barras.

## 7) Entradas / Salidas esperadas

* **Entradas**: payloads JSON con arrays (`data`, `results`) o objetos individuales incluyendo precios y timestamps.
* **Salidas**: filas CSV ordenadas según arribo; la escritura en streaming no garantiza ordenamiento global.

## 8) Errores y logging

* Filas sin precios/timestamps relevantes se omiten sin log.
* Si el payload no es JSON válido se registra `console.warn('[futures-recorder] ...')` y se descarta.
* Errores en callbacks `onDiscoveredSymbols` se muestran en consola, pero la escritura continúa.

## 9) Configuración (env vars/flags)

* Sin flags dedicados; `dataPath` puede honrar `DATA_ROOT` si está configurada globalmente.

## 10) Uso & ejemplos

```csv
asOf,markPrice,bidPrice,bidSize,bidVenueTimestamp,askPrice,askSize,askVenueTimestamp,lastTradePrice,lastTradeSize,lastTradeVenueTimestamp,previousClose,openInterest,state,symbol,instrumentId,outOfBand
2025-11-11T04:16:34.905Z,,1.1577,9,2025-11-11T04:16:34.905Z,1.15775,38,2025-11-11T04:16:34.819Z,1.1577,1,2025-11-11T04:15:56.611Z,,,active,/6EZ25:XCME,55652D05-F6A2-4056-A804-5FDA5FEC18F6,false
```

* Consumo en Python:
  ```python
  import pandas as pd
  df = pd.read_csv('data/futures/MESZ25/2025-11-11/snapshots/futures-snapshots.csv', parse_dates=['asOf'])
  df.set_index('asOf').sort_index()
  ```

## 11) Tests y validación

* `tests/futures-interceptor.test.ts` verifica la normalización, timestamps y conversión de booleanos (`outOfBand`).
* Validación manual: ejecutar el módulo `futures` y comparar snapshots con las barras generadas el mismo día.

## 12) Rendimiento

* Escritura secuencial mediante `getCsvWriter` evita reabrir archivos por snapshot.
* El filtrado previo de campos evita crear filas vacías, reduciendo IO innecesario.

## 13) Seguridad

* No contiene datos sensibles; sólo cotizaciones públicas.
* Símbolos y rutas se sanitizan con `dataPath` (`sanitizeSegment`).

## 14) Ejemplos cruzados

* Complementa `docs/data-debug_results-futures-bars.csv.md` (agregación) y `docs/data-debug_results-futures-fundamentals.csv.md` (metadata de contrato).
* Se origina desde `docs/src-modules-futures-interceptor.md`.

## 15) Mantenimiento

* **Propietario**: Equipo Trading API
* **Última actualización**: `2025-11-11`
* **Checklist al cambiar**:
  * Si se añaden columnas en `FUTURES_SNAPSHOT_HEADER`, actualizar la tabla de la sección 4.
  * Documentar nuevos estados `state` o flags booleanos.
  * Verificar que los tests unitarios cubren las transformaciones añadidas.
