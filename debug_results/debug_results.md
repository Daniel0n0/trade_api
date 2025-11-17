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



PUNTO 36:

Perfecto, esta está buenísima porque define el **calendario de trading**, que luego tus otros módulos (quotes, opciones, órdenes) necesitan para saber si se puede operar o no.

---

## 1. Clasificación rápida

* **Endpoint:** `GET /markets/XASE/hours/2025-11-13/`
* **Transporte:** `http`
* **Dominio:** `market_hours / calendar`
* **Granularidad:** por **día** y por **mercado** (`XASE`)
* **Uso dentro del proyecto:**

  * Saber si el mercado está abierto ahora.
  * Saber si estamos en **regular session / extended hours / FX / index options curb**.
  * Evitar lanzar órdenes fuera de horario permitido.

---

## 2. Esquema de la respuesta (schema)

Payload crudo:

```ts
type MarketHoursResponse = {
  date: string;                         // "2025-11-13"
  is_open: boolean;                     // true | false

  opens_at: string;                     // "2025-11-13T14:30:00Z"  (regular open)
  closes_at: string;                    // "2025-11-13T21:00:00Z"  (regular close)

  late_option_closes_at: string | null; // "2025-11-13T21:15:00Z"

  extended_opens_at: string | null;     // "2025-11-13T12:00:00Z"
  extended_closes_at: string | null;    // "2025-11-14T01:00:00Z"

  all_day_opens_at: string | null;      // "2025-11-13T01:00:00Z"
  all_day_closes_at: string | null;     // "2025-11-14T01:00:00Z"

  previous_open_hours: string | null;   // url
  next_open_hours: string | null;       // url

  index_option_0dte_closes_at: string | null;      // "2025-11-13T21:00:00Z"
  index_option_non_0dte_closes_at: string | null;  // "2025-11-13T21:15:00Z"

  index_options_extended_hours?: {
    curb_opens_at: string | null;       // "2025-11-13T21:15:00Z"
    curb_closes_at: string | null;      // "2025-11-13T22:00:00Z"
  };

  fx_opens_at: string | null;           // "2025-11-12T22:00:00Z"
  fx_closes_at: string | null;          // "2025-11-13T22:00:00Z"
  fx_is_open: boolean;

  fx_next_open_hours: string | null;    // "2025-11-13T22:00:00Z"
};
```

---

## 3. Cómo recibirla (handler → Envelope)

La envolvemos en tu `Envelope` estándar, pero aquí no hay `symbol`, sino **market**.

```ts
type MarketHoursEnvelope = Envelope & {
  market: string;  // ej. "XASE"
};

async function fetchMarketHours(
  client: HttpClient,
  market: string,
  date: string,
): Promise<MarketHoursEnvelope> {
  const url = `https://api.robinhood.com/markets/${market}/hours/${date}/`;
  const text = await client.getText(url);
  const json = safeJsonParse<MarketHoursResponse>(text);

  return {
    ts: Date.now(),
    transport: 'http',
    source: url,
    topic: 'market_hours',
    symbol: undefined,
    payload: json,
    market,
  };
}
```

---

## 4. Normalización y procesamiento

### 4.1. Conversión de fechas

Todas las fechas vienen en ISO UTC → conviene pasar a **epoch ms** y tener **flag de sesión** listo para que el engine pregunte “¿estoy dentro del horario X?”.

Creamos una fila plana:

```ts
type MarketHoursRow = {
  market: string;       // "XASE"
  date: string;         // "2025-11-13"

  is_open: boolean;

  opens_at: number | null;
  closes_at: number | null;

  late_option_closes_at: number | null;

  extended_opens_at: number | null;
  extended_closes_at: number | null;

  all_day_opens_at: number | null;
  all_day_closes_at: number | null;

  index_option_0dte_closes_at: number | null;
  index_option_non_0dte_closes_at: number | null;

  index_curb_opens_at: number | null;
  index_curb_closes_at: number | null;

  fx_is_open: boolean;
  fx_opens_at: number | null;
  fx_closes_at: number | null;
  fx_next_open_hours: number | null;

  previous_open_hours_url: string | null;
  next_open_hours_url: string | null;

  fetched_ts: number;            // cuándo lo leímos
  source_transport: 'http';
  source_url: string;
};
```

Helper para parsear:

```ts
const toMs = (s: string | null | undefined): number | null =>
  s ? Date.parse(s) : null;

