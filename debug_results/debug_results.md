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



PUNTO 38:

Buenísima esta, aquí ya estás sacando **fundamentales de SPY como ETF**, no precio ni greeks. Esto te va a alimentar el módulo de *stats/fundamentals* y de *composición de portafolio*.

Voy por partes como acordamos 👇

---

## 1. Clasificación rápida

* **Endpoint:**
  `GET https://bonfire.robinhood.com/instruments/{instrument_id}/etp-details/`
* **Transporte:** `http`
* **Dominio:** `etp_details` (fundamentales de ETF / ETP)
* **Instrumento:**

  * `instrument_id: "8f92e76f-1e0e-4478-8580-16a6ffcfaef5"`
  * `symbol: "SPY"`

Este endpoint **NO es intradía**, es más bien “semilento”: AUM, yield, performance a 1Y/3Y/5Y/10Y, sectores, holdings.

---

## 2. Schema del payload crudo

Te lo dejo en TypeScript para que lo copies casi tal cual:

```ts
type EtpPerformanceBucket = {
  "1Y": string;             // ej "21.398170"
  "3Y": string;
  "5Y": string;
  "10Y": string;
  since_inception: string;
};

type EtpDetailsResponse = {
  instrument_id: string;     // id del ETF (SPY)
  symbol: string;            // "SPY"

  is_inverse: boolean;
  is_leveraged: boolean;
  is_volatility_linked: boolean;
  is_crypto_futures: boolean;

  aum: string;               // "702972487683.000000" (USD)
  sec_yield: string;         // "1.030000" (% anualizada)
  gross_expense_ratio: string;// "0.094500" (%)

  documents: {
    prospectus?: string;     // URL del prospectus
    [k: string]: string | undefined;
  };

  quarter_end_date: string;  // "2025-09-30"
  quarter_end_performance: {
    market: EtpPerformanceBucket;
    nav: EtpPerformanceBucket;
  };

  month_end_date: string;    // "2025-10-31"
  month_end_performance: {
    market: EtpPerformanceBucket;
    nav: EtpPerformanceBucket;
  };

  inception_date: string;    // "1993-01-22"
  index_tracked: string;     // "S&P 500 TR USD"
  category: string;          // "Large Blend"
  total_holdings: number;    // 504
  is_actively_managed: boolean;
  broad_category_group: string; // "equity"

  sectors_portfolio_date: string; // "2025-11-10"
  sectors: Array<{
    name: string;          // "Technology"
    weight: string;        // "36.33" (%)
    description: string;
    color: {
      light: string;       // "hydro-light"
      dark: string;
    };
  }>;

  holdings_portfolio_date: string; // "2025-11-10"
  holdings: Array<{
    name: string;          // "NVIDIA"
    instrument_id: string; // del holding
    symbol: string;        // "NVDA"
    weight: string;        // "8.33" (%)
    sector: string;        // "Technology"
    description: string;   // texto largo
    color: {
      light: string;
      dark: string;
    };
  }>;

  show_holdings_visualization: boolean; // true
};
```

Wrapper en tu Envelope:

```ts
type EtpDetailsEnvelope = Envelope & {
  instrument_id: string;
  symbol: string;
  payload: EtpDetailsResponse;
};
```

---

## 3. Cómo recibirlo (handler)

