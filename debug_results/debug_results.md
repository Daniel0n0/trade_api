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



PUNTO 23:
¡Vamos con esa **petición** (futuros /MES — lista de contratos por `productId`)!

---

# 1) Estructura de la data (schema)

**Origen**: HTTP JSON (Robinhood Arsenal)
**Endpoint**: `GET /arsenal/v1/futures/contracts?productIds=<PRODUCT_ID>`

### Payload crudo (uno por contrato en `results[]`)

```ts
type FuturesContractRaw = {
  id: string;                 // p.ej. "c4021dc3-bc5c-4252-a5b9-209572a1cb78"
  productId: string;          // p.ej. "f5e6b1cd-3d23-4add-8c51-385dd953a850"
  symbol: string;             // "/MESZ25:XCME"
  displaySymbol: string;      // "/MESZ25"
  description: string;        // "Micro E-mini S&P 500 Futures, Dec-25"
  multiplier: string;         // "5" (string en el payload)
  expirationMmy: string;      // "202512"
  expiration: string;         // "2025-12-19"
  customerLastCloseDate: string; // "2025-12-19"
  tradability: string;        // "FUTURES_TRADABILITY_TRADABLE"
  state: string;              // "FUTURES_STATE_ACTIVE"
  settlementStartTime: string;// "08:30"
  firstTradeDate: string;     // "2024-05-01"
  settlementDate: string;     // "2025-12-19"
};
```

### Registro normalizado (una fila por contrato)

```ts
type FuturesContractRow = {
  ts: number;                 // epoch ms de ingestión
  product_id: string;
  contract_id: string;

  symbol: string;             // "/MESZ25:XCME"
  display_symbol: string;     // "/MESZ25"
  root: string;               // "MES"
  month_code: string;         // "Z" | "H" | ...
  year_two: number;           // 25 (2 dígitos)
  year_full: number;          // 2025

  exchange: string | null;    // "XCME" (si viene en symbol)
  description: string | null;
  multiplier: number;         // 5

  expiration_mmy: string;     // "202512"
  expiration_ts: number;      // epoch ms UTC (de "expiration")
  last_close_date_ts: number; // epoch ms UTC (de "customerLastCloseDate")
  first_trade_date_ts: number;// epoch ms UTC
  settlement_date_ts: number; // epoch ms UTC
  settlement_start_time: string; // "08:30" (tal cual)

  tradability: string;        // enum text
  state: string;              // enum text

  // Derivados útiles:
  days_to_expiry: number;     // (expiration - now_utc) en días
  contract_rank: number;      // 1 = front, 2 = next... (ordenado por expiration dentro del productId)
  is_active: boolean;         // state === "FUTURES_STATE_ACTIVE"
};
```

---

# 2) Cómo recibirla

**Handler**: HTTP (poll bajo demanda o en cada arranque / cambio de sesión)

* Haz `GET` con los headers que usas ya (autorización, `x-timezone-id`, etc.).
* `response.text()` → `safeJsonParse`.
* Envuélvelo en tu **Envelope** estándar:

```ts
const env: Envelope = {
  ts: Date.now(),
  transport: 'http',
  source: 'https://api.robinhood.com/arsenal/v1/futures/contracts?productIds=...',
  payload: json, // el objeto ya parseado
};
```

---

# 3) Cómo procesarla

### Validaciones

* `results` existe y es array con longitud > 0.
* Cada contrato: `id`, `productId`, `symbol`, `expiration` no vacíos.
* Fechas `YYYY-MM-DD` → convertir a epoch ms (UTC).
* `multiplier` → `Number(multiplier)` y que sea finito.

### Normalización paso a paso

1. **Exchange, root, month, year**

   * `symbol` = `"/MESZ25:XCME"`

     * `exchange` = texto después de `:` (si existe) → `"XCME"`
     * `displaySymbol` = `"/MESZ25"` → quita `/` → `"MESZ25"`
     * `root` = letras iniciales → `"MES"`
     * `month_code` = primera letra después del root → `"Z"`
     * `year_two` = resto como número → `25`
     * `year_full` = `2000 + year_two` si `year_two < 70` else `1900 + year_two` (regla estándar de 2 dígitos).

2. **Fechas → epoch ms**

   * `expiration_ts`, `last_close_date_ts`, `first_trade_date_ts`, `settlement_date_ts`.

3. **Derivados**

   * `days_to_expiry = floor((expiration_ts - now_utc_ms) / 86_400_000)`
   * Ordena todos los contratos del mismo `productId` por `expiration_ts` asc y asigna `contract_rank` (1,2,3…).
   * `is_active = (state === "FUTURES_STATE_ACTIVE")`.

4. **Tipos**

   * `multiplier = Number(multiplier)` (p.ej. `5`).

### Recomendaciones de calidad

* **Idempotencia**: calcula `contract_rank` siempre con el **conjunto** recibido por `productId`.
* **Monitoreo de cambios**: si cambian `state` o `expiration`, registra diff en un log (`_raw`).

---

# 4) ¿Se guarda? ¿Cómo guardarla?

**Sí, guardar** (catálogo de contratos es estable pero crítico para rollovers y mapping).

### Rutas y archivos

* **Snapshot diario** (append-safe por ingestión):
  `data/futures/contracts/<PRODUCT_ID>/<YYYY-MM-DD>.csv`

* **Último snapshot “actual”** (sobre-escritura atómica):
  `data/futures/contracts/<PRODUCT_ID>/latest.csv`

* **Opcional (depuración crudo)**:
  `data/_raw/futures_contracts/<YYYY-MM-DD>/contracts_<PRODUCT_ID>.jsonl`

