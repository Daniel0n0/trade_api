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



PUNTO 28:
¡Vamos a cerrar el loop con **quotes de cripto en Robinhood** y dejar listo el PnL intradía + valuaciones!

---

# 1) Clasificación rápida

* **Origen/Transporte**: `http` (JSON). Si más adelante activas WS privado, el mismo esquema aplica.
* **Dominios**:

  * `crypto_quotes` (top-of-book y OHLC día)
  * `crypto_pricebook` (profundidad nivel 1–N, opcional)
* **Endpoints típicos (Robinhood)**
  *(nombres canónicos; pueden variar levemente pero los normalizamos igual)*

  * **Quote puntual (top-of-book)**:
    `GET https://api.robinhood.com/marketdata/crypto/quotes/{instrument_id}/?bounds=24_7`
    o batch: `GET .../marketdata/crypto/quotes/?ids={id1,id2,...}&bounds=24_7`
  * **Pricebook (order book snapshot)**:
    `GET https://api.robinhood.com/marketdata/crypto/pricebook/snapshots/{instrument_id}/`
  * **OHLC diario/resumen 24h** *(si aparece)*: embebido en quote o endpoint `historicals` 24/7.

---

# 2) Esquema de la data (raw → tipos)

### A) Quote (top-of-book)

```ts
type CryptoQuoteRaw = {
  instrument_id: string;           // == currency_pair_id en Nummus
  symbol?: string;                 // 'BTCUSD' o 'BTC-USD' (si viene)
  mark_price?: string;             // último/indicativo
  last_trade_price?: string;       // a veces viene
  bid_price?: string;
  ask_price?: string;
  bid_size?: string;               // unidades base
  ask_size?: string;
  open_24h?: string;               // opcional
  high_24h?: string;
  low_24h?: string;
  volume_24h?: string;             // en base
  updated_at?: string;             // ISO
  state?: string;                  // 'active' | 'halted' | ...
  // algunos payloads traen 'previous_close', 'session', etc.
};
```

### B) Pricebook (snapshot)

```ts
type CryptoPricebookRaw = {
  instrument_id: string;
  symbol?: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  updated_at?: string;
};
```

> Si el payload real usa otras claves, las mapeamos a estas (estandarización).

---

# 3) Normalización (schemas de salida)

### A) **Quotes actuales** (una fila por instrumento)

**Archivo lógico**: `crypto_quotes_current`

```ts
type CryptoQuote = {
  ts: number;                      // epoch ms de ingestión
  source_url: string;
  instrument_id: string;
  symbol: string;                  // normalizado: p.ej. 'BTC-USD'
  mark: string;                    // preferencia: mark_price || last_trade_price
  bid: string;
  ask: string;
  bid_size: string;
  ask_size: string;
  mid: string;                     // (bid+ask)/2 si ambos existen
  spread: string;                  // ask-bid
  open_24h: string | null;
  high_24h: string | null;
  low_24h: string | null;
  vol_24h: string | null;          // base
  state: string | null;
  updated_at_iso: string | null;
};
```

### B) **Pricebook L1–N** (opcional, útil para slippage/IMB)

**Archivo lógico**: `crypto_pricebook_snapshot`

```ts
type CryptoPricebook = {
  ts: number; source_url: string;
  instrument_id: string; symbol: string;
  level: number;                   // 1..N
  side: 'bid'|'ask';
  price: string; size: string;
};
```

---

# 4) ¿Cómo recibirla?

* **Handler**: HTTP **polling** cada **5–10s** para símbolos con posición o en watchlist; cada **30–60s** para el resto.
* **Batch-friendly**: usa endpoint por **ids** para minimizar latencia.
* **Paginación**: no aplica; si hubiera `next`, seguirla.
* **Bounds**: usa `bounds=24_7` para cripto (sin ventanas).
* **Envelope** (igual que antes):

```ts
const env: Envelope = {
  ts: Date.now(),
  transport: 'http',
  source: 'https://api.robinhood.com/marketdata/crypto/quotes/?ids=...',
  topic: 'crypto_quotes',
  payload: json
};
```

---

# 5) Validaciones + derivados

* **Validar** `instrument_id`/`symbol` no vacíos.
* Precios/cantidades: strings decimales válidas (usa `Decimal`).
* Derivados:

  * `mark = mark_price ?? last_trade_price ?? mid`
  * `mid = (bid+ask)/2` si ambos existen.
  * `spread = ask - bid` si ambos existen.
  * `state_normalized = state?.toLowerCase()`
* **Coherencia**: si `bid > ask`, descartar frame y loggear (data de mala calidad).

---

# 6) ¿Se guarda?

Sí, en dos sabores:

### (a) **Stream intradía (append)**

```
data/marketdata/crypto/<SYMBOL>/<YYYY-MM-DD>/quotes.csv
```

Columnas:

```
ts,instrument_id,symbol,mark,bid,ask,bid_size,ask_size,mid,spread,open_24h,high_24h,low_24h,vol_24h,state,updated_at_iso,source_url
```

### (b) **Rolling “último”** (se sobreescribe)

```
data/marketdata/crypto/<SYMBOL>/last_quote.csv
```

### (c) **Pricebook** *(si activas)*

```
data/marketdata/crypto/<SYMBOL>/<YYYY-MM-DD>/pricebook.csv
```

Columnas:

```
ts,instrument_id,symbol,level,side,price,size,source_url
```