```ts
async function fetchEtpDetails(
  client: HttpClient,
  instrumentId: string,
  symbol: string
): Promise<EtpDetailsEnvelope> {
  const url = `https://bonfire.robinhood.com/instruments/${instrumentId}/etp-details/`;
  const text = await client.getText(url);
  const payload = safeJsonParse<EtpDetailsResponse>(text);

  return {
    ts: Date.now(),
    transport: 'http',
    source: url,
    topic: 'etp_details',
    symbol,
    payload,
    // opcional:
    // @ts-ignore
    instrument_id: payload.instrument_id ?? instrumentId,
  };
}
```

---

## 4. Normalización: qué tablas/archivos salen de aquí

De este endpoint salen **4 piezas de información distintas**, con “granularidad” diferente:

1. Info “maestra” del ETF (estática/lenta): AUM, yield, gastos, categoría, índice.
2. Performance agregada (1Y/3Y/5Y/10Y/since), por `market` y `nav`, y por corte `quarter_end` y `month_end`.
3. Sector breakdown (% por sector).
4. Holdings (composición por activo).

Para que tu trade_api sea ordenado, yo lo separaría en **4 CSVs** bajo `data/meta/`:

* `data/meta/etp_master.csv`
* `data/meta/etp_performance.csv`
* `data/meta/etp_sectors.csv`
* `data/meta/etp_holdings.csv`

### 4.1. Tabla 1 – ETP master (etp_master.csv)

**Granularidad:** 1 fila por `instrument_id` (por ejemplo SPY), con timestamp de captura.

```ts
type EtpMasterRow = {
  instrument_id: string;
  symbol: string;

  is_inverse: boolean;
  is_leveraged: boolean;
  is_volatility_linked: boolean;
  is_crypto_futures: boolean;

  aum_usd: number;                // Number(payload.aum)
  sec_yield_pct: number;          // Number(sec_yield)
  gross_expense_ratio_pct: number;// Number(gross_expense_ratio)

  prospectus_url: string | null;

  inception_date: string;         // "YYYY-MM-DD"
  index_tracked: string;
  category: string;
  total_holdings: number;
  is_actively_managed: boolean;
  broad_category_group: string;

  sectors_portfolio_date: string;
  holdings_portfolio_date: string;

  show_holdings_visualization: boolean;

  fetched_ts: number;
  source_transport: 'http';
  source_url: string;
};
```

Normalizador:

```ts
const toNum = (s: string | null | undefined): number | null =>
  s != null ? Number(s) : null;

