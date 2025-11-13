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


PUNTO 2:
¡Vamos! **ORDEN DEL MOMENTO** aplicada a la **Petición 2 (Legend WS)** + **sistema de directorios** que pediste.

# Sistema de directorios (añadido)

```
data/
├─ futures/
│  └─ <FUTURO>/                        # p.ej. MES, MNQ, ES
│     └─ <YYYY-MM-DD>/                 # fechas salvadas
│        ├─ 1s.csv
│        ├─ 1m.csv
│        ├─ 5m.csv
│        ├─ 15m.csv
│        ├─ 1h.csv
│        ├─ 1d.csv
│        ├─ quotes.csv                 # libro top (bid/ask) si aplica
│        └─ raw.jsonl                  # opcional, frames brutos útiles p/depurar
└─ stocks/
   └─ <TICKER>/                        # p.ej. SPY, AAPL
      └─ <YYYY-MM-DD>/
         ├─ 1s.csv
         ├─ 1m.csv
         ├─ 5m.csv
         ├─ 15m.csv
         ├─ 1h.csv
         ├─ 1d.csv
         ├─ quotes.csv                 # NBBO top (bid/ask)
         ├─ news.jsonl                 # noticias del día
         ├─ greeks.jsonl               # IV/greeks si los capturas
         └─ options/
            ├─ strikes.csv             # snapshot strikes del día
            └─ in_the_future/
               └─ <YYYY-MM-DD>/        # próximos vencimientos (hasta 2 semanas)
                  └─ chain.jsonl
```

---

# Fuente: `wss://api.robinhood.com/marketdata/streaming/legend/`

### Lo que llega (del ejemplo real)

* **type**: `"FEED_DATA"` o `"KEEPALIVE"`.
* **channel**: entero (1=candles, 3=Trade (REG), 5=TradeETH, 7=Quotes, 0=Keepalive).
* **data**: array de eventos.
* **eventType**: `"Candle" | "Trade" | "TradeETH" | "Quote"`.
* **eventSymbol**:

  * Velas: `SPY{=1s|m|5m|15m|h, tho=false, a=m}`
  * Trades/ETH: `SPY`
  * Quotes: `SPY`
* **Campos útiles por tipo**:

  * **Candle**: `time, open, high, low, close, volume, vwap, impVolatility, openInterest, count`
  * **Trade/TradeETH**: `time, price, dayVolume`
  * **Quote**: `bidPrice, bidSize, bidTime, askPrice, askSize, askTime`

---

# Estructura de datos (tipos TS recomendados)

```ts
type LegendMessage =
  | { type: 'KEEPALIVE'; channel: 0 }
  | { type: 'FEED_DATA'; channel: number; data: any[] };

type CandleFrame = {
  eventType: 'Candle';
  eventSymbol: string;       // ej. "SPY{=5m,tho=false,a=m}"
  time: number;              // epoch ms del inicio de la vela
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;            // volumen acumulado de la vela
  vwap?: number | 'NaN';
  impVolatility?: number | 'NaN';
  openInterest?: number | 'NaN';
  count?: number;            // nº de trades
};

type TradeFrame = {
  eventType: 'Trade' | 'TradeETH';
  eventSymbol: string;       // "SPY"
  time: number;              // epoch ms del trade
  price: number;
  dayVolume: number;
};

type QuoteFrame = {
  eventType: 'Quote';
  eventSymbol: string;       // "SPY"
  bidPrice: number;
  bidSize: number;
  bidTime: number;
  askPrice: number;
  askSize: number;
  askTime: number;
};
```

---

# Recepción (cómo recibir)

* Filtra por URL que **contenga** `/marketdata/streaming/legend/`.
* Suscríbete a `framereceived` y `framesent`. Cada `payload`:

  1. Si es `Buffer` → `toString('utf8')`.
  2. `JSON.parse`.
  3. Si `type === 'KEEPALIVE'` → marcar “alive” y seguir.
  4. Si `type === 'FEED_DATA'`:

     * Recorrer `data[]`.
     * `eventType` decide el **router**:

       * `"Candle"` → **módulo de velas**.
       * `"Trade"/"TradeETH"` → **módulo de ticks** (opcional).
       * `"Quote"` → **módulo de quotes**.

---

# Procesamiento (qué hacer con cada tipo)

## A) Velas (`eventType: "Candle"`)

* **Derivar timeframe** desde `eventSymbol`:

  * `=s` → `1s.csv`
  * `=m` → `1m.csv`
  * `=5m` → `5m.csv`
  * `=15m` → `15m.csv`
  * `=h` → `1h.csv`
  * `=d` (si apareciera) → `1d.csv`
* **Timestamp**: `time` ya viene **alineado** al bucket (ms). Usa ese valor sin “floor”.
* **Normalización**:

  * Convierte `"NaN"` a vacío (o `null`) para CSV.
  * `vwap` y `impVolatility` → números o vacío.
* **Upsert** (por `time`):

  * Si `time` ya existe en el CSV del timeframe, **reemplaza** fila (Legend suele reenviar los últimos buckets en vivo).
  * Si no existe, **append**.
* **Consistencia**:

  * Si recibes varias temporalidades, escribe en sus CSV correspondientes, **no re-agregues** 1s→1m; usa la vela ya calculada que llega.
* **CSV schema** por timeframe:

  ```
  time,open,high,low,close,volume,vwap,impVolatility,openInterest,count
  1762911000000,683.68,683.68,683.68,683.68,5,683.68,0.1725,,1
  ```

  * `time` en **epoch ms** (evita zona horaria).
  * Vacíos como `""` para NaN.

