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



PUNTO 26:
¡Perfecto, Amo! Vamos a integrar este **módulo de horarios de mercado** (XASE) en tu canal “vista general de futuros”.

---

# 1) Clasificación rápida

* **Origen/Transporte**: `http` (JSON)
* **Dominio**: `market_hours`
* **Exchange**: `XASE`
* **Granularidad**: **diaria** (una fecha por payload)
* **Uso**: sincronizar ventanas de trading, filtrar barras/quotes por “mercado abierto”, detectar **feriados**, **early/late close** y **extended hours**.

---

# 2) Esquema de la data

### A. Raw (como llega)

```ts
type MarketHoursRaw = {
  date: string;                       // '2025-11-11' (día local del exchange)
  is_open: boolean;                   // true/false para sesión regular
  opens_at: string;                   // ISO UTC '2025-11-11T14:30:00Z'
  closes_at: string;                  // ISO UTC '2025-11-11T21:00:00Z'

  extended_opens_at: string | null;   // premarket start (UTC)
  extended_closes_at: string | null;  // after-hours end (UTC)

  late_option_closes_at?: string | null;
  index_option_0dte_closes_at?: string | null;
  index_option_non_0dte_closes_at?: string | null;

  index_options_extended_hours?: {
    curb_opens_at: string | null;     // “curb” (post 4:15pm ET) p/índices
    curb_closes_at: string | null;
  } | null;

  all_day_opens_at?: string | null;   // ventana agregada “todo el día” (UTC)
  all_day_closes_at?: string | null;

  fx_opens_at?: string | null;
  fx_closes_at?: string | null;
  fx_is_open?: boolean | null;
  fx_next_open_hours?: string | null; // ISO/UTC cuando vuelve a abrir FX

  previous_open_hours?: string;       // URL Robinhood del día anterior
  next_open_hours?: string;           // URL Robinhood del día siguiente
}
```

### B. Registro normalizado (Vista **diaria**)

*(una fila por exchange/fecha)*

```ts
type MarketHoursDay = {
  ts: number;                         // epoch ms de ingestión
  exchange: string;                   // 'XASE'
  date_local: string;                 // '2025-11-11' (America/New_York)
  tz_exchange: 'America/New_York';

  // Regular session
  is_open: 0 | 1;
  open_utc: string | null;
  close_utc: string | null;
  open_et: string | null;             // ISO con TZ 'ET'
  close_et: string | null;
  reg_minutes: number | null;         // duración en minutos (si aplica)

  // Extended
  ext_open_utc: string | null;
  ext_close_utc: string | null;
  ext_open_et: string | null;
  ext_close_et: string | null;
  ext_minutes: number | null;

  // Opciones (índices, late close)
  late_opt_close_utc: string | null;
  idx_opt_0dte_close_utc: string | null;
  idx_opt_non0dte_close_utc: string | null;
  curb_open_utc: string | null;
  curb_close_utc: string | null;

  // All-day window (si viene)
  all_day_open_utc: string | null;
  all_day_close_utc: string | null;

  // FX window
  fx_is_open: 0 | 1 | null;
  fx_open_utc: string | null;
  fx_close_utc: string | null;
  fx_next_open_utc: string | null;

  source_url: string;
};
```

### C. Registro normalizado (Vista **sesiones**)

*(una fila por **tramo**: PRE, REG, POST, LATE_OPT, IDX_CURB, etc.)*

```ts
type MarketHoursSession = {
  ts: number;
  exchange: string;                   // 'XASE'
  date_local: string;                 // día base del exchange
  session_type: 'PRE' | 'REG' | 'POST' | 'LATE_OPT' | 'IDX_0DTE' | 'IDX_NON0DTE' | 'IDX_CURB' | 'ALL_DAY' | 'FX';
  start_utc: string | null;
  end_utc: string | null;
  start_et: string | null;
  end_et: string | null;
  minutes: number | null;
  is_open_flag: 0 | 1 | null;         // si aplica
  source_url: string;
};
```

---

# 3) Cómo recibirla

* **Handler**: HTTP (pull programado diario + en apertura D-1 por cambios de feriado o DST).
* **Parsing**: `response.text()` → `safeJsonParse`.
* **Envelope**:

```ts
const env: Envelope = {
  ts: Date.now(),
  transport: 'http',
  source: 'https://api.robinhood.com/markets/XASE/hours/2025-11-11/',
  topic: 'market_hours',
  payload: json
};
```

---

# 4) Procesamiento (normalización y validaciones)

### A. Validaciones

* `date` no vacío y formateable.
* Si `is_open===true` ⇒ `opens_at` y `closes_at` deben existir y `opens_at < closes_at`.
* Timestamps ISO válidos (UTC, terminados en `Z`).
* Permitir `null` en campos opcionales (extended, fx, curb, etc.).

### B. Conversiones y derivados

