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



PUNTO 37:
Nice, ahora sí estamos entrando al corazón de la “metadata” del instrumento 🔧

Esta petición es **clave** porque es la que te da el **instrument_id** de SPY y todo lo que Robinhood sabe está referenciado a ese `id`.

---

## 1. Clasificación rápida

* **Endpoint:** `GET /instruments/?active_instruments_only=false&symbol=SPY`
* **Transporte:** `http`
* **Dominio:** `instrument_metadata`
* **Cardinalidad:** `results[]` (en este caso 1 solo instrumento)
* **Uso principal en tu proyecto:**

  * Resolver `symbol → instrument_id`.
  * Saber si se puede operar (tradable, shortable, fractional, extended, etc).
  * Saber en qué **market** está (para encajar con `/markets/.../hours/...`).
  * Parametrizar riesgo: márgenes, day_trade_ratio, etc.

⚠️ Nota rápida de seguridad: no vuelvas a compartir tokens `Bearer` reales en texto plano (como el de este fetch); en tu código real deben ir en config segura / variables de entorno.

---

## 2. Esquema de la respuesta (schema crudo)

La respuesta:

```json
{
  "next": null,
  "previous": null,
  "results": [ { ...instrumento... } ]
}
```

Schema del objeto en `results[0]`:

```ts
type InstrumentResponse = {
  id: string;                 // "8f92e76f-1e0e-4478-8580-16a6ffcfaef5"
  url: string;                // https://api.robinhood.com/instruments/<id>/
  quote: string;              // https://api.robinhood.com/quotes/SPY/
  fundamentals: string;       // https://api.robinhood.com/fundamentals/SPY/
  splits: string;             // https://api.robinhood.com/instruments/<id>/splits/
  state: 'active' | string;   // estado del instrumento

  market: string;             // url de market, ej: https://api.robinhood.com/markets/ARCX/
  simple_name: string | null; // "SPDR S&P 500 ETF"
  name: string | null;        // "SPDR S&P 500 ETF Trust"
  tradeable: boolean;
  tradability: string;        // "tradable" | "untradable" | etc.

  symbol: string;             // "SPY"
  bloomberg_unique: string | null;

  margin_initial_ratio: string;   // "0.5000"
  maintenance_ratio: string;      // "0.2500"
  country: string;                // "US"
  day_trade_ratio: string;        // "0.2500"
  list_date: string | null;       // "1993-01-29"
  min_tick_size: string | null;

  type: string;                   // "etp" (ETF)
  tradable_chain_id: string | null;

  rhs_tradability: string;
  affiliate_tradability: string;
  fractional_tradability: string; // "tradable" / "untradable"
  short_selling_tradability: string;

  default_collar_fraction: string; // "0.05"

  ipo_access_status: string | null;
  ipo_access_cob_deadline: string | null;
  ipo_s1_url: string | null;
  ipo_roadshow_url: string | null;

  is_spac: boolean;
  is_test: boolean;
  ipo_access_supports_dsp: boolean;

  extended_hours_fractional_tradability: boolean;

  internal_halt_reason: string;
  internal_halt_details: string;
  internal_halt_sessions: string | null;
  internal_halt_start_time: string | null;
  internal_halt_end_time: string | null;
  internal_halt_source: string;

  all_day_tradability: string;

  notional_estimated_quantity_decimals: number;
  tax_security_type: string;     // "etf"
  reserved_buying_power_percent_queued: string;    // "0.10000000"
  reserved_buying_power_percent_immediate: string; // "0.05000000"
  otc_market_tier: string;
  car_required: boolean;
  high_risk_maintenance_ratio: string;
  low_risk_maintenance_ratio: string;
  default_preset_percent_limit: string;            // "0.02"
  affiliate: string;                               // "rhf"

  account_type_tradabilities: Array<{
    account_type: string;               // "individual"
    account_type_tradability: string;   // "tradable"
  }>;

  issuer_type: string;                  // "third_party"
};
```

Wrapper de la página:

```ts
type InstrumentsPage = {
  next: string | null;
  previous: string | null;
  results: InstrumentResponse[];
};
```

---

## 3. Cómo recibirla (Envelope)

Reutilizando tu envoltura estándar:

```ts
type InstrumentEnvelope = Envelope & {
  symbol: string;   // "SPY" (del query, lo pones tú)
};
```

Handler:

