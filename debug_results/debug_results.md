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


PUNTO 1:
¡Perfecto! Esta conexión **NO** trae velas: es el **socket global de “order updates”** (órdenes de equity/options/crypto/futures) + *heartbeats* (ping/pong). Úsala para **salud de sesión** y telemetría, pero **no** como fuente de candles del SPY. Abajo te dejo el “cómo” completo.

---

# 1) Clasificación

* **URL (WS):** `wss://api-streaming.robinhood.com/wss/connect?...topic=equity_order_update&...`
* **Función real:** ordenes + *keepalives* (no market data).
* **Mensajes observados:** objetos con `opCode` `9` (ping) y `10` (pong), `data` base64 con un timestamp (string).

---

# 2) Esquema de datos (para lo que sí aparece aquí)

### A) Keepalive / Heartbeat

```ts
type WsKeepalive = {
  kind: 'keepalive';
  opCode: 9 | 10;         // 9=ping, 10=pong
  serverTsMs: number;     // derivado: decode base64 -> número -> ms
  raw?: unknown;          // por si quieres conservar el frame original
};
```

### B) (Potenciales) eventos de orden

Si en algún momento este socket te manda updates reales de órdenes (no en tu captura actual), mapea así:

```ts
type OrderUpdate = {
  kind: 'order_update';
  assetClass: 'equity' | 'option' | 'crypto' | 'futures';
  orderId: string;
  state: 'queued' | 'confirmed' | 'filled' | 'canceled' | 'rejected' | string;
  symbol?: string;              // si viene
  side?: 'buy' | 'sell';
  qty?: number;
  filledQty?: number;
  avgPrice?: number;
  ts: number;                   // epoch ms
  raw?: unknown;
};
```

> **Importante:** Ninguna de estas dos estructuras es *candle data*. Las velas de Legend suelen venir por **otro WS**: `wss://api.robinhood.com/marketdata/streaming/legend/` (éste sí rútalo al módulo de velas).

---

# 3) Recepción

* **Playwright**: `page.on('websocket', ws => { ... }); ws.on('framereceived'| 'framesent', ({payload}) => ...)`.
* **Normalización del frame**:

  1. Si `payload` es `Buffer`, convertir a string `utf-8`.
  2. `try { const obj = JSON.parse(text); }`
  3. Si `obj.opCode === 9 || obj.opCode === 10` → **WsKeepalive**.

     * `serverTsMs` = `Number(Buffer.from(obj.data, 'base64').toString('utf8'))`
       (en tu traza ese número ya viene como string de epoch).
  4. Si aparece un objeto con claves de orden (id/estado/asset) → **OrderUpdate**.
  5. Cualquier otro formato → ignorar o log de depuración.

---

# 4) Procesamiento

### Keepalive

* Calcula **skew/latencia**:

  * `now = Date.now()`
  * `skewMs = now - serverTsMs`
  * Si observas un ping (9) seguido de un pong (10) con misma marca → puedes estimar RTT simple.
* Actualiza **estado de conexión** (último mensaje, contador de pings/pongs).
* **No derives velas** de aquí.

### OrderUpdate (si aparece)

* Valida numéricos, normaliza `symbol` y `ts`.
* Si no operas órdenes programáticamente, sólo **loga**.

---

# 5) ¿Se guarda? ¿Dónde y cómo?

* **Velas:** **NO** (no vienen en este socket).
* **Keepalives:** por defecto **NO** persistas; usa sólo para health.

  * **Opcional (útil en depuración/observabilidad):** CSV con métricas de salud.

    * Ruta: `data/_metrics/ws/robinhood-streaming.csv`
    * Cabecera:

      ```
      timestamp,url,opCode,server_ts_ms,skew_ms
      ```
* **Order updates (si llegan):** **Opcional** guardar para auditoría:

  * Ruta: `data/_raw/orders/<YYYY-MM-DD>.jsonl`
  * 1 línea por evento; sin compresión.

> Mantén **separado** el flujo de velas (vendrá del WS de Legend o de HTTP) en:
> `data/stocks/SPY/<YYYY-MM-DD>/{1s,1m,5m,15m,1h,1d}.csv` (como ya definimos antes).

---

# 6) Snippet recomendado (TS/Playwright)

```ts
import type { WebSocket } from 'playwright';

function handleStreamingSocket(socket: WebSocket) {
  const url = socket.url();
  if (!url.startsWith('wss://api-streaming.robinhood.com/wss/connect')) return;

  const onFrame = ({ payload }: { payload: string | Buffer }) => {
    const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    let obj: any;
    try { obj = JSON.parse(text); } catch { return; }

    // Heartbeats
    if (obj && (obj.opCode === 9 || obj.opCode === 10) && typeof obj.data === 'string') {
      const serverTsStr = Buffer.from(obj.data, 'base64').toString('utf8');
      const serverTsMs = Number(serverTsStr);
      if (!Number.isFinite(serverTsMs)) return;

      const skewMs = Date.now() - serverTsMs;
      // (opcional) persistencia de métrica
      // appendCsv('data/_metrics/ws/robinhood-streaming.csv',
      //   [[Date.now(), url, obj.opCode, serverTsMs, skewMs]],
      //   { ensureHeader: true, header: 'timestamp,url,opCode,server_ts_ms,skew_ms' }
      // );
      return;
    }

    // Posibles updates de órdenes
    if (obj && obj.order_id && obj.state) {
      // normalizar y (opcional) guardar a JSONL de auditoría
      // appendJsonl(`data/_raw/orders/${today()}.jsonl`, obj);
      return;
    }
  };

  const off = () => {
    socket.off('framereceived', onFrame);
    socket.off('framesent', onFrame);
    socket.off('close', off);
  };

  socket.on('framereceived', onFrame);
  socket.on('framesent', onFrame);
  socket.on('close', off);
}
```

---

# 7) Enrutamiento correcto para **velas de SPY**

* **Este socket (`api-streaming`)**: salud y órdenes → **NO velas**.
* **Socket/HTTP de Legend** (ejemplos típicos, pueden variar por build):

  * `wss://api.robinhood.com/marketdata/streaming/legend/`  ⟶ **sí** velas/ticks/series.
  * Requests HTTP JSON a endpoints “legend” (candles batch).
* **Acción**: En tu `socket-sniffer`, añade una **tabla de rutas**:

  * Si URL `.../streaming/legend/` → **procesador de velas** (tu módulo SPY 1d/1h/15m/5m/1m/1s).
  * Si URL `.../wss/connect?...order_update...` → **procesador de health/órdenes** (este).

---

# 8) Política de reconexión y *idle*

* El server anuncia `server-idle-timeout-ms: 300000` (5 min).
* Si no recibes frames en `T_idle = 240s` → intenta **reconectar**.
* Backoff exponencial c/ jitter: 1s → 2s → 4s → 8s … máx 60s.
* Marca `connected_at`, `last_msg_at` y expón métricas (en memoria o CSV opcional).

---

## Resumen de decisión (para este socket)

* **Recibir:** WS (`framereceived`/`framesent`), parsear JSON, detectar `opCode 9/10`.
* **Procesar:** calcular `skewMs`/RTT; marcar salud; *no* derivar velas.
* **Guardar:** **No** por defecto.

  * **Opcional**: métricas CSV en `data/_metrics/ws/robinhood-streaming.csv`.
  * **Opcional**: auditoría de órdenes en `data/_raw/orders/<YYYY-MM-DD>.jsonl`.
* **Velas del SPY:** enrútalas desde **otro** WS/HTTP (Legend), a tus CSV por timeframe.

