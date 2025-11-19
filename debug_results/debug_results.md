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



Perfecto, aplico la **ORDEN DEL MOMENTO** a *esta misma petición de `legend`* pensando ya en que es la **fuente maestra** para sanear SPY y alimentar tus 5m/15m/1h. 

---

## 1. Estructura de la data (schema)

### a) Frame WS genérico

```ts
type LegendFrame =
  | FeedDataFrame
  | FeedConfigFrame;

type FeedDataFrame = {
  type: 'FEED_DATA';
  channel: number;              // 1=candles, 3=Trade, 5=TradeETH, 7=Quote (en tu captura)
  data: any[];                  // array de eventos homogéneos
};

type FeedConfigFrame = {
  type: 'FEED_CONFIG';
  channel: number;
  dataFormat: 'FULL';
  aggregationPeriod: number;    // 0.25, etc
  eventFields?: Record<string, string[]>;
};
```

### b) Eventos de `FEED_DATA`

```ts
type CandleEvent = {
  close: number;
  eventFlags: number;
  eventSymbol: string;    // p.ej "SPY{=d,a=m}" o "SPY{=h,tho=true,a=m}"
  eventType: 'Candle';
  eventTime: number;      // 0
  high: number;
  impVolatility: number;
  low: number;
  open: number;
  openInterest: string;   // "NaN"
  time: number;           // epoch ms del inicio del candle
  volume: number;
  vwap: number;
  sequence: number;
  count: number;
};

type TradeEvent = {
  price: number;
  dayVolume: number;
  eventSymbol: string;    // "SPY"
  eventType: 'Trade';
  time: number;           // epoch ms
};

type TradeEthEvent = {
  price: number;
  dayVolume: number;
  eventSymbol: string;
  eventType: 'TradeETH';
  time: number;
};

type QuoteEvent = {
  askPrice: number;
  askSize: number;
  askTime: number;
  bidPrice: number;
  bidSize: number;
  bidTime: number;
  eventSymbol: string;    // "SPY"
  eventType: 'Quote';
};
```

### c) Filtrado SPY

Aunque el stream puede mandar más símbolos, tú **solo procesas si `eventSymbol` empieza por `"SPY"`**.

---

## 2. Cómo recibirla

```ts
const ws = new WebSocket('wss://api.robinhood.com/marketdata/streaming/legend/', {
  headers: {
    'sec-websocket-protocol': `bearer, ${accessToken}`,
  },
});

ws.onmessage = (msg) => {
  const ts = Date.now();
  const payload = safeJsonParse(msg.data);
  if (!payload) return;

  const env: Envelope = {
    ts,
    transport: 'ws',
    source: 'wss://api.robinhood.com/marketdata/streaming/legend/',
    topic: `legend`,
    symbol: 'SPY',            // porque solo estás suscrito a SPY
    payload,
  };

  processLegendEnvelope(env);
};
```

> `Envelope` es el sobre estándar que ya definimos; este módulo solo implementa `processLegendEnvelope`.

---

## 3. Cómo procesarla (normalización + saneo base)

### a) Routing por tipo

```ts
function processLegendEnvelope(env: Envelope) {
  const frame = env.payload as LegendFrame;

  if (frame.type === 'FEED_CONFIG') {
    // opcional: guardar mapping channel->eventFields en memoria
    updateLegendConfig(frame);
    return;                 // no se persiste
  }

  if (frame.type !== 'FEED_DATA') return;

  for (const raw of frame.data) {
    switch (raw.eventType) {
      case 'Candle':
        handleSpyCandle(env, frame.channel, raw as CandleEvent);
        break;
      case 'Trade':
        handleSpyTrade(env, frame.channel, raw as TradeEvent, 'rth');
        break;
      case 'TradeETH':
        handleSpyTrade(env, frame.channel, raw as TradeEthEvent, 'eth');
        break;
      case 'Quote':
        handleSpyQuote(env, frame.channel, raw as QuoteEvent);
        break;
    }
  }
}
```

### b) Normalización Candle SPY (base para 5m/15m/1h)

