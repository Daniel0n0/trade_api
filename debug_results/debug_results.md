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



PUNTO 30:

¡Vamos! Armemos el **módulo de “Greeks & Stats” para SPY** (la vista tipo `robinhood.com/stocks/SPY`) con todo lo necesario para calcular griegas, IV metrics y estadísticas del subyacente, usando la petición que ya viste (horarios) y el resto de señales típicas de esa pantalla.

# Qué hará el módulo

* Mostrar **estado de mercado** (regular/extended/closed) y relojes.
* Ficha del subyacente (**precio, variación, Vol, ATR, RV**).
* **Greeks agregadas** por vencimiento y por strike (Delta/Gamma/Theta/Vega).
* **Smile de IV**, **IV Rank** e **IV Percentile** por tenor.
* Explorador de **0DTE / weekly** y mapas de exposición (Gamma/Theta).
* Señales rápidas (overpriced IV, contango/backwardation en term structure, skew).

---

# 1) Data sources (endpoints & campos)

### A. Horarios (ya observado)

**GET** `/markets/XASE/hours/{YYYY-MM-DD}/`
Campos clave:

* `is_open`, `opens_at`, `closes_at`, `extended_opens_at`, `extended_closes_at`
* `index_option_0dte_closes_at`, `index_option_non_0dte_closes_at`
* `index_options_extended_hours:{curb_opens_at, curb_closes_at}`

> Persistimos todo tal cual y derivamos `session` actual.

### B. Quote del subyacente (SPY)

**GET** `/marketdata/quotes/?symbols=SPY`
Campos esperados: `last_trade_price, previous_close, trading_halted, bid/ask, volume, updated_at`.

### C. OHLC histórico (para RV/ATR/RSI)

**GET** `/marketdata/historicals/SPY/?interval=5minute|day&span=...`
Campos: `begins_at, open_price, close_price, high_price, low_price, volume`.

### D. Fundamentals (si disponible)

**GET** `/fundamentals/?symbols=SPY`
Campos útiles: `market_cap, pe_ratio, dividend_yield, high_52_weeks, low_52_weeks`.

### E. Cadena de opciones

1. **Instrumento/chain id**
   **GET** `/instruments/?symbol=SPY` → `id`
   **GET** `/options/chains/?equity_instrument_ids={id}` → `chain_id`
2. **Listado de contratos**
   **GET** `/options/instruments/?chain_id={chain_id}&state=active&tradability=tradable`
   Campos: `id, expiration_date, strike_price, type(call/put), min_ticks...`
3. **Quotes + Greeks**
   **GET** `/marketdata/options/quotes/?ids={ids...}`
   (o variante de batch)
   Campos esperados por contrato:
   `mark_price, bid_price, ask_price, last_trade_price, volume, open_interest, implied_volatility, delta, gamma, theta, vega, rho, updated_at`.

> Nota: nombres exactos pueden variar según versión, pero el módulo es robusto a eso (mapeo por keys presentes).

---

# 2) Esquemas normalizados (CSV / tablas)

### a) `equity_hours`

```
date,is_open,opens_at,closes_at,extended_opens_at,extended_closes_at,
index_option_0dte_closes_at,index_option_non_0dte_closes_at,
curb_opens_at,curb_closes_at,fx_is_open,fx_opens_at,fx_closes_at
```

### b) `equity_quote`

```
ts,symbol,last_px,prev_close,change_abs,change_pct,bid,ask,mid,spread,volume,halted,updated_at
```

### c) `equity_ohlc`

```
begins_at,open,high,low,close,volume,interval
```

### d) `options_instruments`

```
id,chain_id,symbol,expiration,strike,type,min_tick,tradability
```

### e) `options_quotes_greeks`

```
ts,option_id,expiration,strike,type,
bid,ask,mid,spread,mark,last,volume,open_interest,
iv,delta,gamma,theta,vega,rho,updated_at
```

### f) `iv_timeseries` (por tenor y/o por at-the-money)

```
ts,tenor,iv_atm,iv_10d,iv_30d,iv_60d,iv_90d  // según lo que recuperes/estimes
```

---

# 3) Cálculos y derivados

### Subyacente

* `mid = (bid+ask)/2` si ambos; `spread = ask-bid`.
* **ATR(14)** (diario): Wilder.
* **Realized Vol (RV)**:

  * 5d/10d/20d anualizada: stdev de **log returns** * √252.
* **RSI(14)** y **MA(20/50)** para contexto.

### Opciones (por contrato)

* Completar `mid`/`spread`.
* **Greeks**: usar las que entrega el API; si faltan, estimar con Black-Scholes usando `iv`, `r` (overnight), `q` (dividendo SPY).
* **Moneyness**: `spot/strike` y `Δ` como proxy.
* **Liquidity score**: normalizado por `spread %`, `volume`, `open_interest`.

### Agregados por vencimiento (tenor buckets: 0DTE, 1-7d, 8-30d, 31-60d, >60d)

* **Gamma exposure (GEX)** aproximada: Σ(`gamma` · `notional_per_contract`).
* **Theta decay**: Σ(`theta` · notional).
* **Promedios ponderados por OI**: `iv`, `delta` medios.
* **Term structure**: IV ATM por tenor.

### IV metrics

* **IV Rank (lookback 1y)**:
  `IVR = (IV_now - IV_min) / (IV_max - IV_min)` ∈ [0,1]
