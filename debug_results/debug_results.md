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



PUNTO 7:
¡Perfecto! ORDEN DEL MOMENTO — **Módulo “opciones avanzadas (SPY)”** · **Ampliación con tus nuevos frames**

Solo uso lo que enviaste. Hay nuevos `FEED_DATA` con:

* **channel 13** · `eventType: "Summary"` con campos:
  `dayClosePrice, dayLowPrice, dayOpenPrice, dayHighPrice, eventSymbol, eventType, prevDayClosePrice, prevDayVolume, openInterest`
* **channel 9** · `eventType: "Quote"` con campos:
  `askPrice, askSize, askTime, bidPrice, bidSize, bidTime, eventSymbol, eventType`
* **channel 11** · `eventType: "Greeks"` con campos:
  `delta, eventSymbol, eventType, gamma, volatility, rho, theta, time, vega`
* **channel 1** · `eventType: "Trade"` con **símbolos de opciones** y campos:
  `price, dayVolume, eventSymbol, eventType, time`
  (en tus ejemplos, `dayVolume` puede ser número **o** la cadena `"NaN"`; se guarda tal cual)
* **channel 1 / 3** · `Trade`/`TradeETH` de **subyacente SPY** (ya definidos antes)
* **channel 0** · `KEEPALIVE` (ya definido)

> Con lo que enviaste, **todas las opciones** vienen con `eventSymbol` que **empieza por `.`** (ej.: `.SPY251114C669`). Úsalo como criterio de ruteo para “opciones” (criterio literal basado en tu data).

---

# 1) Dónde guardarlo (directorios)

Para **SPY** (stocks) y día UTC del frame:

```
data/
└─ stocks/
   └─ SPY/
      └─ <YYYY-MM-DD>/
         ├─ legend/
         │  ├─ raw/
         │  │  └─ ws_connect_<epoch_ms>.txt
         │  ├─ keepalive.csv
         │  ├─ trades_spy.jsonl        (eventType=Trade, eventSymbol="SPY", channel 1)
         │  ├─ trades_spy_eth.jsonl    (eventType=TradeETH, eventSymbol="SPY", channel 3)
         │  ├─ options_trades.jsonl    (eventType=Trade, eventSymbol que inicia por ".", channel 1)
         │  ├─ options_quotes.jsonl    (eventType=Quote, channel 9)
         │  ├─ options_summaries.jsonl (eventType=Summary, channel 13)
         │  └─ options_greeks.jsonl    (eventType=Greeks, channel 11)
         └─ options/
            └─ by_symbol/
               └─ <EVENT_SYMBOL_LITERAL>/
                  ├─ trades.jsonl
                  ├─ quotes.jsonl
                  ├─ summaries.jsonl
                  └─ greeks.jsonl
```

* **`by_symbol`** usa el **literal** de `eventSymbol` (incluido el punto). No se parsea la fecha de expiración ni strike (no asumimos nada).
* La carpeta `<YYYY-MM-DD>` se determina por el tiempo del frame (`time` o `askTime/bidTime`/`ts_ms`) en **UTC**.

---

# 2) Cómo recibir y procesar (exacto, sin suposiciones)

* **Filtra por URL**: solo procesa si `url === "wss://api.robinhood.com/marketdata/streaming/legend/"`.
* **Handshake**: guarda request/response en `legend/raw/ws_connect_<epoch_ms>.txt` (redacta `Authorization`).
* **Frames**:

  * `type === "KEEPALIVE"` y `channel === 0` → append a `keepalive.csv`.
  * `type === "FEED_DATA"` con `data` arreglo → para **cada objeto** de `data`:

    * **Opciones (símbolo inicia por `.`)**:

      * `eventType === "Trade"` (channel 1) → `legend/options_trades.jsonl` y **también** `options/by_symbol/<eventSymbol>/trades.jsonl`.
      * `eventType === "Quote"` (channel 9) → `legend/options_quotes.jsonl` y `.../quotes.jsonl`.
      * `eventType === "Summary"` (channel 13) → `legend/options_summaries.jsonl` y `.../summaries.jsonl`.
      * `eventType === "Greeks"` (channel 11) → `legend/options_greeks.jsonl` y `.../greeks.jsonl`.
    * **Subyacente SPY (eventSymbol === "SPY")**:

      * `eventType === "Trade"` (channel 1) → `legend/trades_spy.jsonl`.
      * `eventType === "TradeETH"` (channel 3) → `legend/trades_spy_eth.jsonl`.
    * Cualquier otro `eventType`/campos → **ignorar** (no se guarda).

> No se derivan campos ni se normalizan valores: si `dayVolume` viene como `"NaN"`, se guarda **"NaN"**.

---

# 3) Esquemas de archivos (tipado y estructura)

## `keepalive.csv` (CSV)

Columnas:

```
ts_ms,date_utc,ws_url,channel,type
```

## JSONL de opciones (una línea por objeto recibido, sin modificar claves)