* **Zona horaria**: convierte cada `*_utc` a **ET** (`America/New_York`) → `*_et`.
* **Duraciones** en minutos: `(end - start)/60_000`, `null` si no aplica.
* **Sesiones**:

  * **PRE**: `extended_opens_at` → `opens_at` (si premarket antecede a la regular; en XASE: `extended_opens_at=12:00Z` ⇒ 7:00 ET).
  * **REG**: `opens_at` → `closes_at`.
  * **POST**: `closes_at` → `extended_closes_at`.
  * **LATE_OPT**: `late_option_closes_at` (solo `end`; usa `closes_at` como `start`).
  * **IDX_0DTE** / **IDX_NON0DTE**: ventanas de cierre diferenciado; start = `closes_at`, end = el respectivo `close`.
  * **IDX_CURB**: `index_options_extended_hours.curb_opens_at` → `curb_closes_at`.
  * **ALL_DAY**: si viene `all_day_*`.
  * **FX**: `fx_opens_at` → `fx_closes_at` (si existen).
* **Consistencia**: cualquier ventana con `start>=end` ⇒ descarta o marca `minutes=0` y log de advertencia.

### C. Salidas

* **Vista diaria** (1 fila) y **vista sesiones** (N filas por tramos detectados).
* **Idempotencia**: clave `(exchange, date_local, session_type, start_utc)`.

---

# 5) ¿Se guarda? Sí

### A. Diario (estado/ventanas del día)

```
data/calendars/market_hours/<EXCHANGE>/<YYYY>/<MM>.csv
```

* **Archivo mensual** por exchange; **append**/upsert por `date_local`.
* **Columnas** = `MarketHoursDay` en orden:

```
ts,exchange,date_local,tz_exchange,is_open,open_utc,close_utc,open_et,close_et,reg_minutes,
ext_open_utc,ext_close_utc,ext_open_et,ext_close_et,ext_minutes,
late_opt_close_utc,idx_opt_0dte_close_utc,idx_opt_non0dte_close_utc,
curb_open_utc,curb_close_utc,all_day_open_utc,all_day_close_utc,
fx_is_open,fx_open_utc,fx_close_utc,fx_next_open_utc,source_url
```

### B. Sesiones (una fila por tramo)

```
data/calendars/market_hours_sessions/<EXCHANGE>/<YYYY>/<MM>/<YYYY-MM-DD>.csv
```

* **Columnas** = `MarketHoursSession`.

### C. Crudo opcional (auditoría)

```
data/_raw/market_hours/XASE/2025-11/2025-11-11.json
```

---

# 6) Pseudocódigo (TypeScript)