```ts
async function fetchInstrumentBySymbol(
  client: HttpClient,
  symbol: string
): Promise<InstrumentEnvelope> {
  const url = `https://api.robinhood.com/instruments/?active_instruments_only=false&symbol=${encodeURIComponent(symbol)}`;
  const text = await client.getText(url);
  const page = safeJsonParse<InstrumentsPage>(text);

  if (!page.results.length) {
    throw new Error(`Instrument not found for symbol=${symbol}`);
  }

  return {
    ts: Date.now(),
    transport: 'http',
    source: url,
    topic: 'instrument',
    symbol,
    payload: page,
  };
}
```

---

## 4. Normalización: fila plana para tu “catálogo de instrumentos”

Aquí sí tiene sentido guardar en una tabla **global de referencia**, porque:

* `instrument_id` lo usarán muchos otros módulos,
* los campos (ratios, tradability, etc.) cambian muy poco.

### 4.1. Row normalizado

```ts
type InstrumentRow = {
  instrument_id: string;   // id
  symbol: string;          // "SPY"
  market_url: string;      // https://api.robinhood.com/markets/ARCX/
  type: string;            // "etp"
  tax_security_type: string; // "etf"

  state: string;           // "active"
  tradeable: boolean;
  tradability: string;
  rhs_tradability: string;
  affiliate_tradability: string;
  fractional_tradability: string;
  short_selling_tradability: string;
  all_day_tradability: string;

  simple_name: string | null;
  name: string | null;
  country: string;
  list_date: string | null;    // YYYY-MM-DD

  margin_initial_ratio: number;         // 0.5
  maintenance_ratio: number;           // 0.25
  high_risk_maintenance_ratio: number; // 0.25
  low_risk_maintenance_ratio: number;  // 0.25
  day_trade_ratio: number;             // 0.25

  default_collar_fraction: number;           // 0.05
  default_preset_percent_limit: number;      // 0.02
  reserved_bp_percent_queued: number;        // 0.1
  reserved_bp_percent_immediate: number;     // 0.05

  extended_hours_fractional_tradability: boolean;

  is_spac: boolean;
  is_test: boolean;
  issuer_type: string;       // "third_party"
  affiliate: string;         // "rhf"

  notional_qty_decimals: number;
  min_tick_size: number | null;

  bloomberg_unique: string | null;
  otc_market_tier: string;

  // info de halts internos
  internal_halt_reason: string;
  internal_halt_details: string;
  internal_halt_sessions: string | null;
  internal_halt_start_time: string | null;
  internal_halt_end_time: string | null;
  internal_halt_source: string;

  account_type_tradabilities_json: string; // JSON string para no complicarte

  fetched_ts: number;
  source_transport: 'http';
  source_url: string;
};
```

Helper para convertir strings numéricas:

```ts
const toNum = (s: string | null | undefined): number | null =>
  s != null ? Number(s) : null;
