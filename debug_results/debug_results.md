bien. para los futures, el directorio tiene que ser:
data/
data/futures/
data/futures/<NOMBRE_DEL_FUTURE>/
data/futures/<NOMBRE_DEL_FUTURE>/<fechas_salvadas>
data/futures/<NOMBRE_DEL_FUTURE>/<fechas_salvadas>


directorio para stock:
data/
data/stocks/
data/stocks/<NOMBRE_DEL_STOCK>/
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>/ (datos de las temporalidades, noticias y las greek)
.............
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>/options/  (datos de los strike)
data/stocks/<NOMBRE_DEL_STOCK>/<fecha>/options/in_the_future/<fecha>/  (datos de los proximos dias de expiracion, 2 semanas adelante)



PUNTO 25:
¡Voy! Esta **petición** es de **históricos de futuros por contrato** (barras **5-min**):

```
GET /marketdata/futures/historicals/contracts/v1
  ?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78
  &interval=5minute
  &start=2025-11-11T05:00:00.000Z
```

---

# 1) Estructura de la data (schema)

### A. Raw (HTTP JSON)

```ts
type FuturesHistoricalsRaw = {
  status: 'SUCCESS' | string;
  data: Array<{
    status: 'SUCCESS' | string;
    data: {
      start_time: string;                // ISO UTC (inicio del rango servido)
      end_time: string;                  // ISO UTC (fin del rango servido)
      interval: '5minute' | '15minute' | 'hour' | 'day';
      data_points: Array<{
        begins_at: string;               // ISO UTC: apertura de la barra
        open_price: string;              // número en string
        close_price: string;
        high_price: string;
        low_price: string;
        volume: number;
        interpolated: boolean;           // true si es barra llenada (p.ej. pausa)
        is_market_open: boolean;         // abierto según RH
        contract_id: string;             // UUID del contrato
      }>;
      symbol: string;                    // '/MESZ25:XCME'
      instrument_id: string;            // = contract_id
    }
  }>
}
```

### B. Registro normalizado (una fila por barra)

```ts
type FuturesBar5mRow = {
  ts: number;                            // epoch ms de ingestión
  contract_id: string;                   // 'c4021d...'
  symbol: string;                        // '/MESZ25:XCME'
  interval: '5m';

  // tiempo de la barra
  t_start_iso: string;                   // begins_at original (UTC)
  t_start: number;                       // epoch ms (UTC)
  t_end: number;                         // t_start + 5*60*1000
  trading_date: string;                  // sesión por horario CME (NY): ver abajo

  // OHLCV
  o: number; h: number; l: number; c: number; v: number;

  // flags
  interpolated: 0 | 1;
  is_market_open: 0 | 1;

  // derivados inmediatos
  hl2: number;                           // (h + l)/2
  ohlc4: number;                         // (o+h+l+c)/4
  change: number;                        // c - o
  change_pct: number;                    // (c/o - 1)
  range: number;                         // h - l

  // housekeeping
  source_url: string;
};
```

> **`trading_date` (clave)**: asigna la barra a la **sesión CME** del día **NY**:
> sesión regular /MES ≈ **23:00–22:00 ET**. Para cada `t_start` en UTC ⇒ convértelo a **America/New_York** y mapea a la fecha de la sesión activa (usa el calendario que ya definimos con el endpoint de *trading_sessions*).

---

# 2) Cómo recibirla

* **Handler**: HTTP (pull).
* **Headers**: como los que ya usas (con `authorization`, `x-timezone-id` opcional).
* **Parsing**: `response.text()` → `safeJsonParse` → valida `status==='SUCCESS'`.
* **Envelope**:

```ts
const env: Envelope = {
  ts: Date.now(),
  transport: 'http',
  source: '.../marketdata/futures/historicals/contracts/v1?...',
  topic: 'futures.historicals',
  symbol: '/MESZ25:XCME',
  payload: json
};
```

---

# 3) Cómo procesarla

### A. Validaciones

* `data[].data.interval === '5minute'`.
* `symbol` y `instrument_id` presentes y consistentes con el `ids` solicitado.
* `data_points` no vacío.
* Para cada barra: `open<=high`, `low<=high`, `low<=open/close`, numéricos finitos.
* Si `interpolated===true` ⇒ normalmente `volume===0` y `is_market_open===false` (permite excepciones pero márcalo).

### B. Normalización

* Convierte **precios** a `number` (float) y **tiempos** a `epoch ms` (UTC).
* Calcula `t_end = t_start + 5min`.
* Derivados: `hl2`, `ohlc4`, `change`, `change_pct`, `range`.
* **Trading date**:

  1. Convierte `t_start` a **NY**.
  2. Usa la tabla de sesiones (que ingieres del otro endpoint) para asignar `trading_date` (la que cubre el tramo `t_start..t_end`).
  3. Si cae en un bloque `NO_TRADING`, igualmente conserva la fila pero con `interpolated=1` (si vino así) o `is_market_open=0`.

### C. Reglas de calidad / filtros

* **Mantener** barras `interpolated` para continuidad temporal (facilita indicadores); **marca** `interpolated=1`.
* Si quieres una vista “operable”: puedes generar un **vista secundaria** filtrando `is_market_open=1 && v>0`.
* **Deduplicación idempotente** por `(contract_id, t_start)`.