```ts
function toET(isoUtc: string | null): string | null {
  if (!isoUtc) return null;
  // usar lib de TZ (luxon/dayjs-tz) para formatear a ET ISO
  return toTimeZoneIso(isoUtc, 'America/New_York');
}

function minutesBetween(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  return Math.max(0, (Date.parse(bIso) - Date.parse(aIso)) / 60000);
}

function normaliseMarketHoursXASE(env: Envelope): {
  day: MarketHoursDay,
  sessions: MarketHoursSession[]
} {
  const r = env.payload as MarketHoursRaw;
  const ex = 'XASE';
  const day: MarketHoursDay = {
    ts: env.ts,
    exchange: ex,
    date_local: r.date,
    tz_exchange: 'America/New_York',
    is_open: r.is_open ? 1 : 0,

    open_utc: r.opens_at ?? null,
    close_utc: r.closes_at ?? null,
    open_et: toET(r.opens_at ?? null),
    close_et: toET(r.closes_at ?? null),
    reg_minutes: minutesBetween(r.opens_at ?? null, r.closes_at ?? null),

    ext_open_utc: r.extended_opens_at ?? null,
    ext_close_utc: r.extended_closes_at ?? null,
    ext_open_et: toET(r.extended_opens_at ?? null),
    ext_close_et: toET(r.extended_closes_at ?? null),
    ext_minutes: minutesBetween(r.extended_opens_at ?? null, r.extended_closes_at ?? null),

    late_opt_close_utc: r.late_option_closes_at ?? null,
    idx_opt_0dte_close_utc: r.index_option_0dte_closes_at ?? null,
    idx_opt_non0dte_close_utc: r.index_option_non_0dte_closes_at ?? null,

    curb_open_utc: r.index_options_extended_hours?.curb_opens_at ?? null,
    curb_close_utc: r.index_options_extended_hours?.curb_closes_at ?? null,

    all_day_open_utc: r.all_day_opens_at ?? null,
    all_day_close_utc: r.all_day_closes_at ?? null,

    fx_is_open: r.fx_is_open == null ? null : (r.fx_is_open ? 1 : 0),
    fx_open_utc: r.fx_opens_at ?? null,
    fx_close_utc: r.fx_closes_at ?? null,
    fx_next_open_utc: r.fx_next_open_hours ?? null,

    source_url: env.source
  };

  const S: MarketHoursSession[] = [];

  // PRE
  if (r.extended_opens_at && r.opens_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'PRE',
    start_utc: r.extended_opens_at, end_utc: r.opens_at,
    start_et: toET(r.extended_opens_at), end_et: toET(r.opens_at),
    minutes: minutesBetween(r.extended_opens_at, r.opens_at),
    is_open_flag: 1, source_url: env.source
  });

  // REG
  if (r.opens_at && r.closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'REG',
    start_utc: r.opens_at, end_utc: r.closes_at,
    start_et: toET(r.opens_at), end_et: toET(r.closes_at),
    minutes: minutesBetween(r.opens_at, r.closes_at),
    is_open_flag: r.is_open ? 1 : 0, source_url: env.source
  });

  // POST
  if (r.closes_at && r.extended_closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'POST',
    start_utc: r.closes_at, end_utc: r.extended_closes_at,
    start_et: toET(r.closes_at), end_et: toET(r.extended_closes_at),
    minutes: minutesBetween(r.closes_at, r.extended_closes_at),
    is_open_flag: 1, source_url: env.source
  });

  // LATE_OPT
  if (r.late_option_closes_at && r.closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'LATE_OPT',
    start_utc: r.closes_at, end_utc: r.late_option_closes_at,
    start_et: toET(r.closes_at), end_et: toET(r.late_option_closes_at),
    minutes: minutesBetween(r.closes_at, r.late_option_closes_at),
    is_open_flag: 1, source_url: env.source
  });

  // IDX close windows
  if (r.index_option_0dte_closes_at && r.closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'IDX_0DTE',
    start_utc: r.closes_at, end_utc: r.index_option_0dte_closes_at,
    start_et: toET(r.closes_at), end_et: toET(r.index_option_0dte_closes_at),
    minutes: minutesBetween(r.closes_at, r.index_option_0dte_closes_at),
    is_open_flag: 1, source_url: env.source
  });
  if (r.index_option_non_0dte_closes_at && r.closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'IDX_NON0DTE',
    start_utc: r.closes_at, end_utc: r.index_option_non_0dte_closes_at,
    start_et: toET(r.closes_at), end_et: toET(r.index_option_non_0dte_closes_at),
    minutes: minutesBetween(r.closes_at, r.index_option_non_0dte_closes_at),
    is_open_flag: 1, source_url: env.source
  });

  // IDX_CURB
  if (r.index_options_extended_hours?.curb_opens_at && r.index_options_extended_hours?.curb_closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'IDX_CURB',
    start_utc: r.index_options_extended_hours.curb_opens_at,
    end_utc: r.index_options_extended_hours.curb_closes_at,
    start_et: toET(r.index_options_extended_hours.curb_opens_at),
    end_et: toET(r.index_options_extended_hours.curb_closes_at),
    minutes: minutesBetween(r.index_options_extended_hours.curb_opens_at, r.index_options_extended_hours.curb_closes_at),
    is_open_flag: 1, source_url: env.source
  });

  // ALL_DAY
  if (r.all_day_opens_at && r.all_day_closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'ALL_DAY',
    start_utc: r.all_day_opens_at, end_utc: r.all_day_closes_at,
    start_et: toET(r.all_day_opens_at), end_et: toET(r.all_day_closes_at),
    minutes: minutesBetween(r.all_day_opens_at, r.all_day_closes_at),
    is_open_flag: 1, source_url: env.source
  });

  // FX
  if (r.fx_opens_at && r.fx_closes_at) S.push({
    ts: env.ts, exchange: ex, date_local: r.date, session_type: 'FX',
    start_utc: r.fx_opens_at, end_utc: r.fx_closes_at,
    start_et: toET(r.fx_opens_at), end_et: toET(r.fx_closes_at),
    minutes: minutesBetween(r.fx_opens_at, r.fx_closes_at),
    is_open_flag: r.fx_is_open == null ? null : (r.fx_is_open ? 1 : 0),
    source_url: env.source
  });

  return { day, sessions: S };
}
```

---

# 7) Reglas de escritura

* **Crear** si no existe con encabezado; **append/upsert** por `date_local`.
* **CSV UTF-8**, sin compresión (para lecturas rápidas).
* **Tiempos**: conservar **UTC** y **ET**; ET facilita dashboards humanos.
* **Reproceso**: si la hora cambia por *holiday update* o *DST patch*, sobrescribe la fila del día (o upsert por clave).

---

# 8) Por qué guardar

* Controlas **aperturas/cierres** y **ventanas especiales** (late/curb/extended).
* Te permite **filtrar** barras/quotes en cálculos intradía y sincronizar **alertas** (no operar fuera de ventanas permitidas).
* Maneja **anomalías** (early close/feriados) sin hardcode.

---