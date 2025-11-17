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



PUNTO 29:
¡Perfecto! Tomo esa **batch de quotes de futuros** y te dejo el módulo listo: esquema, normalización, derivados útiles (mid/spread, micro-movimientos), persistencia y cómo “joinear” con metadata del contrato para tener **ticks y notionals** cuando lo agregues.

# 1) Payload → Campos (observados)

Para cada instrumento (uno por `instrument_id`):

* `symbol` → p.ej. `/CLZ25:XNYM`, `/GCZ25:XCEC`, `/RTYZ25:XCME`
* `bid_price`, `bid_size`, `bid_venue_timestamp`
* `ask_price`, `ask_size`, `ask_venue_timestamp`
* `last_trade_price`, `last_trade_size`, `last_trade_venue_timestamp`
* `state` (`active`, etc.)
* `updated_at`
* `out_of_band` (boolean)

# 2) **Schema normalizado** (una fila por instrumento)

Archivo lógico: `futures_quotes_current`

```ts
type FuturesQuote = {
  ts: number;                    // epoch ms de ingestión
  source_url: string;

  instrument_id: string;
  symbol: string;                // ej: "/CLZ25:XNYM"
  root: string;                  // "/CL"
  expiry_code: string;           // "Z25" (derivado de symbol)
  venue: string;                 // "XNYM" / "XCME" / "XCEC"...

  bid_px: string;                // decimal string
  bid_sz: string;                // contratos (int/decimal como string)
  bid_ts: string;                // ISO

  ask_px: string;
  ask_sz: string;
  ask_ts: string;

  last_px: string;
  last_sz: string;
  last_ts: string;

  state: string | null;          // 'active' | ...
  updated_at_iso: string | null;

  // Derivados inmediatos
  mid_px: string | null;         // (bid+ask)/2 si ambos
  spread_px: string | null;      // ask - bid
  spread_bps: string | null;     // (spread/mid)*10000 si mid>0
};
```

> Nota: `root`, `expiry_code` y `venue` salen de partir `symbol` por `:` y del mes/letra. Ej: `/GCZ25:XCEC` → `root="/GC"`, `expiry_code="Z25"`, `venue="XCEC"`.

# 3) Persistencia recomendada

* **Stream (append)** cada pull (Robinhood sugiere `x-poll-interval: 5`):

```
data/marketdata/futures/<ROOT>/<YYYY-MM-DD>/quotes.csv
```

Columnas:

```
ts,source_url,instrument_id,symbol,root,expiry_code,venue,
bid_px,bid_sz,bid_ts,ask_px,ask_sz,ask_ts,last_px,last_sz,last_ts,
state,updated_at_iso,mid_px,spread_px,spread_bps
```

* **“Último”** (snapshot por instrumento, se sobreescribe):

```
data/marketdata/futures/<ROOT>/last_quote.csv
```

# 4) Derivados opcionales (si añades metadata)

Cuando integres **metadata del contrato** (tick size, tick value, multiplier, currency):

```ts
type FuturesMeta = {
  instrument_id: string;
  root: string;         // "/CL"
  multiplier: string;   // p.ej. 1000 (bbl), 100 (oz), 50 (mini índices)...
  tick_size: string;    // p.ej. 0.01, 0.25, 0.005 ...
  tick_value: string;   // $ por tick
  quote_ccy: "USD";     // casi siempre USD en estos
};
```

Entonces puedes agregar:

* `spread_ticks = spread_px / tick_size`
* `notional_mid = mid_px * multiplier`
* `last_notional = last_px * multiplier`

Guárdalos en un **archivo extendido**:

```
data/marketdata/futures/<ROOT>/<YYYY-MM-DD>/quotes_enriched.csv
```

# 5) Normalizador (TypeScript) — seguro con decimales