```ts
function handleSpyCandle(env: Envelope, channel: number, e: CandleEvent) {
  // 1) validar
  if (!Number.isFinite(e.open) || !Number.isFinite(e.close)) return;
  if (typeof e.time !== 'number' || e.time <= 0) return;

  // 2) detectar timeframe por sufijo
  //   SPY{=d,a=m} -> 1d
  //   SPY{=h,tho=true,a=m} -> 1h (tu captura)
  const tf = detectTimeframe(e.eventSymbol); // '1d' | '1h' | '5m' | '15m' | ...

  const row = {
    timestamp: e.time,
    open: e.open,
    high: e.high,
    low: e.low,
    close: e.close,
    volume: e.volume,
    vwap: e.vwap,
    count: e.count,
    imp_vol: e.impVolatility,
    event_flags: e.eventFlags,
    tf,
    session: /tho=true/.test(e.eventSymbol) ? 'rth+eth' : 'rth',
    source_transport: env.transport,
    source_url: env.source,
  };

  const { dateStr } = splitUtcDate(e.time);
  const filePath = `data/stock/SPY/${dateStr}/${tf}.csv`;

  appendCsv(filePath, row, {
    header: [
      'timestamp','open','high','low','close',
      'volume','vwap','count','imp_vol','event_flags',
      'tf','session','source_transport','source_url',
    ],
  });
}
```

> **Nota para tu comando de saneamiento de 5m/15m/1h**:
> Este `handleSpyCandle` es el *input crudo* que luego usará `sanitizeSpyTfData('5m'|'15m'|'1h', ...)` para corregir huecos / valores raros. En ese comando simplemente vuelves a leer estos CSV por tf, comparas `timestamp` contra el grid de la temporalidad y parchas.

### c) Normalización Trade / TradeETH

```ts
function handleSpyTrade(env: Envelope, channel: number, e: TradeEvent | TradeEthEvent, session: 'rth' | 'eth') {
  if (!Number.isFinite(e.price) || !Number.isFinite(e.dayVolume)) return;

  const row = {
    timestamp: e.time,
    price: e.price,
    day_volume: e.dayVolume,
    session,
    source_transport: env.transport,
    source_url: env.source,
  };

  const { dateStr } = splitUtcDate(e.time);
  const filePath = `data/stock/SPY/${dateStr}/1sec_trades.csv`;

  appendCsv(filePath, row, {
    header: ['timestamp','price','day_volume','session','source_transport','source_url'],
  });
}
```

### d) Normalización Quote → orderbook light

```ts
function handleSpyQuote(env: Envelope, channel: number, e: QuoteEvent) {
  if (!Number.isFinite(e.bidPrice) || !Number.isFinite(e.askPrice)) return;

  const ts = Math.max(e.bidTime || 0, e.askTime || 0);

  const row = {
    timestamp: ts,
    bid_price: e.bidPrice,
    bid_size: e.bidSize,
    ask_price: e.askPrice,
    ask_size: e.askSize,
    spread: e.askPrice - e.bidPrice,
    mid: (e.askPrice + e.bidPrice) / 2,
    source_transport: env.transport,
    source_url: env.source,
  };

  const { dateStr } = splitUtcDate(ts);
  const filePath = `data/stock/SPY/${dateStr}/orderbook.csv`;

  appendCsv(filePath, row, {
    header: [
      'timestamp','bid_price','bid_size','ask_price','ask_size',
      'spread','mid','source_transport','source_url',
    ],
  });
}
```

---

## 4. ¿Se guarda o no? ¿Cómo?

Para este módulo **sí guardamos todo lo que sea de SPY**:

* **Candles** (`eventType: "Candle"`):

  * Archivo según `tf`:

    * `data/stock/SPY/<YYYY-MM-DD>/1h.csv` para `{=h,...}`
    * `data/stock/SPY/<YYYY-MM-DD>/1d.csv` para `{=d,...}`
    * Más adelante, cuando añadas 5m/15m desde legend o desde las 2 URL nuevas, irán a `5m.csv` y `15m.csv` en el mismo layout.
* **Trades / TradeETH**: `1sec_trades.csv` con columna `session` (`rth`/`eth`).
* **Quote**: `orderbook.csv` con snapshots ligeros bid/ask.

**No se guardan**:

* Frames `FEED_CONFIG` (solo afectan parsing).
* Cualquier `FEED_DATA` con parse fallido o valores `NaN` en precio/volumen (solo log).

---

### Comentario para el futuro (URL saneamiento 5m/15m/1h)

En el comando `sanitizeSpyTfData` que ya definimos, agrega un comentario recordando que la **fuente original** viene de:

```ts
// Fuente cruda de velas SPY:
//  - wss://api.robinhood.com/marketdata/streaming/legend/
//  - <URL_HTTP_5m>, <URL_HTTP_15m>, <URL_HTTP_1h>  // TODO: completar cuando Amo pase las URLs
```

Con esto dejas este módulo de `legend` totalmente encajado en la ORDEN DEL MOMENTO y preparado para que el saneamiento de SPY por temporalidad sea consistente.
