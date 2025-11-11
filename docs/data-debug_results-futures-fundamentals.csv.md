# Futures fundamentals CSV (`futures-fundamentals.csv`)

## 1) Resumen / Propósito
Describe los atributos fundamentales de cada contrato de futuros (márgenes, fechas clave, multiplicador, estado). Se genera a partir de `marketdata/futures/fundamentals` para enriquecer dashboards, filtros de orquestación y validaciones de riesgo.

## 2) Ruta & Nombre
- Ruta relativa: `debug_results`
- Nombre del fichero: `futures-fundamentals.csv`

> **Nota**: normalmente se escribe en `data/futures/<SYMBOL>/fundamentals/futures-fundamentals.csv`; esta copia en `debug_results/` corresponde a una sesión de prueba.

## 3) Tipo de fichero
- Tipo: `CSV`
- Formato/convenciones:
  - Delimitador `,`
  - Codificación `utf-8`
  - Encabezado: sí (`symbol,instrumentId,...,updatedAt`)

## 4) Esquema / API del fichero

### 4.1 Si es **CSV/JSON/JSONL** (Datos)
- **Granularidad temporal**: snapshots esporádicos (no series); se sobrescriben cuando el API entrega nuevas lecturas.
- **Claves de particionado**: símbolo (`symbol`) y fecha de carpeta (`YYYY-MM-DD`) al persistirse en `data/futures/<SYMBOL>/fundamentals/`.
- **Columnas**:

| Columna              | Tipo    | Requerida | Descripción                                                                                  | Ejemplo                              |
|----------------------|---------|-----------|----------------------------------------------------------------------------------------------|--------------------------------------|
| `symbol`             | string  | sí        | Símbolo principal del contrato (upper-case).                                                 | `MESZ25`                             |
| `instrumentId`       | string  | sí        | UUID/slug del contrato en mayúsculas.                                                        | `C4021DC3-BC5C-4252-A5B9-209572A1CB78` |
| `productId`          | string  | no        | Identificador del producto raíz al que pertenece el contrato.                                | `F5E6B1CD-3D23-4ADD-8C51-385DD953A850` |
| `rootSymbol`         | string  | no        | Símbolo raíz (sin vencimiento) si el payload lo provee.                                      | `MES`                                |
| `contractType`       | string  | no        | Tipo de contrato (por ejemplo, `future`).                                                    | `future`                             |
| `tradeable`          | string  | no        | Estado de negociabilidad (`FUTURES_TRADABILITY_TRADABLE`, etc.).                             | `FUTURES_TRADABILITY_TRADABLE`       |
| `state`              | string  | no        | Estado operativo (`FUTURES_STATE_ACTIVE`, etc.).                                             | `FUTURES_STATE_ACTIVE`               |
| `open`               | number  | no        | Precio de apertura más reciente.                                                             | `6857.5`                             |
| `high`               | number  | no        | Máximo diario reportado.                                                                     | `6867`                               |
| `low`                | number  | no        | Mínimo diario reportado.                                                                     | `6854.25`                            |
| `volume`             | number  | no        | Volumen acumulado más reciente.                                                              | `57556`                              |
| `previousClose`      | number  | no        | Precio de cierre anterior.                                                                   | `6856.75`                            |
| `multiplier`         | number  | no        | Multiplicador de contrato (puede llegar como string).                                        | `5`                                  |
| `tickSize`           | number  | no        | Tamaño mínimo de tick (puede llegar como string).                                            | `0.25`                               |
| `initialMargin`      | number  | no        | Margen inicial requerido (USD) si el API lo provee.                                          | `12100`                              |
| `maintenanceMargin`  | number  | no        | Margen de mantenimiento estándar.                                                            | `11000`                              |
| `overnightMaintenance`| number | no        | Margen nocturno o extendido.                                                                 | `12500`                              |
| `listingDate`        | string  | no        | Fecha de listado del contrato (ISO normalizado).                                             | `2024-05-01T00:00:00.000Z`           |
| `expirationDate`     | string  | no        | Fecha de vencimiento (ISO).                                                                  | `2025-12-19T00:00:00.000Z`           |
| `settlementDate`     | string  | no        | Fecha de liquidación (ISO).                                                                  | `2025-12-19T00:00:00.000Z`           |
| `lastTradeDate`      | string  | no        | Último día de negociación (ISO).                                                             | `2025-12-19T00:00:00.000Z`           |
| `createdAt`          | string  | no        | Marca de tiempo de creación del registro.                                                    | `2024-05-01T00:00:00.000Z`           |
| `updatedAt`          | string  | no        | Última actualización conocida del fundamental.                                               | `2025-11-11T04:16:34.905Z`           |

