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



PUNTO 35:

Perfecto, ahora sí, **ORDEN DEL MOMENTO aplicado a esta petición `/inbox/threads/`**.
Voy a tratarla como la *primera* “petición recibida” del módulo.

---

## 1. Qué es esta petición y para qué sirve

**Endpoint:** `GET https://api.robinhood.com/inbox/threads/`
**Dominio:** `notifications / inbox`
**Función:** mensajes de:

* fills de órdenes (acciones, opciones, cripto)
* cancelaciones
* expiración de opciones
* depósitos / reversals
* anuncios de IPO / ventanas para pedir acciones
* avisos genéricos de la plataforma

👉 **NO es la fuente principal de datos de mercado ni de órdenes**.
Es un **log de eventos para el usuario**, útil como:

* auditoría,
* reconstrucción rápida de actividad,
* detección de cosas graves (reversals, expiraciones, etc).

Para greeks, stats y news de un símbolo (`SPY`, etc.) lo vamos a sacar de **otros endpoints** (quotes, options/marketdata, fundamentals, news), no de inbox. Este endpoint lo dejamos como **módulo auxiliar de notificaciones.**

---

## 2. Esquema de la data (schema)

### 2.1. Respuesta cruda (simplificada)

```ts
type InboxThreadsResponse = {
  results: InboxThread[];
  next: string | null;   // paginación
};

type InboxThread = {
  id: string;                 // "3275019698206418630"
  pagination_id: string;      // "03275019698248361401"
  display_name: string;       // "SPDR S&P 500 ETF" | "Bitcoin" | "Robinhood" | ...
  short_display_name: string; // "SPY" | "BTC" | "R" | ...
  is_read: boolean;
  is_critical: boolean;
  is_muted: boolean;
  preview_text: {
    text: string;             // resumen corto
    attributes: unknown | null;
  };
  most_recent_message: InboxMessage;
  last_message_sent_at: string;  // ISO "2025-11-11T14:52:09.856995Z"
  avatar_url: string | null;
  entity_url: string | null;     // ej. robinhood://instrument?id=...
  avatar_color: string;          // "#0B972E"
  options: {
    allows_free_text: boolean;
    has_settings: boolean;
  };
};

type InboxMessage = {
  id: string;
  thread_id: string;
  response_message_id: string | null;
  message_type_config_id: string | null;
  message_config_id: string;
  sender: {
    id: string;
    display_name: string;
    short_display_name: string;
    is_bot: boolean;
    avatar_url: string;
  };
  is_metadata: boolean;
  rich_text: {
    text: string;              // cuerpo completo
    attributes: unknown | null;
  };
  action: {
    value: string;
    display_text: string;
    url: string;               // deeplink: robinhood://orders?id=...&type=option
  } | null;
  media: unknown | null;
  remote_medias: unknown[];
  responses: {
    display_text: string;
    answer: string;
  }[];
  created_at: string;          // ISO
  updated_at: string;          // ISO
};
```

---

## 3. Cómo recibirla

### Transporte

* **Transporte:** `http`
* **Método:** `GET`
* **Auth:** `Authorization: Bearer <token>` (⚠️ nunca loguear el token, ni guardarlo en disco)

### Handler recomendado

```ts
async function fetchInboxThreads(client: HttpClient): Promise<Envelope[]> {
  const url = 'https://api.robinhood.com/inbox/threads/';
  const text = await client.getText(url);           // ya con headers, auth, etc.
  const json = safeJsonParse<InboxThreadsResponse>(text);

  const ts = Date.now();
  return json.results.map(thread => ({
    ts,
    transport: 'http',
    source: url,
    topic: 'inbox_threads',
    symbol: thread.short_display_name || undefined,  // ej. "SPY", "BTC", etc.
    payload: thread,
  }));
}
```

*Cada `thread` se convierte en un `Envelope`.*

---

## 4. Cómo procesarla (normalización)

Aquí lo importante es:

1. **Extraer un símbolo “lógico” cuando exista**, normalmente `short_display_name`:

   * SPDR S&P 500 ETF → `SPY`
   * Invesco QQQ → `QQQ`
   * S&P 500 Index → `SPX`
   * Bitcoin → `BTC`
   * etc.
2. Clasificar el tipo de evento (fill, cancelación, IPO, reversal, expiración, info).
3. Sacar un registro plano que puedas guardar en CSV o en una tabla.

### 4.1. Detección de tipo de evento

Parses por **patrones en `preview_text.text` o `rich_text.text`**:

* Contiene `"was filled for"` → `order_fill`
* Contiene `"was filled at an average price"` → `order_fill`
* Contiene `"was canceled"` → `order_canceled`
* Contiene `"expired"` → `option_expired`
* Contiene `"has been reversed"` → `bank_reversal`
* Contiene `"plans to go public"` → `ipo_announcement`
* Contiene `"finalized its price"` & `"request for IPO shares"` → `ipo_window_open`
* Contiene `"could not be filled"` → `ipo_not_allocated` o `request_not_filled`

Puedes hacer algo tipo:

```ts
type InboxEventKind =
  | 'order_fill'
  | 'order_canceled'
  | 'option_expired'
  | 'bank_reversal'
  | 'ipo_announcement'
  | 'ipo_window_open'
  | 'ipo_not_allocated'
  | 'generic';

function inferEventKind(text: string): InboxEventKind {
  const t = text.toLowerCase();

  if (t.includes('was filled for') || t.includes('has been filled')) return 'order_fill';
  if (t.includes('was canceled') || t.includes("you've canceled your order")) return 'order_canceled';
  if (t.includes('option') && t.includes('expired')) return 'option_expired';
  if (t.includes('has been reversed')) return 'bank_reversal';
  if (t.includes('plans to go public')) return 'ipo_announcement';
  if (t.includes('finalized its price') && t.includes('request for initial public offering')) {
    return 'ipo_window_open';
  }
  if (t.includes('could not be filled') && t.includes('ipo shares')) return 'ipo_not_allocated';

  return 'generic';
}
```

