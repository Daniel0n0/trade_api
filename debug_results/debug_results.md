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



PUNTO 6:
¡Vamos con la ORDEN DEL MOMENTO — Módulo “opciones avanzadas (SPY)” · **Petición 2** `wss://api.robinhood.com/marketdata/streaming/legend/`!

No asumo nada. Solo uso lo que enviaste: mensajes `KEEPALIVE` (channel 0) y `FEED_DATA` con `eventType` **Trade** (channel 1) y **TradeETH** (channel 3) para `eventSymbol: "SPY"` con campos: `price`, `dayVolume`, `eventSymbol`, `eventType`, `time`.

---

# 1) Dónde guardarlo (sistema de directorios)

Como es **por símbolo** (SPY), va en **stocks** con fecha (UTC del frame):

```
data/
└─ stocks/
   └─ SPY/
      └─ <YYYY-MM-DD>/
         └─ legend/
            ├─ raw/
            │  └─ ws_connect_<epoch_ms>.txt          # handshake request/response (sin Authorization)
            ├─ keepalive.csv                          # latidos del canal 0
            ├─ trades.jsonl                           # FEED_DATA eventType="Trade"
            └─ trades_eth.jsonl                       # FEED_DATA eventType="TradeETH"
```

> No mezclo con candles u otros tipos no presentes aquí. Solo guardo lo que enviaste.

---

# 2) Cómo recibir y procesar

**Filtro de URL exacto**

* Procesar **solo** si `url === "wss://api.robinhood.com/marketdata/streaming/legend/"`.

**Handshake**

* Guardar en `legend/raw/ws_connect_<epoch_ms>.txt`:

  * Línea “REQUEST” con URL y headers **sin** `Authorization`.
  * Separador.
  * Línea “RESPONSE” con status + headers.

**Frames**

* Cada frame debe ser un JSON con estructura `{ type, channel, data? }`.
* Ramas:

  1. `type === "KEEPALIVE"` → escribir fila en `keepalive.csv`.
  2. `type === "FEED_DATA"` y `Array.isArray(data)`:

     * Iterar elementos de `data`.
     * Si el objeto incluye **exactamente** los campos observados:

       * `eventSymbol` (ej. `"SPY"`)
       * `eventType` ∈ {`"Trade"`, `"TradeETH"`}
       * `price` (num)
       * `dayVolume` (num)
       * `time` (entero ms)
     * Guardar cada elemento:

       * `eventType === "Trade"` → `trades.jsonl` (una línea por objeto)
       * `eventType === "TradeETH"` → `trades_eth.jsonl`
     * Si aparece otro `eventType` **no** lo proceses ni guardes (no asumimos contrato).
* No hay transformaciones. Se guardan **tal cual** los valores.

---

# 3) Esquemas de archivos (exactos y mínimos)

## `keepalive.csv`

Columnas (en este orden):

```
ts_ms,date_utc,ws_url,channel,type
```

* `ts_ms`: epoch ms del frame.
* `date_utc`: `YYYY-MM-DD` derivado del `ts_ms`.
* `ws_url`: `wss://api.robinhood.com/marketdata/streaming/legend/`
* `channel`: `0`
* `type`: la cadena `"KEEPALIVE"`

**Ejemplo fila:**

```
1762912422316,2025-11-12,wss://api.robinhood.com/marketdata/streaming/legend/,0,KEEPALIVE
```

## `trades.jsonl`  (una línea por objeto)

Cada línea es un JSON **solo con los campos que viste**:

```json
{"channel":1,"eventSymbol":"SPY","eventType":"Trade","price":682.87,"dayVolume":2398,"time":1762894799967}
```

## `trades_eth.jsonl`

Igual, para `eventType: "TradeETH"` (ej. channel `3`):

```json
{"channel":3,"eventSymbol":"SPY","eventType":"TradeETH","price":683.65,"dayVolume":2398,"time":1762911120499}
```

> No añado columnas derivadas (timezone, flags, etc.). **No se asume nada**.

---

# 4) Reglas de guardado

* `raw/` → **inmutable**. Nombre con `<epoch_ms>` para unicidad.
* `keepalive.csv` → **append**.
* `trades.jsonl` y `trades_eth.jsonl` → **append** (una línea por evento).
* Si en una misma sesión hay múltiples días (por diferencias de hora), el `date_utc` del frame decide la carpeta `<YYYY-MM-DD>` destino.

---

# 5) Funciones (qué hacen y qué devuelven)

* `shouldProcessLegendWS(url: string): boolean`

  * Devuelve `true` **solo** para `"wss://api.robinhood.com/marketdata/streaming/legend/"`.

* `onLegendOpen(ctx): void`

  * Escribe el handshake en `legend/raw/ws_connect_<epoch_ms>.txt`.

* `onLegendFrame(json: unknown, url: string, ts_ms: number): void`

  * Si `type === "KEEPALIVE"` → escribe una fila en `keepalive.csv`.
  * Si `type === "FEED_DATA"` → para cada elemento de `data`:

    * Si `eventType === "Trade"` con los campos observados → append en `trades.jsonl`.
    * Si `eventType === "TradeETH"` con los campos observados → append en `trades_eth.jsonl`.
    * En cualquier otro caso → **ignorar** (sin logs ruidosos).

Todas devuelven `void`. En errores de I/O, log mínimo y continuar.

---

# 6) Interacciones con otros archivos/módulos

* **Directorio base** `data/stocks/SPY/<YYYY-MM-DD>/` es coherente con tu árbol (temporalidades/noticias/greeks irán en otras carpetas; **este stream** solo aporta **Trade / TradeETH**).
* No depende de futuros ni de la telemetría de órdenes (es independiente).
* Si después recibes **Candle** o **Quote** por este WS, se agregan archivos nuevos (p. ej. `candles_*.jsonl` o `quotes.jsonl`) pero **solo** cuando compartas esos mensajes (para no asumir).

---