```ts
import Decimal from 'decimal.js';

const dec = (s?: any) => new Decimal(s ?? '0');

function parseSymbol(sym: string) {
  const [left, venue] = sym.split(':');     // "/GCZ25" , "XCEC"
  const root = left.replace(/[A-Z]\d{2}$/, (m) => '') // quita "Z25"
                    .replace(/Z25|H26|[FGHJKMNQUVXZ]\d{2}$/, ''); // robusto
  const expiry = left.substring(root.length); // "Z25"
  return { root, expiry_code: expiry, venue };
}

function normaliseFuturesQuotes(env: { ts: number; source: string; payload: any }): FuturesQuote[] {
  const arr = Array.isArray(env.payload?.data) ? env.payload.data : [];
  const out: FuturesQuote[] = [];

  for (const wrap of arr) {
    if (wrap?.status !== 'SUCCESS') continue;
    const q = wrap.data;

    const bid = q.bid_price != null ? dec(q.bid_price) : null;
    const ask = q.ask_price != null ? dec(q.ask_price) : null;

    const hasBoth = !!(bid && ask);
    const mid = hasBoth ? bid!.plus(ask!).div(2) : null;
    const spread = hasBoth ? ask!.minus(bid!) : null;
    const spread_bps = hasBoth && mid!.gt(0) ? spread!.div(mid!).mul(10000) : null;

    const { root, expiry_code, venue } = parseSymbol(q.symbol);

    out.push({
      ts: env.ts,
      source_url: env.source,

      instrument_id: q.instrument_id,
      symbol: q.symbol,
      root, expiry_code, venue,

      bid_px: q.bid_price ?? null,
      bid_sz: (q.bid_size ?? '').toString(),
      bid_ts: q.bid_venue_timestamp ?? null,

      ask_px: q.ask_price ?? null,
      ask_sz: (q.ask_size ?? '').toString(),
      ask_ts: q.ask_venue_timestamp ?? null,

      last_px: q.last_trade_price ?? null,
      last_sz: (q.last_trade_size ?? '').toString(),
      last_ts: q.last_trade_venue_timestamp ?? null,

      state: q.state ?? null,
      updated_at_iso: q.updated_at ?? null,

      mid_px: mid?.toString() ?? null,
      spread_px: spread?.toString() ?? null,
      spread_bps: spread_bps?.toString() ?? null
    });
  }
  return out;
}
```

# 6) Reglas de calidad

* **Descartar frame** si `bid_px > ask_px` (data inválida); loggear con `context`.
* Si falta uno de los lados, setear `mid_px`/`spread_*` en `null`.
* `Decimal` para todo cálculo; **nunca** `float`.
* `symbol` y `instrument_id` **no vacíos**.

# 7) Alertas recomendadas (intradía)

Escribe en `data/alerts/futures/<ROOT>/<YYYY-MM-DD>/alerts.csv`

```
ts,kind,root,symbol,detail,trigger_value,context,source_url
```

Disparadores:

* **Spread alto**: `spread_bps > 8–12 bps` (ajústalo por root; en FX/bonos será distinto).
* **Liquidez**: `bid_sz==0 || ask_sz==0`.
* **Estado**: `state != 'active'`.
* **Stale**: si `now - max(bid_ts, ask_ts, last_ts) > 10s` (mercado 24h) o >60s (curb).
* **Jump**: `abs(Δlast_px)/prev_last_px > 0.20%` en ≤1 min.

# 8) Join con **metadata** para risk/notional

Cuando tengas el catálogo por `instrument_id` (puede venir de tu módulo “instrumentos”), añade:

* `tick_size`, `tick_value`, `multiplier` → calcula:

  * `spread_ticks = spread_px / tick_size`
  * `notional_mid = mid_px * multiplier`
  * **Slippage estimado** por cruzar spread: `spread_ticks * tick_value`

# 9) Ejemplo (a partir de tu payload)

Para `/GCZ25:XCEC` (oro COMEX):

* `bid_px=4115.9`, `ask_px=4116.1` → `mid=4116.0`, `spread=0.2`
* `spread_bps ≈ (0.2 / 4116.0) * 10000 ≈ 4.86 bps`

> Con metadata típica (ejemplo ilustrativo), si `tick_size=0.1` y `tick_value=$10`, `spread_ticks=2`, costo implícito≈ **$20/contrato** al cruzar.

# 10) Carpetería final (resumen)

```
data/
  marketdata/
    futures/<ROOT>/<YYYY-MM-DD>/quotes.csv
    futures/<ROOT>/last_quote.csv
    futures/<ROOT>/<YYYY-MM-DD>/quotes_enriched.csv      (si tienes metadata)
  alerts/
    futures/<ROOT>/<YYYY-MM-DD>/alerts.csv
```

# 11) Checklist de implementación

* [ ] Ingesta cada 5 s (usa `x-poll-interval` como hint).
* [ ] Normalización → `quotes.csv` (append) + `last_quote.csv`.
* [ ] Validaciones (bid>ask, stale, vacíos).
* [ ] Cálculo `mid/spread/spread_bps`.
* [ ] Alertas básicas.
* [ ] (Luego) Join con **metadata** para ticks/notional.

---