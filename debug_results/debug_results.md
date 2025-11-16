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



PUNTO 27:
¡Vamos, Amo! Integramos el **módulo de “crypto holdings” (Nummus)** para tu vista general y tus pipelines.

---

# 1) Clasificación rápida

* **Origen/Transporte**: `http` (JSON)
* **Dominio**: `crypto_holdings`
* **Endpoint**: `GET https://nummus.robinhood.com/holdings/`
* **Paginación**: `next`, `previous`
* **Cardinalidad**: lista de posiciones (una por **moneda** y **account_id**)

---

# 2) Esquema de la data (raw → tipos)

```ts
type HoldingRaw = {
  id: string;                         // holding row id
  account_id: string;                 // cuenta de cripto
  currency_pair_id: string;           // par base (p.ej. BTC-USD interno)
  created_at: string;                 // ISO con offset, zona local
  updated_at: string;                 // ISO con offset, zona local

  // cantidades (strings decimales)
  quantity: string;
  quantity_available: string;
  quantity_held: string;
  quantity_held_for_buy: string;
  quantity_held_for_sell: string;
  quantity_staked: string;
  quantity_transferable: string;

  // moneda base (no el par)
  currency: {
    id: string;
    code: string;                     // 'BTC','SOL','MOODENG', etc.
    name: string;
    type: 'cryptocurrency';
    crypto_type: 'BASE_ASSET';
    increment: string;                // tick size decimal (p.ej. '0.00000001')
    brand_color?: string;
    display_only: boolean;
  };

  // cost basis agregados por categoría
  cost_bases: Array<{
    id: string;
    currency_id: string;              // parece USD interno
    direct_cost_basis: string;        // compras
    direct_quantity: string;
    direct_reward_cost_basis: string; // rewards, staking
    direct_reward_quantity: string;
    direct_transfer_cost_basis: string;
    direct_transfer_quantity: string;
    intraday_cost_basis: string;
    intraday_quantity: string;
    marked_cost_basis: string;
    marked_quantity: string;
  }>;

  // lotes (para clearing/valor en libros)
  tax_lot_cost_bases: Array<{
    id: string;
    clearing_book_cost_basis: string;                  // en moneda de liquidación
    clearing_running_quantity: string;
    clearing_running_quantity_without_cost_basis: string;
    intraday_cost_basis: string;
    intraday_quantity: string;
    intraday_quantity_without_cost_basis: string;
  }>;
};

type HoldingsResponseRaw = {
  next: string | null;
  previous: string | null;
  results: HoldingRaw[];
}
```

---

# 3) Normalización (schemas de salida)

### A) **Snapshot actual por activo** (una fila por `account_id` + `currency.code`)

**Archivo**: `holdings_current`

```ts
type HoldingCurrent = {
  ts: number;                         // epoch ms de ingestión
  source_url: string;

  // claves
  account_id: string;
  holding_id: string;                 // raw id
  currency_id: string;
  currency_code: string;              // 'BTC'
  currency_name: string;
  currency_pair_id: string;

  // granularidad/tokenomics
  increment: string;                  // '0.00000001'
  precision: number;                  // derivado de increment
  is_display_only: 0 | 1;

  // cantidades (como string decimal, sin pérdida)
  qty: string;
  qty_available: string;
  qty_held: string;
  qty_held_for_buy: string;
  qty_held_for_sell: string;
  qty_staked: string;
  qty_transferable: string;

  // agregados de cost basis (suma por categoría si hay múltiples cost_bases)
  cb_direct_qty: string;
  cb_direct_cost: string;
  cb_reward_qty: string;
  cb_reward_cost: string;
  cb_transfer_qty: string;
  cb_transfer_cost: string;
  cb_intraday_qty: string;
  cb_intraday_cost: string;
  cb_marked_qty: string;
  cb_marked_cost: string;

  // meta
  lots_count: number;                 // tax_lot_cost_bases.length
  created_at_iso: string;
  updated_at_iso: string;

  // flags
  has_position: 0 | 1;                // qty > 0 ?
};
```

### B) **Detalle de cost_bases** (explode)

**Archivo**: `holdings_cost_bases`

```ts
type HoldingCostBasis = {
  ts: number;
  source_url: string;
  account_id: string;
  holding_id: string;
  cost_basis_id: string;
  currency_id: string;                // (suele ser USD interno)
  direct_qty: string; direct_cost: string;
  reward_qty: string; reward_cost: string;
  transfer_qty: string; transfer_cost: string;
  intraday_qty: string; intraday_cost: string;
  marked_qty: string; marked_cost: string;
};
```

### C) **Detalle de tax lots** (explode)

**Archivo**: `holdings_tax_lots`

```ts
type HoldingTaxLot = {
  ts: number;
  source_url: string;
  account_id: string;
  holding_id: string;
  tax_lot_id: string;
  clearing_book_cost_basis: string;
  clearing_running_qty: string;
  clearing_running_qty_wo_cb: string;
  intraday_cb: string;
  intraday_qty: string;
  intraday_qty_wo_cb: string;
};
```