```

Normalizador:

```ts
function normaliseInstrument(env: InstrumentEnvelope): InstrumentRow {
  const page = env.payload as InstrumentsPage;
  const i = page.results[0];

  return {
    instrument_id: i.id,
    symbol: i.symbol,
    market_url: i.market,
    type: i.type,
    tax_security_type: i.tax_security_type,

    state: i.state,
    tradeable: i.tradeable,
    tradability: i.tradability,
    rhs_tradability: i.rhs_tradability,
    affiliate_tradability: i.affiliate_tradability,
    fractional_tradability: i.fractional_tradability,
    short_selling_tradability: i.short_selling_tradability,
    all_day_tradability: i.all_day_tradability,

    simple_name: i.simple_name,
    name: i.name,
    country: i.country,
    list_date: i.list_date,

    margin_initial_ratio: toNum(i.margin_initial_ratio) ?? 0,
    maintenance_ratio: toNum(i.maintenance_ratio) ?? 0,
    high_risk_maintenance_ratio: toNum(i.high_risk_maintenance_ratio) ?? 0,
    low_risk_maintenance_ratio: toNum(i.low_risk_maintenance_ratio) ?? 0,
    day_trade_ratio: toNum(i.day_trade_ratio) ?? 0,

    default_collar_fraction: toNum(i.default_collar_fraction) ?? 0,
    default_preset_percent_limit: toNum(i.default_preset_percent_limit) ?? 0,
    reserved_bp_percent_queued: toNum(i.reserved_buying_power_percent_queued) ?? 0,
    reserved_bp_percent_immediate: toNum(i.reserved_buying_power_percent_immediate) ?? 0,

    extended_hours_fractional_tradability: i.extended_hours_fractional_tradability,

    is_spac: i.is_spac,
    is_test: i.is_test,
    issuer_type: i.issuer_type,
    affiliate: i.affiliate,

    notional_qty_decimals: i.notional_estimated_quantity_decimals,
    min_tick_size: toNum(i.min_tick_size),

    bloomberg_unique: i.bloomberg_unique,
    otc_market_tier: i.otc_market_tier,

    internal_halt_reason: i.internal_halt_reason,
    internal_halt_details: i.internal_halt_details,
    internal_halt_sessions: i.internal_halt_sessions,
    internal_halt_start_time: i.internal_halt_start_time,
    internal_halt_end_time: i.internal_halt_end_time,
    internal_halt_source: i.internal_halt_source,

    account_type_tradabilities_json: JSON.stringify(i.account_type_tradabilities ?? []),

    fetched_ts: env.ts,
    source_transport: env.transport,
    source_url: env.source,
  };
}
```

---

## 5. ¿Se guarda o no? y ¿cómo? 📦

### ¿Conviene guardar?

**Sí, 100%.** Este endpoint es:

* La **tabla de dimensiones / catálogo de instrumentos**.
* Poco volumen (tienes miles de símbolos como mucho; esto es muy pequeño comparado con ticks).
* Referencia central para saber:

  * El `instrument_id` que otros endpoints usan,
  * Parámetros de margen / riesgo,
  * Si se permite short, fractional, extended, etc.

### Dónde y formato

Yo lo metería en algo así como:

* Carpeta de metadatos:

  ```text
  data/meta/instruments.csv
  ```

* Una sola tabla para **todos los símbolos**.

Encabezado sugerido:

```csv
instrument_id,symbol,market_url,type,tax_security_type,state,tradeable,tradability,rhs_tradability,affiliate_tradability,fractional_tradability,short_selling_tradability,all_day_tradability,simple_name,name,country,list_date,margin_initial_ratio,maintenance_ratio,high_risk_maintenance_ratio,low_risk_maintenance_ratio,day_trade_ratio,default_collar_fraction,default_preset_percent_limit,reserved_bp_percent_queued,reserved_bp_percent_immediate,extended_hours_fractional_tradability,is_spac,is_test,issuer_type,affiliate,notional_qty_decimals,min_tick_size,bloomberg_unique,otc_market_tier,internal_halt_reason,internal_halt_details,internal_halt_sessions,internal_halt_start_time,internal_halt_end_time,internal_halt_source,account_type_tradabilities_json,fetched_ts,source_transport,source_url
```

### Estrategia de escritura

* Si usas **CSV plano**:

  * Hacer **append** y luego un proceso de deduplicación (quedarte con el último `fetched_ts` por `instrument_id`).
* Si usas DB / SQLite:

  * Tabla `instruments` con:

    * PK: `instrument_id`,
    * Índice secundario: `symbol`,
    * `ON CONFLICT(instrument_id) DO UPDATE` para mantenerlo fresco.

---

## 6. Cómo lo usan otros módulos de tu trade_api

Este módulo de `instrument` se convierte en una especie de “DNS” de trading:

1. **Módulo de quotes / candles:**

   * Puede construir URLs usando `quote`, `fundamentals`, `market`.
   * Si en el futuro Robinhood te exige `instrument_id` en algún endpoint específico, ya lo tienes.

2. **Módulo de opciones / greeks:**

   * Necesita saber si el subyacente:

     * Es shorteable,
     * Se puede operar en extended,
     * Tiene restricciones de margen altas (`high_risk_maintenance_ratio`).

3. **Módulo de risk / position sizing:**

   * Usa `margin_initial_ratio`, `maintenance_ratio`, `day_trade_ratio`.
   * `default_collar_fraction` y `default_preset_percent_limit` te pueden servir como **heurísticas** para sugerir stops/limits iniciales (opcional).

4. **Módulo de reglas de operación:**

   * Si `is_test` es true → ignorar en producción.
   * Si `state !== 'active'` o `tradeable === false` → no permitir señales ni órdenes.

5. **Integración con market hours:**

   * `market_url` te dice el mercado real (`ARCX`), que conectas con los endpoints de `/markets/{MIC}/hours/...`.

---

## 7. Resumen para esta petición

Para:
`GET /instruments/?active_instruments_only=false&symbol=SPY`

1. **Recibir:** HTTP → JSON → `InstrumentsPage`.
2. **Envolver:** `InstrumentEnvelope` con `topic='instrument'` y `symbol='SPY'`.
3. **Normalizar:** generar un `InstrumentRow`:

   * Convertir ratios string → `number`,
   * Aplanar info importante de tradability y margen,
   * Guardar `account_type_tradabilities` como JSON string.
4. **Guardar:**

   * En `data/meta/instruments.csv` (o tabla `instruments` en DB).
   * 1 fila por `instrument_id`, upsert por id.
5. **Uso práctico:** resolver symbol→id, parámetros de riesgo y compatibilidad de trading para SPY y resto de símbolos.

---