### D. Agregados opcionales (útil para analítica)

* **VWAP intrasesión** (acumulado por `trading_date`):

  * `cum_pv += c * v`, `cum_v += v`, `vwap = cum_pv / max(1,cum_v)`.
* **Indicadores livianos** (si te conviene en una salida aparte):

  * `ema_20`, `rsi_14`, `atr_14` (sobre `c` y `h/l`).
    *Recomiendo calcularlos en un job separado para no mezclar ingestión con cálculo pesado.*

---

# 4) ¿Se guarda? Sí, y en dos vistas

### A. **Serie base 5m (todas las barras) – append**

```
data/futures/bars_5m/<CONTRACT_ID>/<YYYY>/<MM>/<TRADING_DATE>.csv
```

*Una carpeta por `contract_id` para evitar problemas con símbolos con `/` o `:`.*

**Columnas (`bars_5m`)**

```
ts,contract_id,symbol,interval,t_start_iso,t_start,t_end,trading_date,
o,h,l,c,v,interpolated,is_market_open,hl2,ohlc4,change,change_pct,range,source_url
```

### B. **Vista “operable” (solo abierto y con volumen) – append**

```
data/futures/bars_5m_live/<CONTRACT_ID>/<YYYY>/<MM>/<TRADING_DATE>.csv
```

**Columnas**: mismas que arriba **sin** `interpolated=1` y `v=0`.

### C. **Crudo opcional** (auditoría)

```
data/_raw/futures_historicals/<CONTRACT_ID>/<YYYY-MM-DDTHH-mm-ssZ>.json
```

*(redacta tokens/headers; guarda únicamente cuerpo y URL).*

### D. Reescritura / idempotencia

* Al reingestar el mismo rango, reescribe el archivo de ese `TRADING_DATE` **o** deduplica por `(contract_id,t_start)` antes de `append`.

---

# 5) Pseudocódigo de normalización (TypeScript)

```ts
function parseNum(s: string | number): number {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function toEpoch(iso: string): number { return Date.parse(iso); }

function tradingDateFromUTC(isoUTC: string): string {
  // 1) a NY; 2) mapear a sesión (23:00–22:00 ET) usando tu tabla de sessions
  // fallback: si cae 22:00–23:00 ET => asigna al día siguiente
  return resolveTradingDateBySessions(isoUTC, 'America/New_York');
}

function normaliseFutures5m(env: Envelope): FuturesBar5mRow[] {
  const out: FuturesBar5mRow[] = [];
  const payload = env.payload as FuturesHistoricalsRaw;
  for (const block of payload.data ?? []) {
    const d = block.data;
    const symbol = d.symbol;
    const contract_id = d.instrument_id;
    for (const p of d.data_points) {
      const tStart = toEpoch(p.begins_at);
      const o = parseNum(p.open_price);
      const h = parseNum(p.high_price);
      const l = parseNum(p.low_price);
      const c = parseNum(p.close_price);
      const v = p.volume ?? 0;

      if (![o,h,l,c].every(Number.isFinite)) continue; // descarta corruptas

      const row: FuturesBar5mRow = {
        ts: env.ts,
        contract_id,
        symbol,
        interval: '5m',
        t_start_iso: p.begins_at,
        t_start: tStart,
        t_end: tStart + 5 * 60 * 1000,
        trading_date: tradingDateFromUTC(p.begins_at),

        o, h, l, c, v,
        interpolated: p.interpolated ? 1 : 0,
        is_market_open: p.is_market_open ? 1 : 0,

        hl2: (h + l) / 2,
        ohlc4: (o + h + l + c) / 4,
        change: c - o,
        change_pct: o ? (c / o - 1) : 0,
        range: h - l,

        source_url: env.source
      };
      out.push(row);
    }
  }
  // dedup por (contract_id,t_start)
  return dedupBy(out, r => `${r.contract_id}-${r.t_start}`);
}
```

---

# 6) Procesamiento recomendado (pipeline)

1. **Ingesta HTTP** → Envelope.
2. **Normalización** → `rows_5m`.
3. **Split por `trading_date`** (según sesiones NY) y **append** en
   `bars_5m/<CONTRACT_ID>/<YYYY>/<MM>/<TRADING_DATE>.csv`.
4. **Genera vista operable** filtrando `is_market_open=1 && v>0`.
5. (Opcional) **Job de indicadores** por sesión: `vwap`, `ema_20`, `rsi_14`, etc., a
   `data/futures/indicators_5m/<CONTRACT_ID>/<YYYY>/<MM>/<TRADING_DATE>.csv`.
6. **Logs**: cuenta de barras totales, interpoladas, y descartadas por validación.

---

# 7) Decisiones clave

* **Guardar siempre** estas barras (base de backtests/scalping y señales).
* **Conservar “interpolated”** (0 volumen) para continuidad y detección de pausas; usar la **vista operable** para trading real.
* **Particionar por `contract_id`** (UUID) para evitar problemas con `/` o `:` del símbolo.
* **`trading_date` session-aware** (coincidirá con los horarios que ya definiste con el endpoint de *trading_sessions*).

---