---

# 7) **Join con holdings** → valuación + PnL

## A) Valuación instantánea (snapshot)

Input:

* `holdings_current` (del módulo anterior)
* `last_quote.csv` (o el último `quotes.csv` por símbolo)

Salida:

```
data/portfolio/valuations/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/valued_holdings.csv
```

Columnas (añadidos respecto a holdings):

```
mark_px_usd,mtm_value_usd,mid,spread,state,quote_ts
```

**Cálculos**

* `mark_px_usd = Decimal(quote.mark)`
* `mtm_value_usd = Decimal(holding.qty) * mark_px_usd`

## B) PnL intradía (time series)

Cada vez que tengas un nuevo quote **material** (p.ej. cambio > 0.1% o cada 60s), escribe:

```
data/portfolio/pnl/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/unrealized_timeseries.csv
```

```
ts,account_id,currency_code,qty,mark_px_usd,mtm_value_usd,mid,spread
```

> **Realizado (realized PnL)**: deriva de eventos de Δqty detectados entre snapshots de holdings (sección 8 del módulo anterior).
> Escribe en:

```
data/portfolio/pnl/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/realized_events.csv
```

```
ts,account_id,currency_code,event,delta_qty,execution_px_usd?,realized_pnl_usd
```

*(si no tienes `execution_px`, aprox. con `mark` del momento del evento; marca una columna `is_estimate`)*

---

# 8) Alertas y monitores (recomendado)

* **Spread amplio**: `spread / mid > 0.25%` → alerta slippage.
* **Estado**: `state != 'active'` → alerta (posibles halts/errores).
* **Movimiento**: `abs(mark - last_mark)/last_mark > X%` en 1m/5m.
* **Volumen 24h**: si `Δvol_24h` cae bruscamente, posible baja de liquidez.

Escribe alertas en:

```
data/alerts/crypto/<SYMBOL>/<YYYY-MM-DD>/alerts.csv
```

```
ts,kind,symbol,detail,trigger_value,context,source_url
```

---

# 9) Pseudocódigo (TypeScript) — normalización y join

```ts
import Decimal from 'decimal.js';

function dec(s?: string | null) { return new Decimal(s ?? '0'); }

function normaliseCryptoQuotes(env: Envelope): CryptoQuote[] {
  const raw = Array.isArray(env.payload?.results) ? env.payload.results : (Array.isArray(env.payload) ? env.payload : [env.payload]);
  const out: CryptoQuote[] = [];

  for (const q of raw) {
    const bid = dec(q.bid_price?.toString());
    const ask = dec(q.ask_price?.toString());
    const hasBoth = bid.gt(0) && ask.gt(0);
    const mid = hasBoth ? bid.plus(ask).div(2) : dec(q.mark_price ?? q.last_trade_price);
    const mark = q.mark_price ?? q.last_trade_price ?? (hasBoth ? mid.toString() : null);
    const spread = hasBoth ? ask.minus(bid) : new Decimal(0);

    out.push({
      ts: env.ts,
      source_url: env.source,
      instrument_id: q.instrument_id,
      symbol: normaliseSymbol(q.symbol), // 'BTC-USD'
      mark: mark ?? '0',
      bid: q.bid_price ?? '0',
      ask: q.ask_price ?? '0',
      bid_size: q.bid_size ?? '0',
      ask_size: q.ask_size ?? '0',
      mid: mid.toString(),
      spread: spread.toString(),
      open_24h: q.open_24h ?? null,
      high_24h: q.high_24h ?? null,
      low_24h: q.low_24h ?? null,
      vol_24h: q.volume_24h ?? null,
      state: q.state ?? null,
      updated_at_iso: q.updated_at ?? null
    });
  }
  return out;
}

function valueHoldingsWithQuotes(holding: HoldingCurrent, quote: CryptoQuote) {
  const mark = dec(quote.mark);
  const qty = dec(holding.qty);
  return {
    ...holding,
    mark_px_usd: mark.toString(),
    mtm_value_usd: qty.mul(mark).toString(),
    mid: quote.mid,
    spread: quote.spread,
    state: quote.state,
    quote_ts: quote.ts
  };
}
```

---

# 10) Reglas prácticas

* **Decimales**: siempre `Decimal`/`BigNumber` (evita `float` binario).
* **Símbolo canónico**: usa `'BTC-USD'`, `'SOL-USD'`, etc.; mapea el que venga en el payload.
* **Frecuencia**: 5–10s activos; 30–60s pasivos.
* **Idempotencia**: clave `(ts_bucket_1s, instrument_id)` para quotes; para pricebook, `(ts, level, side)`.
* **Privacidad**: no persistas headers/authorization.

---

## Carpetas finales involucradas (resumen)

```
data/
  marketdata/
    crypto/<SYMBOL>/<YYYY-MM-DD>/quotes.csv
    crypto/<SYMBOL>/last_quote.csv
    crypto/<SYMBOL>/<YYYY-MM-DD>/pricebook.csv            (opcional)
  portfolio/
    holdings/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/holdings_current.csv
    valuations/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/valued_holdings.csv
    pnl/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/unrealized_timeseries.csv
    pnl/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/realized_events.csv
  alerts/
    crypto/<SYMBOL>/<YYYY-MM-DD>/alerts.csv
  _raw/
    crypto_quotes/<YYYY-MM-DD>/...jsonl                    (opcional)
```

---