function normaliseEtpMaster(env: EtpDetailsEnvelope): EtpMasterRow {
  const p = env.payload;

  return {
    instrument_id: p.instrument_id,
    symbol: p.symbol,

    is_inverse: p.is_inverse,
    is_leveraged: p.is_leveraged,
    is_volatility_linked: p.is_volatility_linked,
    is_crypto_futures: p.is_crypto_futures,

    aum_usd: toNum(p.aum) ?? 0,
    sec_yield_pct: toNum(p.sec_yield) ?? 0,
    gross_expense_ratio_pct: toNum(p.gross_expense_ratio) ?? 0,

    prospectus_url: p.documents?.prospectus ?? null,

    inception_date: p.inception_date,
    index_tracked: p.index_tracked,
    category: p.category,
    total_holdings: p.total_holdings,
    is_actively_managed: p.is_actively_managed,
    broad_category_group: p.broad_category_group,

    sectors_portfolio_date: p.sectors_portfolio_date,
    holdings_portfolio_date: p.holdings_portfolio_date,

    show_holdings_visualization: p.show_holdings_visualization,

    fetched_ts: env.ts,
    source_transport: env.transport,
    source_url: env.source,
  };
}
```

**Archivo:** `data/meta/etp_master.csv`
**PK lógica:** `instrument_id` (upsert, te quedas con el último `fetched_ts`).

---

### 4.2. Tabla 2 – Performance (etp_performance.csv)

En el payload vienen **dos bloques**:

* `quarter_end_performance` con fecha `quarter_end_date`
* `month_end_performance` con fecha `month_end_date`

Cada bloque tiene:

* `market: {1Y,3Y,5Y,10Y,since_inception}`
* `nav: {…}`

Yo lo normalizaría en formato **“largo/tidy”**:
**Una fila por combinación:**

* `instrument_id`
* `symbol`
* `as_of_date` (quarter_end_date o month_end_date)
* `period` ∈ {`"1Y","3Y","5Y","10Y","since_inception"`}
* `basis` ∈ {`"market","nav"`}
* `time_scope` ∈ {`"quarter_end","month_end"`}
* `return_pct` (número)

```ts
type EtpPerformanceRow = {
  instrument_id: string;
  symbol: string;
  as_of_date: string;     // "YYYY-MM-DD"
  time_scope: 'quarter_end' | 'month_end';
  basis: 'market' | 'nav';// NAV vs market price
  period: '1Y' | '3Y' | '5Y' | '10Y' | 'since_inception';
  return_pct: number;     // ej 21.39817
  fetched_ts: number;
  source_url: string;
};
```

Helper para “desenrollar” un bucket:

```ts
function explodePerf(
  instrument_id: string,
  symbol: string,
  as_of_date: string,
  time_scope: 'quarter_end' | 'month_end',
  basis: 'market' | 'nav',
  bucket: EtpPerformanceBucket,
  fetched_ts: number,
  source_url: string
): EtpPerformanceRow[] {
  const entries: Array<[EtpPerformanceRow['period'], string]> = [
    ['1Y', bucket["1Y"]],
    ['3Y', bucket["3Y"]],
    ['5Y', bucket["5Y"]],
    ['10Y', bucket["10Y"]],
    ['since_inception', bucket.since_inception],
  ];

  return entries.map(([period, val]) => ({
    instrument_id,
    symbol,
    as_of_date,
    time_scope,
    basis,
    period,
    return_pct: Number(val),
    fetched_ts,
    source_url,
  }));
}
```

Y luego:

```ts
function normaliseEtpPerformance(env: EtpDetailsEnvelope): EtpPerformanceRow[] {
  const p = env.payload;
  const rows: EtpPerformanceRow[] = [];

  rows.push(
    ...explodePerf(
      p.instrument_id, p.symbol,
      p.quarter_end_date, 'quarter_end', 'market',
      p.quarter_end_performance.market,
      env.ts, env.source
    ),
    ...explodePerf(
      p.instrument_id, p.symbol,
      p.quarter_end_date, 'quarter_end', 'nav',
      p.quarter_end_performance.nav,
      env.ts, env.source
    ),
    ...explodePerf(
      p.instrument_id, p.symbol,
      p.month_end_date, 'month_end', 'market',
      p.month_end_performance.market,
      env.ts, env.source
    ),
    ...explodePerf(
      p.instrument_id, p.symbol,
      p.month_end_date, 'month_end', 'nav',
      p.month_end_performance.nav,
      env.ts, env.source
    ),
  );

  return rows;
}
```

**Archivo:** `data/meta/etp_performance.csv`

Encabezado sugerido:

```csv
instrument_id,symbol,as_of_date,time_scope,basis,period,return_pct,fetched_ts,source_url
```

---

### 4.3. Tabla 3 – Sectores (etp_sectors.csv)

**Granularidad:** 1 fila por sector del ETF y fecha de cartera de sectores.

```ts
type EtpSectorRow = {
  instrument_id: string;
  symbol: string;
  as_of_date: string;       // sectors_portfolio_date

  sector_name: string;      // "Technology"
  weight_pct: number;       // 36.33
  description: string;      // texto que puedes truncar si quieres
  color_light: string;
  color_dark: string;

  fetched_ts: number;
  source_url: string;
};
```

Normalizador:

```ts
function normaliseEtpSectors(env: EtpDetailsEnvelope): EtpSectorRow[] {
  const p = env.payload;
  return p.sectors.map(s => ({
    instrument_id: p.instrument_id,
    symbol: p.symbol,
    as_of_date: p.sectors_portfolio_date,
    sector_name: s.name,
    weight_pct: Number(s.weight),
    description: s.description,
    color_light: s.color.light,
    color_dark: s.color.dark,
    fetched_ts: env.ts,
    source_url: env.source,
  }));
}
```

**Archivo:** `data/meta/etp_sectors.csv`

Encabezado:

```csv
instrument_id,symbol,as_of_date,sector_name,weight_pct,description,color_light,color_dark,fetched_ts,source_url
```

---

### 4.4. Tabla 4 – Holdings (etp_holdings.csv)

**Granularidad:** 1 fila por holding (por ejemplo, NVDA dentro de SPY) y fecha de cartera de holdings.

Ojo: la descripción es enorme, quizá quieras:

* Guardar solo **top N holdings** (top 10) o
* Guardar la descripción truncada a X caracteres (ej 512).

```ts
type EtpHoldingRow = {
  etp_instrument_id: string;   // SPY
  etp_symbol: string;          // "SPY"

  as_of_date: string;          // holdings_portfolio_date

  holding_instrument_id: string;
  holding_symbol: string;
  holding_name: string;
  holding_sector: string;
  weight_pct: number;

  // optional: descripción truncada 
  description: string;

  color_light: string;
  color_dark: string;

  fetched_ts: number;
  source_url: string;
};
```

Normalizador:

```ts
function normaliseEtpHoldings(
  env: EtpDetailsEnvelope,
  opts?: { maxHoldings?: number; truncateDescriptionAt?: number }
): EtpHoldingRow[] {
  const p = env.payload;
  const maxHoldings = opts?.maxHoldings ?? Infinity;
  const truncateAt = opts?.truncateDescriptionAt ?? 512;

  return p.holdings.slice(0, maxHoldings).map(h => ({
    etp_instrument_id: p.instrument_id,
    etp_symbol: p.symbol,
    as_of_date: p.holdings_portfolio_date,
    holding_instrument_id: h.instrument_id,
    holding_symbol: h.symbol,
    holding_name: h.name,
    holding_sector: h.sector,
    weight_pct: Number(h.weight),
    description: h.description.length > truncateAt
      ? h.description.slice(0, truncateAt) + '…'
      : h.description,
    color_light: h.color.light,
    color_dark: h.color.dark,
    fetched_ts: env.ts,
    source_url: env.source,
  }));
}
```

**Archivo:** `data/meta/etp_holdings.csv`

Encabezado:

```csv
etp_instrument_id,etp_symbol,as_of_date,holding_instrument_id,holding_symbol,holding_name,holding_sector,weight_pct,description,color_light,color_dark,fetched_ts,source_url
```

---

## 5. ¿Se guarda o no?

### EtpMaster (info general)

✅ **Sí, siempre.** Es tu “ficha técnica” del ETF:

* AUM, yield, expense ratio, categoría,
* Si es inverso, leveraged, volatilidad,
* Indice que sigue.

### Performance

✅ **Sí, altamente recomendado.**
Te sirve para:

* Mostrar métricas de rendimiento en tu módulo,
* Comparar ETFs en algún screener,
* Hacer filtros (ej. “solo ETFs con >15% 3Y nav”).

### Sectores

✅ **Sí.**
Te da la radiografía sectorial, útil para:

* Ver exposición del portafolio total por sector,
* Construir dashboards (pasteles, barras).

### Holdings

✅ **Sí**, pero puedes limitar:

* Guardar todo, o
* Guardar top 10–20 por ETF para no inflar demasiado los archivos.

---

## 6. Cómo encaja este módulo en tu trade_api

Este endpoint pertenece claramente al módulo de **fundamentales/ETF**:

* `etp_master` → ficha de SPY.
* `etp_performance` → stats de rendimiento medio/largo plazo para SPY.
* `etp_sectors` → exposición sectorial de SPY.
* `etp_holdings` → top posiciones.

Luego otros módulos consumen esto:

* **Módulo de “stats del día” de SPY:**

  * Puede mostrar AUM, expense ratio, yield junto con el precio actual.
* **Módulo de gestión de riesgo a nivel portafolio:**

  * Usa `etp_sectors` y `etp_holdings` para ver cuánto tienes en Tech, etc.
* **Screener / ranking de ETFs:**

  * Usa `etp_performance` para ordenar por mejores 3Y, 5Y, etc.

---

## 7. Resumen corto

Para `GET bonfire.robinhood.com/.../etp-details/`:

1. **Recibir** → `EtpDetailsEnvelope` (`topic='etp_details'`).
2. **Procesar** en 4 sets de filas:

   * `EtpMasterRow` → `data/meta/etp_master.csv`
   * `EtpPerformanceRow[]` → `data/meta/etp_performance.csv`
   * `EtpSectorRow[]` → `data/meta/etp_sectors.csv`
   * `EtpHoldingRow[]` → `data/meta/etp_holdings.csv`
3. **Guardar siempre**, con `upsert` por `instrument_id` en master y append en las otras (eventualmente deduplicando por `instrument_id + as_of_date + sector/holding/period/basis`).

---