### Columnas del CSV (en orden)

```
ts,product_id,contract_id,symbol,display_symbol,root,month_code,year_two,year_full,exchange,description,multiplier,expiration_mmy,expiration_ts,last_close_date_ts,first_trade_date_ts,settlement_date_ts,settlement_start_time,tradability,state,days_to_expiry,contract_rank,is_active,source_url
```

---

## Ejemplo con tus datos (hoy: 2025-11-11, NY)

**Conjunto recibido (`productId` = `f5e6b1cd-3d23-4add-8c51-385dd953a850`):**

* `/MESZ25` (expira **2025-12-19**) → `contract_rank = 1`, `days_to_expiry ≈ 38`
* `/MESH26` (expira **2026-03-20**) → `contract_rank = 2`, `days_to_expiry ≈ 129`

**Filas normalizadas (CSV):**

```
ts,product_id,contract_id,symbol,display_symbol,root,month_code,year_two,year_full,exchange,description,multiplier,expiration_mmy,expiration_ts,last_close_date_ts,first_trade_date_ts,settlement_date_ts,settlement_start_time,tradability,state,days_to_expiry,contract_rank,is_active,source_url
1731297812000,f5e6b1cd-3d23-4add-8c51-385dd953a850,c4021dc3-bc5c-4252-a5b9-209572a1cb78,"/MESZ25:XCME","/MESZ25","MES","Z",25,2025,"XCME","Micro E-mini S&P 500 Futures, Dec-25",5,"202512",1766102400000,1766102400000,1714521600000,1766102400000,"08:30","FUTURES_TRADABILITY_TRADABLE","FUTURES_STATE_ACTIVE",38,1,true,"https://api.robinhood.com/arsenal/v1/futures/contracts?productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850"
1731297812000,f5e6b1cd-3d23-4add-8c51-385dd953a850,bd2b6728-a24d-448a-a2bc-655c18d8f5e8,"/MESH26:XCME","/MESH26","MES","H",26,2026,"XCME","Micro E-mini S&P 500 Futures, Mar-26",5,"202603",1773964800000,1773964800000,1714521600000,1773964800000,"08:30","FUTURES_TRADABILITY_TRADABLE","FUTURES_STATE_ACTIVE",129,2,true,"https://api.robinhood.com/arsenal/v1/futures/contracts?productIds=f5e6b1cd-3d23-4add-8c51-385dd953a850"
```

> Notas:
>
> * `ts` = momento de ingestión.
> * Los `*_ts` son en **UTC** (convierte las fechas `YYYY-MM-DD` a medianoche UTC).
> * `days_to_expiry` calculado con respecto a **ahora UTC** en la corrida.
> * Si prefieres no sobreescribir `latest.csv`, puedes mantener un symlink o escribir atómicamente.

---

## Pseudocódigo de normalización (TypeScript)

```ts
function parseDisplay(display: string) {
  // "/MESZ25" -> { root:"MES", month:"Z", yearTwo:25 }
  const core = display.startsWith('/') ? display.slice(1) : display;
  const m = /^([A-Z]+)([FGHJKMNQUVXZ])(\d{2})$/.exec(core);
  if (!m) throw new Error(`displaySymbol inesperado: ${display}`);
  return { root: m[1], month: m[2], yearTwo: Number(m[3]) };
}

function y2toY4(y2: number) { return (y2 < 70 ? 2000 + y2 : 1900 + y2); }

function toEpoch(dateYYYYMMDD: string) {
  return Date.parse(`${dateYYYYMMDD}T00:00:00Z`);
}

function normaliseContracts(env: Envelope): FuturesContractRow[] {
  const now = Date.now();
  const results: FuturesContractRaw[] = env.payload.results;
  const byProduct = new Map<string, FuturesContractRaw[]>();
  for (const r of results) {
    const arr = byProduct.get(r.productId) ?? [];
    arr.push(r);
    byProduct.set(r.productId, arr);
  }

  const rows: FuturesContractRow[] = [];
  for (const [productId, arr] of byProduct) {
    // ordenar por expiration asc
    arr.sort((a,b)=> toEpoch(a.expiration)-toEpoch(b.expiration));
    arr.forEach((r, i) => {
      const exch = r.symbol.includes(':') ? r.symbol.split(':')[1] : null;
      const { root, month, yearTwo } = parseDisplay(r.displaySymbol);
      const yearFull = y2toY4(yearTwo);
      const expiration_ts = toEpoch(r.expiration);
      const last_close_date_ts = toEpoch(r.customerLastCloseDate);
      const first_trade_date_ts = toEpoch(r.firstTradeDate);
      const settlement_date_ts = toEpoch(r.settlementDate);
      const days_to_expiry = Math.floor((expiration_ts - now) / 86400000);

      rows.push({
        ts: env.ts,
        product_id: productId,
        contract_id: r.id,
        symbol: r.symbol,
        display_symbol: r.displaySymbol,
        root, month_code: month,
        year_two: yearTwo, year_full: yearFull,
        exchange: exch,
        description: r.description ?? null,
        multiplier: Number(r.multiplier),
        expiration_mmy: r.expirationMmy,
        expiration_ts, last_close_date_ts, first_trade_date_ts, settlement_date_ts,
        settlement_start_time: r.settlementStartTime,
        tradability: r.tradability,
        state: r.state,
        days_to_expiry,
        contract_rank: i + 1,
        is_active: r.state === 'FUTURES_STATE_ACTIVE',
      });
    });
  }
  return rows;
}
```

---