> **Notas de valores**: todos los importes/cantidades quedan como **string decimal**. Para cálculos usa `Decimal`/`BigNumber`. Puedes derivar un **entero escalado** opcional (`qty_atoms = qty / increment`) si lo necesitas para diffs exactos.

---

# 4) ¿Cómo recibirla?

* **Handler**: HTTP periódico.

  * **On login & cada 1–5 min** durante mercado abierto (para detectar fills/entradas).
  * **Siempre** al cierre (snapshot EOD).
* **Paginación**: seguir `next` hasta `null`.
* **Parsing**: `response.text()` → `safeJsonParse`.
* **Envelope**:

```ts
const env: Envelope = {
  ts: Date.now(),
  transport: 'http',
  source: 'https://nummus.robinhood.com/holdings/',
  topic: 'crypto_holdings',
  payload: json
};
```

---

# 5) Procesamiento (validaciones, derivados, join)

**Validaciones**

* `account_id`, `holding.id`, `currency.code` no vacíos.
* `increment` válido → `precision = decimals(increment)`.
* Cantidades y costos: strings decimales válidas, **no NaN**, **no negativas** (excepto que RH permita negativos en préstamos; si apareciera, log/warn).
* `updated_at >= created_at` (si no, log).

**Derivados inmediatos**

* `has_position = qty > 0 ? 1:0`.
* Sumas de cost basis por categoría (si existen múltiples objetos en `cost_bases`).
* `lots_count`.

**Valuación (opcional pero recomendada para dashboard)**