function normaliseMarketHours(env: MarketHoursEnvelope): MarketHoursRow {
  const h = env.payload as MarketHoursResponse;

  return {
    market: env.market,
    date: h.date,
    is_open: h.is_open,

    opens_at: toMs(h.opens_at),
    closes_at: toMs(h.closes_at),

    late_option_closes_at: toMs(h.late_option_closes_at),

    extended_opens_at: toMs(h.extended_opens_at),
    extended_closes_at: toMs(h.extended_closes_at),

    all_day_opens_at: toMs(h.all_day_opens_at),
    all_day_closes_at: toMs(h.all_day_closes_at),

    index_option_0dte_closes_at: toMs(h.index_option_0dte_closes_at),
    index_option_non_0dte_closes_at: toMs(h.index_option_non_0dte_closes_at),

    index_curb_opens_at: toMs(h.index_options_extended_hours?.curb_opens_at),
    index_curb_closes_at: toMs(h.index_options_extended_hours?.curb_closes_at),

    fx_is_open: h.fx_is_open,
    fx_opens_at: toMs(h.fx_opens_at),
    fx_closes_at: toMs(h.fx_closes_at),
    fx_next_open_hours: toMs(h.fx_next_open_hours),

    previous_open_hours_url: h.previous_open_hours,
    next_open_hours_url: h.next_open_hours,

    fetched_ts: env.ts,
    source_transport: env.transport,
    source_url: env.source,
  };
}
```

Con esto, en tiempo real puedes preguntar:

```ts
function isWithinRegularHours(row: MarketHoursRow, nowMs: number): boolean {
  if (!row.is_open || row.opens_at == null || row.closes_at == null) return false;
  return nowMs >= row.opens_at && nowMs <= row.closes_at;
}

function isWithinExtendedHours(row: MarketHoursRow, nowMs: number): boolean {
  if (row.extended_opens_at == null || row.extended_closes_at == null) return false;
  return nowMs >= row.extended_opens_at && nowMs <= row.extended_closes_at;
}
```

Eso lo usarán tus módulos de **órdenes**, **estrategias**, etc., para saber si se permite operar.

---

## 5. ¿Se guarda o no? y ¿cómo?

### ¿Conviene guardarlo?

**Sí.** Razones:

* No cambia mucho, pero:

  * Hay días especiales (festivos, cierre temprano, etc.).
  * Te sirve para backtesting (“¿esta vela es rara porque el día tuvo horario parcial?”).
* Es poco volumen: 1 registro por día / mercado.

### Dónde y estructura de archivos

Yo lo separaría por **mercado**:

* Carpeta raíz de horarios:

  * `data/system/market_hours/`
* Dentro, por mercado:

  * `data/system/market_hours/XASE/2025.csv`
  * (y en 2026 → `XASE/2026.csv`, etc)

#### Formato CSV

`data/system/market_hours/XASE/2025.csv`:

```csv
date,market,is_open,opens_at,closes_at,late_option_closes_at,extended_opens_at,extended_closes_at,all_day_opens_at,all_day_closes_at,index_option_0dte_closes_at,index_option_non_0dte_closes_at,index_curb_opens_at,index_curb_closes_at,fx_is_open,fx_opens_at,fx_closes_at,fx_next_open_hours,previous_open_hours_url,next_open_hours_url,fetched_ts,source_transport,source_url
```

Cada fila = **un día**.

Regla de escritura:

* Si ya existe fila para `date + market`, puedes:

  * o hacer **upsert** en una base de datos,
  * o sobre-escribir el CSV completo si lo regeneras por rango,
  * o manejarlo como “append pero luego deduplicas” en ETL.

Dado que este endpoint lo puedes consultar “on demand”, también podrías:

* Guardar un **cache en memoria**,
* Y persistirlo sólo en CSV de vez en cuando (o cuando haya un festivo / cambio).

---

## 6. Integración con el resto de módulos

Este módulo de `market_hours` sirve como **servicio base** para el resto:

* **Módulo de orders:**

  * Antes de enviar una orden de acciones / opciones:

    * Chequea `isWithinRegularHours` o `isWithinExtendedHours`.
* **Módulo de options:**

  * Usa `late_option_closes_at`, `index_option_*` y `index_curb_*` para saber hasta cuándo puedes cerrar posiciones de índice / 0DTE.
* **Módulo de estrategias intradía:**

  * Evita abrir nuevas posiciones en los últimos X minutos antes del cierre (`closes_at`).
* **Backtesting:**

  * Saber si una vela está en premarket, regular, postmarket, o fuera de sesión.

---

## 7. Resumen para esta petición concreta

Para `GET /markets/XASE/hours/2025-11-13/`:

1. **Recibir** vía HTTP, parsear JSON a `MarketHoursResponse`.
2. Envolverlo en `MarketHoursEnvelope` con `market = "XASE"`.
3. **Normalizar** a `MarketHoursRow`:

   * convertir todos los `*_at` a `epoch ms`,
   * conservar URLs de `previous/next`.
4. **Guardar**:

   * CSV en `data/system/market_hours/XASE/2025.csv` (1 fila por día),
   * opcionalmente nada en `_raw` porque el payload es muy simple.
5. Usarlo como **única fuente de verdad de horarios de ese mercado** dentro de tu proyecto.

---