### `legend/options_trades.jsonl`  (channel 1, `eventType: "Trade"` con símbolo de opción)

Ejemplo (de tus mensajes):

```json
{"channel":1,"eventType":"Trade","eventSymbol":".SPY251114C700","price":0.03,"dayVolume":9254.0,"time":1762895685329}
```

> Nota: `dayVolume` puede ser número o la cadena `"NaN"`.

### `legend/options_quotes.jsonl`  (channel 9, `eventType: "Quote"`)

```json
{"channel":9,"eventType":"Quote","eventSymbol":".SPY251114P669","askPrice":0.44,"askSize":339.0,"askTime":1762895699000,"bidPrice":0.43,"bidSize":147.0,"bidTime":1762895700000}
```

### `legend/options_summaries.jsonl`  (channel 13, `eventType: "Summary"`)

```json
{"channel":13,"eventType":"Summary","eventSymbol":".SPY251114C669","dayClosePrice":15.22,"dayLowPrice":11.65,"dayOpenPrice":12.53,"dayHighPrice":15.22,"prevDayClosePrice":13.85,"prevDayVolume":856.0,"openInterest":2326}
```

### `legend/options_greeks.jsonl`  (channel 11, `eventType: "Greeks"`)

```json
{"channel":11,"eventType":"Greeks","eventSymbol":".SPY251114P669","delta":-0.0881810723238528,"gamma":0.01488693155056913,"volatility":0.1781222921119322,"rho":-0.00472942553333986,"theta":-0.301884576819244,"time":1762909161782,"vega":0.0964716472026524}
```

## JSONL del subyacente SPY (ya definidos)

* `legend/trades_spy.jsonl` (channel 1, `eventType:"Trade"`, `eventSymbol:"SPY"`)
* `legend/trades_spy_eth.jsonl` (channel 3, `eventType:"TradeETH"`, `eventSymbol:"SPY"`)

## Per-símbolo (opcional pero definido arriba)

Mismo contenido que los *legend/options_*.jsonl, pero separado por `eventSymbol`:

* `data/stocks/SPY/<YYYY-MM-DD>/options/by_symbol/<EVENT_SYMBOL_LITERAL>/trades.jsonl`
* `.../quotes.jsonl`, `.../summaries.jsonl`, `.../greeks.jsonl`

---

# 4) Reglas de guardado

* `raw/` es inmutable (nuevo fichero por conexión).
* Los `.jsonl` y el `keepalive.csv` son **append-only**.
* La fecha `<YYYY-MM-DD>` se toma del campo de tiempo del propio frame (por ejemplo `time`, `askTime`, `bidTime`) en **UTC**.
* No se eliminan ni corrigen líneas; si hay mensajes repetidos, se guardan repetidos (no se asume de-duplicación).

---

# 5) Funciones (qué hacen y qué devuelven)

* `isLegendUrl(url: string): boolean`
  → `true` solo para `"wss://api.robinhood.com/marketdata/streaming/legend/"`.

* `onLegendOpen(handshake, nowMs): void`
  → Escribe `legend/raw/ws_connect_<nowMs>.txt` (sin `Authorization`).

* `routeLegendFrame(msg: object, url: string): void`

  * Si no es `isLegendUrl(url)` → return.
  * Si `msg.type === "KEEPALIVE" && msg.channel === 0` → **append** `keepalive.csv`.
  * Si `msg.type === "FEED_DATA"` y `Array.isArray(msg.data)`:

    * Itera cada `item` de `msg.data`:

      * Si `item.eventSymbol` **empieza por `"."`** ⇒ **opciones**:

        * `item.eventType === "Trade"`    → `legend/options_trades.jsonl` + per-símbolo `trades.jsonl`.
        * `item.eventType === "Quote"`    → `legend/options_quotes.jsonl` + per-símbolo `quotes.jsonl`.
        * `item.eventType === "Summary"`  → `legend/options_summaries.jsonl` + per-símbolo `summaries.jsonl`.
        * `item.eventType === "Greeks"`   → `legend/options_greeks.jsonl` + per-símbolo `greeks.jsonl`.
        * Otro `eventType` → ignorar.
      * Si `item.eventSymbol === "SPY"`:

        * `item.eventType === "Trade"`    → `legend/trades_spy.jsonl`.
        * `item.eventType === "TradeETH"` → `legend/trades_spy_eth.jsonl`.
        * Otro `eventType` → ignorar.
      * En cualquier otro caso → ignorar.

Todas devuelven `void`. En error de I/O: log y continuar.

---

# 6) Interacciones con otros módulos/archivos

* Escribe **solo** dentro de `data/stocks/SPY/<YYYY-MM-DD>/legend/` y `data/stocks/SPY/<YYYY-MM-DD>/options/by_symbol/...`.
* No toca `data/futures/*` ni `options/in_the_future/*` hasta que envíes peticiones que los requieran.
* No calcula ni guarda campos derivados (por ejemplo, expiraciones o strikes) a partir de `eventSymbol`.

---