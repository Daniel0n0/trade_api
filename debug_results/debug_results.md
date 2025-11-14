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



PUNTO 5:
¡Vamos con la **ORDEN DEL MOMENTO** para el **módulo de opciones avanzadas (SPY)** — **Petición 1**.
No asumo nada: solo trabajo con lo que enviaste (handshake + ráfaga de **opCode 9 (ping)** y **opCode 10 (pong)**). No llegó ningún evento de negocio (no hay “order update” con contenido).

# Petición 1 — `wss://api-streaming.robinhood.com/wss/connect?...topic=equity_order_update&topic=option_order_update&topic=crypto_order_update&topic=futures_order_update`

## 1) Dónde guardarlo (sistema de directorios)

Este stream **no** pertenece a un símbolo ni a futuros; es un **stream global de órdenes**. Ubícalo como **telemetría** de WS:

```
data/
└─ app/
   └─ streams/
      └─ orders/                         # streams de órdenes (equity/option/crypto/futures)
         └─ <YYYY-MM-DD>/                # fecha UTC del snapshot
            ├─ raw/
            │  └─ wss_connect_<epoch_ms>.txt     # handshake (request/response) tal cual
            ├─ heartbeats.csv                     # pings/pongs observados
            └─ session_index.csv                  # metadatos mínimos de la sesión
```

> No se mezcla con `data/stocks/...` ni `data/futures/...`.

---

## 2) Qué recibimos exactamente

Solo mensajes **keepalive**:

* `opCode: 9` con `data` (base64) → **PING**
* `opCode: 10` con `data` (base64) → **PONG**

No recibimos cuerpos JSON de órdenes (ni de equity ni options ni crypto ni futures) en lo que compartiste.

---

## 3) Cómo recibir y procesar (paso a paso, claro y mínimo)

1. **Detectar** el WS por URL exacta que contenga:

   ```
   wss://api-streaming.robinhood.com/wss/connect?topic=equity_order_update&topic=option_order_update&topic=crypto_order_update&topic=futures_order_update
   ```
2. **Guardar handshake** (solo texto):

   * En `raw/wss_connect_<epoch_ms>.txt` escribe:

     * Línea 1: `REQUEST` (método y URL)
     * Encabezados **sin Authorization** (omite/anonimiza)
     * Línea separadora
     * `RESPONSE` status y encabezados de respuesta
3. **Procesar frames**:

   * Para cada frame recibido/enviado que incluya un objeto con campos `opCode` y `data`:

     * Si `opCode` es `9` o `10`, registrar en **heartbeats.csv**.
   * Si el frame trae **otra cosa** (no visible aquí), **no** la inventamos ni la parseamos.
4. **Escritura de índices de sesión**:

   * Crear/append en `session_index.csv` con metadatos básicos.

---

## 4) Esquemas de salida (exactos)

### `heartbeats.csv`

Columnas (en este orden):

```
snapshot_ts_ms,snapshot_date_utc,ws_url,dir,opCode,data_base64,decoded_hint
```

* `snapshot_ts_ms` = epoch ms del **frame**
* `snapshot_date_utc` = `YYYY-MM-DD` derivado de ese timestamp
* `ws_url` = la URL completa del WS
* `dir` = `recv` | `send` (si puedes distinguirlo; si no, usa `recv`)
* `opCode` = `9` o `10` (solo esos según lo observado)
* `data_base64` = la cadena base64 recibida (tal cual)
* `decoded_hint` = **cadena vacía** (no asumimos decodificación; puedes dejarlo vacío)

> No realizamos *decode* porque no diste el significado del payload base64. No se asume.

**Ejemplos con tus frames:**

```
1762913097620,2025-11-12,wss://api-streaming.robinhood.com/wss/connect?...&topic=futures_order_update,recv,9,MTc2MjkxMzAwOTc2Mg==,
1762913098320,2025-11-12,wss://api-streaming.robinhood.com/wss/connect?...&topic=futures_order_update,recv,10,MTc2MjkxMzAwOTc2Mg==,
```

### `session_index.csv`

Columnas (en este orden):

```
session_start_ts_ms,session_date_utc,ws_url,topics,server_idle_timeout_ms,client_user_agent,origin
```

* `topics` = cadena exacta del query de la URL (`equity_order_update,option_order_update,crypto_order_update,futures_order_update`)
* `server_idle_timeout_ms` = si está presente en la respuesta (aquí vimos `300000`)
* `client_user_agent` = el UA del request (si lo tienes)
* `origin` = `https://robinhood.com`

> Un **registro por conexión**. Si reabres, generas otra fila.

---

## 5) Reglas de guardado e idempotencia

* **raw/** es inmutable (cada archivo lleva `<epoch_ms>` único).
* `heartbeats.csv` y `session_index.csv` usan **append**.
* Claves naturales (no estrictas, solo referencia):

  * `session_index.csv`: `session_start_ts_ms + ws_url`
  * `heartbeats.csv`: `(snapshot_ts_ms + ws_url + opCode + dir + data_base64)`

---

## 6) Funciones (qué hacen y qué devuelven)

* `shouldProcessWebSocket(url: string): boolean`

  * `true` **solo** si la URL es el `wss://api-streaming.robinhood.com/wss/connect` con **todos** los topics de tu ejemplo.

* `onWebSocketOpen(ctx): void`

  * Crea `raw/wss_connect_<epoch_ms>.txt` con request/response (sin Authorization).
  * Inserta/actualiza `session_index.csv` (append).

* `onFrameReceived(payload: unknown, url: string, ts_ms: number): void`

  * Si `payload` es objeto con **campos** `opCode` y `data`:

    * Si `opCode` ∈ {9,10}, escribe una fila en `heartbeats.csv`.
  * Si no cumple, **no** lo proceses (no asumimos nada).

* `onFrameSent(...)` (opcional)

  * Igual que `onFrameReceived` pero con `dir = "send"`.

> Todas devuelven `void`; en error de I/O, loguean y continúan.

---

## 7) Qué **no** hacemos (porque no está en lo que enviaste)

* No guardamos “order updates” de negocio porque **no aparecieron** en tus frames.
* No decodificamos el base64 (no diste el contrato).
* No inferimos *schemas* de eventos de órdenes.

---

## 8) Relación con otros módulos/archivos

* **Independiente**. Es telemetría WS global.
* Puede ayudarte a:

  * Ver latencia entre `ping` y `pong`.
  * Validar sesiones y caídas cuando un módulo dependa de order updates reales.

---