* **NO** viene el precio aquí; **join** con tu feed de **quotes** de cripto (el de Robinhood/marketdata).

  * `mark_px_usd` por `currency_code`.
  * `mtm_value = Decimal(qty) * mark_px_usd`.
  * Guarda estas valuaciones solo en **snapshots** (ver #7).

---

# 6) ¿Se guarda?

Sí, con dos vistas:

### (a) **Snapshot intradía/EOD** (recomendado)

```
data/portfolio/holdings/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/holdings_current.csv
```

Columnas (en orden = `HoldingCurrent`):

```
ts,source_url,account_id,holding_id,currency_id,currency_code,currency_name,currency_pair_id,increment,precision,is_display_only,
qty,qty_available,qty_held,qty_held_for_buy,qty_held_for_sell,qty_staked,qty_transferable,
cb_direct_qty,cb_direct_cost,cb_reward_qty,cb_reward_cost,cb_transfer_qty,cb_transfer_cost,cb_intraday_qty,cb_intraday_cost,cb_marked_qty,cb_marked_cost,
lots_count,created_at_iso,updated_at_iso,has_position
```

> **Tip**: además, genera un archivo **rolling**:

```
data/portfolio/holdings/crypto/<ACCOUNT_ID>/current.csv  // se sobreescribe
```

### (b) **Detalles** (opcional, si auditas bases y lotes)

```
data/portfolio/holdings/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/holdings_cost_bases.csv
data/portfolio/holdings/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/holdings_tax_lots.csv
```

### (c) **Crudo (auditoría)**

```
data/_raw/crypto_holdings/<ACCOUNT_ID>/<YYYY-MM>/<YYYY-MM-DDThhmmssZ>.json
```

### (d) **Snapshots valuados** (si haces join con quotes)

```
data/portfolio/valuations/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/valued_holdings.csv
```

Columnas extra:

```
mark_px_usd,mtm_value_usd          // strings decimales o cents enteros
```

---

# 7) Lógica de escritura / idempotencia

* **Crear** con encabezado si no existe; **append** por corrida.
* Clave natural para *deduplicar*: `(ts_bucket_1m, account_id, currency_code)` o usa `holding_id`.
* Si haces **EOD canonical**, escribe/actualiza **una sola** fila final por `(account_id,currency_code)`.

---

# 8) Diferenciales y eventos (opcional, útil)

Construye un pequeño detector de **eventos** comparando snapshots consecutivos:

* `Δqty = qty_now - qty_prev`

  * `Δqty > 0` y `cb_direct_cost>0` ⇒ **BUY**
  * `Δqty < 0` ⇒ **SELL/TRANSFER_OUT**
  * `Δqty > 0` y `cb_reward_qty>0` ⇒ **REWARD/STAKE`
* Guarda eventos en:

```
data/portfolio/events/crypto/<ACCOUNT_ID>/<YYYY-MM-DD>/events.csv
```

```
ts,account_id,currency_code,event,delta_qty,reason,cb_cost_contrib
```

---

# 9) Pseudocódigo (TypeScript)

```ts
function dec(s: string | null | undefined): Decimal {
  return new Decimal(s ?? '0');
}
function precisionFromIncrement(incr: string): number {
  const i = incr.indexOf('.');
  return i < 0 ? 0 : (incr.length - i - 1);
}

function normaliseHoldings(env: Envelope) {
  const raw = env.payload as HoldingsResponseRaw;

  const outCurrent: HoldingCurrent[] = [];
  const outCB: HoldingCostBasis[] = [];
  const outLots: HoldingTaxLot[] = [];

  for (const h of raw.results) {
    const precision = precisionFromIncrement(h.currency.increment ?? '0');
    // aggregate cost_bases
    const agg = h.cost_bases?.reduce((a, cb) => ({
      direct_qty: a.direct_qty.plus(dec(cb.direct_quantity)),
      direct_cost: a.direct_cost.plus(dec(cb.direct_cost_basis)),
      reward_qty: a.reward_qty.plus(dec(cb.direct_reward_quantity)),
      reward_cost: a.reward_cost.plus(dec(cb.direct_reward_cost_basis)),
      transfer_qty: a.transfer_qty.plus(dec(cb.direct_transfer_quantity)),
      transfer_cost: a.transfer_cost.plus(dec(cb.direct_transfer_cost_basis)),
      intraday_qty: a.intraday_qty.plus(dec(cb.intraday_quantity)),
      intraday_cost: a.intraday_cost.plus(dec(cb.intraday_cost_basis)),
      marked_qty: a.marked_qty.plus(dec(cb.marked_quantity)),
      marked_cost: a.marked_cost.plus(dec(cb.marked_cost_basis))
    }), {
      direct_qty: new Decimal(0), direct_cost: new Decimal(0),
      reward_qty: new Decimal(0), reward_cost: new Decimal(0),
      transfer_qty: new Decimal(0), transfer_cost: new Decimal(0),
      intraday_qty: new Decimal(0), intraday_cost: new Decimal(0),
      marked_qty: new Decimal(0), marked_cost: new Decimal(0)
    });

    outCurrent.push({
      ts: env.ts, source_url: env.source,
      account_id: h.account_id, holding_id: h.id,
      currency_id: h.currency.id, currency_code: h.currency.code,
      currency_name: h.currency.name, currency_pair_id: h.currency_pair_id,
      increment: h.currency.increment, precision,
      is_display_only: h.currency.display_only ? 1 : 0,

      qty: h.quantity, qty_available: h.quantity_available,
      qty_held: h.quantity_held, qty_held_for_buy: h.quantity_held_for_buy,
      qty_held_for_sell: h.quantity_held_for_sell, qty_staked: h.quantity_staked,
      qty_transferable: h.quantity_transferable,

      cb_direct_qty: agg.direct_qty.toString(),
      cb_direct_cost: agg.direct_cost.toString(),
      cb_reward_qty: agg.reward_qty.toString(),
      cb_reward_cost: agg.reward_cost.toString(),
      cb_transfer_qty: agg.transfer_qty.toString(),
      cb_transfer_cost: agg.transfer_cost.toString(),
      cb_intraday_qty: agg.intraday_qty.toString(),
      cb_intraday_cost: agg.intraday_cost.toString(),
      cb_marked_qty: agg.marked_qty.toString(),
      cb_marked_cost: agg.marked_cost.toString(),

      lots_count: h.tax_lot_cost_bases?.length ?? 0,
      created_at_iso: h.created_at, updated_at_iso: h.updated_at,
      has_position: (new Decimal(h.quantity).greaterThan(0)) ? 1 : 0
    });

    for (const cb of h.cost_bases ?? []) {
      outCB.push({
        ts: env.ts, source_url: env.source,
        account_id: h.account_id, holding_id: h.id, cost_basis_id: cb.id,
        currency_id: cb.currency_id,
        direct_qty: cb.direct_quantity, direct_cost: cb.direct_cost_basis,
        reward_qty: cb.direct_reward_quantity, reward_cost: cb.direct_reward_cost_basis,
        transfer_qty: cb.direct_transfer_quantity, transfer_cost: cb.direct_transfer_cost_basis,
        intraday_qty: cb.intraday_quantity, intraday_cost: cb.intraday_cost_basis,
        marked_qty: cb.marked_quantity, marked_cost: cb.marked_cost_basis
      });
    }
    for (const tl of h.tax_lot_cost_bases ?? []) {
      outLots.push({
        ts: env.ts, source_url: env.source,
        account_id: h.account_id, holding_id: h.id, tax_lot_id: tl.id,
        clearing_book_cost_basis: tl.clearing_book_cost_basis,
        clearing_running_qty: tl.clearing_running_quantity,
        clearing_running_qty_wo_cb: tl.clearing_running_quantity_without_cost_basis,
        intraday_cb: tl.intraday_cost_basis,
        intraday_qty: tl.intraday_quantity,
        intraday_qty_wo_cb: tl.intraday_quantity_without_cost_basis
      });
    }
  }
  return { current: outCurrent, cost_bases: outCB, tax_lots: outLots };
}
```

---

# 10) Reglas prácticas

* **Tipos decimales**: usa `decimal.js` o `big.js`. Evita `Number`.
* **Unidades**: todo en **moneda de liquidación** (cost basis) y **cantidad de base** (qty).
* **Seguridad**: no persistir cabeceras sensibles; **solo** `source_url` pública.
* **Health**: si `results.length===0`, **guardar** snapshot vacío igualmente (útil para históricos sin posición).
* **Frecuencia**:

  * Intradía: cada 1–5 min si estás operando.
  * EOD: snapshot final + valued snapshot (con join de precios).

---