> **Notas de derivación**: `normalizeFuturesFundamentals` acepta wrappers (`data`/`results`) y objetos simples, usa `normaliseSymbol` para forzar mayúsculas y convierte números de strings/bigints. Cuando falta `symbol` pero existe `instrumentId`, utiliza el `fallbackSymbol` proporcionado por el runner.

## 5) Variables, funciones y tipos clave

* **Productor**: `handleFundamentals` en `installFuturesRecorder` (`src/modules/futures/interceptor.ts`).
* **Tipos asociados**: `FUTURES_FUNDAMENTALS_HEADER` y filas `Partial<Record<string, string | number>>`.

## 6) Interacciones / Dependencias

* **Generado por**: `normalizeFuturesFundamentals` usando respuestas `marketdata/futures/fundamentals` (v1).
* **Consumidores**:
  * CLI/runner para mostrar márgenes y estado del contrato.
  * Herramientas de análisis que validan spreads y disponibilidad antes de lanzar estrategias.
* **Motivo**: centralizar atributos estáticos/semiestáticos necesarios para evaluar liquidez y requisitos de capital.

## 7) Entradas / Salidas esperadas

* **Entradas**: payloads JSON con arrays o wrappers de `data` donde cada entrada contiene campos de fundamentals.
* **Salidas**: filas CSV con valores normalizados; pueden repetirse símbolos cuando el feed entrega actualizaciones sucesivas.

## 8) Errores y logging

* Filas sin identificadores (`symbol`, `instrumentId`, `productId`) se descartan silenciosamente.
* Cualquier excepción de escritura se reporta por `console.warn('[futures-recorder] ...')` pero no detiene el resto de streams.

## 9) Configuración (env vars/flags)

* No usa flags específicos; depende de `dataPath` para construir rutas (respeta `DATA_ROOT` global si aplica).

## 10) Uso & ejemplos

```csv
symbol,instrumentId,productId,rootSymbol,contractType,tradeable,state,open,high,low,volume,previousClose,multiplier,tickSize,initialMargin,maintenanceMargin,overnightMaintenance,listingDate,expirationDate,settlementDate,lastTradeDate,createdAt,updatedAt
MESZ25,C4021DC3-BC5C-4252-A5B9-209572A1CB78,,,,,,6857.5,6867,6854.25,57556,6856.75,,,,,,,,,,,
```

* Ejemplo de inspección en Node.js:
  ```ts
  import { readFileSync } from 'node:fs';
  import { parse } from 'csv-parse/sync';
  const rows = parse(readFileSync('data/futures/MESZ25/2025-11-11/fundamentals/futures-fundamentals.csv'), { columns: true });
  console.log(rows[0].symbol, rows[0].expirationDate);
  ```

## 11) Tests y validación

* `tests/futures-interceptor.test.ts` valida conversión de números, normalización de símbolos y extracción de márgenes/fechas.
* Validación manual: comparar con la ficha de contratos (`futures-contracts.csv`) para verificar coherencia de `productId` y fechas.

## 12) Rendimiento

* Streaming continuo vía `getCsvWriter`; evita reabrir el archivo por cada payload.
* Sólo se generan filas cuando hay datos suficientes, minimizando escrituras redundantes.

## 13) Seguridad

* Contiene datos públicos; aun así, los identificadores se sanitizan via `dataPath`.
* No persiste información personal ni sensible.

## 14) Ejemplos cruzados

* Se complementa con `docs/data-debug_results-futures-contracts.csv.md` (si existe) y con `docs/src-modules-futures-interceptor.md`.
* Relacionado con `docs/data-debug_results-futures-snapshots.csv.md` para comparar estado actual vs. fundamentals.

## 15) Mantenimiento

* **Propietario**: Equipo Trading API
* **Última actualización**: `2025-11-11`
* **Checklist al cambiar**:
  * Actualizar la tabla de la sección 4 si `FUTURES_FUNDAMENTALS_HEADER` incorpora columnas nuevas.
  * Documentar unidades de nuevos campos (p.ej. márgenes adicionales).
  * Añadir casos en `tests/futures-interceptor.test.ts` cuando cambie la normalización.