* **IV Percentile (1y)**: % de días con IV ≤ IV_now.
* **Skew**: diferencia IV ATM vs IV 25Δ puts/calls por vencimiento.

---

# 4) Reglas de calidad & sanity checks

* Rechazar cotas con `bid>ask`.
* Marcar **stale** si `now - updated_at > 15s` (regular) o `>60s` (extended).
* Spread extremo: `spread / mid > 2%` → “ilíquido”.
* Opciones sin `volume` y `OI` muy bajo → degradar ranking.
* En 0DTE, limitar strikes ±5% del spot para cálculos “ATM cluster”.

---

# 5) UI/UX propuesto (componentes)

1. **Header de mercado**

   * Pill: `OPEN / EXTENDED / CLOSED`
   * Próximo hito: `opens_at / closes_at / curb_*` (según hora actual NY).
2. **Tarjeta SPY**

   * Precio, cambio %, **ATR(14)**, **RV(20d)**, Volumen.
   * Min/Max 52s si fundamentals disponibles.
3. **Smile de IV (chart)**

   * Eje X: strike% (strike/spot−1), Eje Y: IV; selector de vencimiento.
4. **Term structure (chart)**

   * IV ATM vs días a vencimiento; destacar IVR.
5. **Tabla de opciones** (filtrable)

   * `exp, strike, type, mid, spread%, iv, delta, gamma, theta, vega, vol, OI, updated_at`
   * Badge para 0DTE/weekly.
6. **Greeks por vencimiento**

   * Chips: ΣGamma, ΣTheta, IV ATM, IVR, %ITM.
7. **Alertas**

   * “IVR>0.8” (caro), “Term structure invertida”, “Gamma flip cerca del spot”, “Spread%>1%”.

---

# 6) Lógica de sesión (con tu endpoint de horas)

* Determinar `session` en tiempo real:

  * `regular` si `opens_at ≤ now < closes_at`
  * `extended` si dentro de `[extended_opens_at, extended_closes_at)`
  * `curb` si `index_options_extended_hours` activo y dentro del rango
  * `closed` en otro caso
* Mostrar **timer** al próximo cambio de estado.

---

# 7) Pipelines de ingestión (cada 5–10s)

1. **quote SPY** → `equity_quote` (+ derivados).
2. **options quotes+greeks** (batch) → `options_quotes_greeks`.

   * Mapear a `options_instruments` por `option_id`.
3. Cada 1–5 min: **historicals** para **RV/ATR** (buffer local).
4. Al cierre: consolidar **IV Rank/Percentile** (lookback 1y) y snapshots.

Paths sugeridos:

```
data/equity/SPY/quote.csv
data/equity/SPY/ohlc_<interval>.csv
data/options/SPY/instruments.csv
data/options/SPY/quotes_greeks.csv
data/options/SPY/iv_timeseries.csv
data/alerts/options/SPY/<YYYY-MM-DD>.csv
```

---

# 8) Señales y uso práctico (mentor mode)

* **Scalp 0–3 días**: busca **IVR bajo** con spreads ajustados si vendes delta (poco premio) o **IVR alto** si vendes theta (crédito) — siempre con liquidez (spread% < 0.6% en SPY suele ser óptimo) y stops por **Δ** y **IV spike**.
* **Swing 1–2 semanas**: evalúa **term structure** y **skew**: calls baratos cuando skew de puts está muy cargado; para coberturas, prioriza puts con **vega eficiente** (30–45d).
* **Gestión**: alertas por `IVR cruza 0.7`, `spread% se ensancha`, `stale data`, y `Gamma flip` cercano al spot (si ΣGamma cambia de signo alrededor del precio).

---

# 9) Pseudocódigo clave (normalización quotes+greeks)

```ts
type OptRow = {
  ts:number, option_id:string, expiration:string, strike:number, type:'call'|'put',
  bid:number|null, ask:number|null, mid:number|null, spread:number|null,
  mark:number|null, last:number|null, volume:number|null, open_interest:number|null,
  iv:number|null, delta:number|null, gamma:number|null, theta:number|null, vega:number|null, rho:number|null,
  updated_at:string|null
};

function normalizeOptionQuote(raw:any): OptRow {
  const b = num(raw.bid_price), a = num(raw.ask_price);
  const both = b!=null && a!=null && a>=b;
  const mid = both ? (a+b)/2 : null;
  const spread = both ? (a-b) : null;

  return {
    ts: Date.now(),
    option_id: raw.instrument_id || raw.id,
    expiration: raw.expiration_date,
    strike: +raw.strike_price,
    type: raw.type,
    bid: b, ask: a, mid, spread,
    mark: num(raw.mark_price), last: num(raw.last_trade_price),
    volume: int(raw.volume), open_interest: int(raw.open_interest),
    iv: num(raw.implied_volatility),
    delta: num(raw.delta), gamma: num(raw.gamma), theta: num(raw.theta), vega: num(raw.vega), rho: num(raw.rho),
    updated_at: raw.updated_at || null
  };
}
```

---

# 10) Checklist de entrega

* [ ] Ingesta de **horarios** (ya listo) → `session`.
* [ ] Quote SPY + derivados (mid/spread, ATR, RV).
* [ ] Chain discovery (instrument → chain_id) y **batch de quotes+greeks**.
* [ ] Agregados por vencimiento + term structure.
* [ ] IV Rank/Percentile (lookback 1y) y skew.
* [ ] UI con smile, term structure y tabla filtrable.
* [ ] Alertas configuradas.

---