## B) Quotes (`eventType: "Quote"`)

* Guarda **top-of-book** (NBBO simple):

  * Unifica `bidTime`/`askTime` en `time` = `Math.max(bidTime, askTime)`.
  * CSV (una fusión por línea):

    ```
    time,bidPrice,bidSize,askPrice,askSize
    1762911062000,683.65,826,683.78,707
    ```
* **Frecuencia**: pueden llegar por ráfagas → puedes muestrear (p.ej., cada 100 ms última quote) si el volumen es muy alto.

## C) Trades (`"Trade"` y `"TradeETH"`)

* Opcional guardar ticks por carga de datos. Si lo haces:

  ```
  time,price,dayVolume,session   # session = REG | ETH
  1762911062525,683.65,2380,ETH
  ```
* **Uso**: validación rápida de velas/volúmenes.

## D) KEEPALIVE

* Solo **marca salud** (último keepalive). No persistas.

---

# ¿Se guarda? ¿cómo?

### Stocks (SPY en tu caso)

* Ruta del día: `data/stocks/SPY/<YYYY-MM-DD>/`

  * `1s.csv, 1m.csv, 5m.csv, 15m.csv, 1h.csv, 1d.csv`
  * `quotes.csv`
  * `ticks.csv` (opcional)
  * `raw.jsonl` (opcional, últimos N frames para depurar)
* **Política de escritura**:

  * **Upsert por `time`** (lee el último bloque a memoria, reemplaza si coincide).
  * **Flush**: cada 1–5 segundos para no fragmentar disco.
  * **Rotación**: un directorio por fecha (UTC), al pasar de fecha crea carpeta nueva.

### Futuros (si capturas de Legend u otro feed)

* Idéntico layout pero bajo `data/futures/<CONTRATO>/<YYYY-MM-DD>/...`

---

# Interacción entre archivos (quién usa a quién y por qué)

* `1s.csv`/`1m.csv`/…: **consumidos** por tus módulos de señales/estrategias (backtest o live).
* `quotes.csv`: usado por lógica de **microestructura** (spreads/slippage) y validación de entrada.
* `ticks.csv` (opcional): para *replay* y auditoría fina.
* `news.jsonl`, `greeks.jsonl`, `options/…`: otros módulos; **no** impactan el pipeline de velas, pero comparten la misma carpeta de fecha para que todo el **estado diario** quede junto.

---

# Contratos (lo que “se espera” de funciones y qué devuelven)

### `parseEventSymbol(symbol: string) => { ticker: string; tf: '1s'|'1m'|'5m'|'15m'|'1h'|'1d' }`

* Extrae timeframe (`=s|m|5m|15m|h|d`) y ticker.
* Se usa en router de velas.

### `upsertCandle(csvPath: string, row: CandleCsvRow) => Promise<void>`

* Garantiza **idempotencia** por `time`.
* Devuelve `void`; lanza error si I/O falla.

### `appendQuote(csvPath: string, row: QuoteCsvRow) => Promise<void>`

* **Append** directo (o muestreo previo).
* Devuelve `void`.

### `appendTick(csvPath: string, row: TickCsvRow) => Promise<void>`

* **Append** directo.
* Devuelve `void`.

### `markKeepalive(feed: 'legend', ts: number): void`

* Actualiza health en memoria, usado por watchdog/reconexión.

---

# Reglas y bordes importantes

* **NaN**: llega como string `"NaN"`. Escribe vacío en CSV → evita `NaN` textual para no romper parsers.
* **Orden de llegada**: Legend puede **reemitir** velas recientes con agregados (cambian `volume`, `high/low`, `count`). **Por eso upsert.**
* **Sesiones**: `Trade` (REG) vs `TradeETH` (after-hours). No mezcles en agregaciones propias (pero tus **velas Legend ya vienen correctas** por sesión).
* **Canal** no es contrato: usa **`eventType`** y **`eventSymbol`** como verdad.
* **Tiempo**: usa `time` (ms) del evento (no `Date.now()`).
* **Compresión** (opcional): al finalizar el día, gzip los CSV.

---

# Ejemplo de filas (con tus datos)

**5m.csv**

```
time,open,high,low,close,volume,vwap,impVolatility,openInterest,count
1762911000000,683.68,683.68,683.68,683.68,5,683.68,0.1725,,1
1762911000000,683.68,683.68,683.65,683.65,125,683.6512,0.1725,,3   # upsert reemplaza a la anterior
```

**1m.csv**

```
time,open,high,low,close,volume,vwap,impVolatility,openInterest,count
1762911000000,683.68,683.68,683.68,683.68,5,683.68,0.1725,,1
1762911060000,683.65,683.65,683.65,683.65,120,683.65,0.1725,,2
```

**1s.csv**

```
time,open,high,low,close,volume,vwap,impVolatility,openInterest,count
1762911059000,683.68,683.68,683.68,683.68,5,683.68,,,
1762911062000,683.65,683.65,683.65,683.65,120,683.65,,,
```

**quotes.csv**

```
time,bidPrice,bidSize,askPrice,askSize
1762911060000,683.63,201,683.65,120
1762911061000,683.64,94,683.65,120
1762911062000,683.65,826,683.78,707
1762911064000,683.67,795,683.80,729
```

**ticks.csv** (opcional)

```
time,price,dayVolume,session
1762911059615,683.68,2260,ETH
1762911062525,683.65,2380,ETH
1762894799967,682.87,2380,REG
```

---