### 4.2. Normalización a fila plana

**Tabla lógica:** `inbox_events`

```ts
type InboxEventRow = {
  timestamp: number;          // most_recent_message.created_at (ms)
  thread_id: string;
  message_id: string;
  symbol: string | null;      // short_display_name
  display_name: string;
  short_display_name: string;
  event_kind: InboxEventKind;
  is_read: boolean;
  is_critical: boolean;
  preview_text: string;
  body: string;
  action_text: string | null;
  action_url: string | null;
  entity_url: string | null;
  last_message_sent_at: number;  // epoch ms
  source_transport: 'http';
  source_url: string;
};
```

Normalizador:

```ts
function normaliseInboxThread(env: Envelope): InboxEventRow {
  const thread = env.payload as InboxThread;
  const msg = thread.most_recent_message;
  const text = msg.rich_text?.text || thread.preview_text?.text || '';

  const tsMsg = Date.parse(msg.created_at);
  const tsLast = Date.parse(thread.last_message_sent_at);

  return {
    timestamp: tsMsg,
    thread_id: thread.id,
    message_id: msg.id,
    symbol: thread.short_display_name || null,
    display_name: thread.display_name,
    short_display_name: thread.short_display_name,
    event_kind: inferEventKind(text || thread.preview_text.text),
    is_read: thread.is_read,
    is_critical: thread.is_critical,
    preview_text: thread.preview_text?.text || '',
    body: text,
    action_text: msg.action?.display_text || null,
    action_url: msg.action?.url || null,
    entity_url: thread.entity_url,
    last_message_sent_at: tsLast,
    source_transport: env.transport,
    source_url: env.source,
  };
}
```

---

## 5. ¿Se guarda o no? ¿Y cómo?

### 5.1. ¿Conviene guardarlo?

* **Sí**, pero **no como fuente de mercado**, sino como:

  * log de actividad del usuario,
  * señal de **eventos críticos** que afectan capital (reversal, expiraciones, fills),
  * auditoría / debugging del sistema frente a lo que Robinhood confirma.

**No usar este endpoint como substituto del API de órdenes u opciones**.
Las fills y estados de órdenes deberías sacarlos de `/orders/` y endpoints específicos.

### 5.2. Dónde y formato

Yo lo pondría fuera de `data/stock/...` porque mezcla muchos símbolos.

Propuesta:

* Carpeta general de eventos de plataforma:

  * `data/system/inbox_events/YYYY-MM-DD.csv`
* Y opcional un crudo en JSONL:

  * `data/_raw/inbox/YYYY-MM-DD.jsonl` (cada línea un `InboxThread` completo).

#### `data/system/inbox_events/2025-11-12.csv`

Columnas:

```csv
timestamp,thread_id,message_id,symbol,display_name,short_display_name,event_kind,is_read,is_critical,preview_text,body,action_text,action_url,entity_url,last_message_sent_at,source_transport,source_url
```

Regla:

* **Append** por cada hilo (thread) recibido.
* Si quieres evitar duplicados, puedes:

  * o bien upsert en una base de datos (SQLite / Postgres),
  * o bien poner una clave `thread_id + message_id` en una tabla relacional y usar CSV sólo como backup.

#### Crudo (`_raw`)

`data/_raw/inbox/2025-11-12.jsonl`

* Cada línea: el `Envelope` completo o el `InboxThread` tal cual viene de Robinhood.
* Útil para debugging cuando cambien el formato.

---

## 6. Integración con el resto del proyecto `trade_api`

Aunque este endpoint no da greeks ni stats, **sí se conecta** con tus otros módulos:

* Cuando recibes un `order_fill` de, por ejemplo, `SPY $679 Put 11/11`:

  * Puedes usarlo para marcar en tu propio log de órdenes que Robinhood confirmó el fill.
* Cuando llega un `bank_reversal`:

  * Puedes ajustar tu **registro interno de buying power / cash** en tu sistema (aunque el dato oficial viene de account/banking).
* IPO:

  * Puedes construir un **historial de oportunidades de IPO** (qué se ofreció, cuándo tuviste ventana, si te asignaron o no).

---

## 7. Resumen corto de lo que haría con ESTA petición

1. **Recibir** la respuesta HTTP, parsear JSON → `InboxThreadsResponse`.
2. Por cada `results[i]`:

   * meterlo en un `Envelope` con `topic = 'inbox_threads'`.
3. **Normalizar** a `InboxEventRow`:

   * `symbol = short_display_name`,
   * `event_kind` por patrones en `preview_text/body`,
   * timestamps a epoch ms.
4. **Guardar**:

   * CSV diario en `data/system/inbox_events/YYYY-MM-DD.csv`,
   * opcional `_raw` en JSONL para debugging.
5. **Usar** estos eventos sólo como:

   * capa de auditoría y alertas,
   * **no** como fuente primaria de datos de mercado / greeks.

Cuando me pases la siguiente petición (por ejemplo, el endpoint donde realmente llegan **greeks / statistics / news del módulo de SPY**), la tratamos igual:
te devuelvo el schema, normalización a filas (stats, greeks, news), y dónde guardarlas dentro de `data/stock/SPY/...`.


---