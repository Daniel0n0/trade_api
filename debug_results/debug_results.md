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



PUNTO 9:
¡Hecho! ORDEN DEL MOMENTO — **Módulo “opciones avanzadas (SPY)”** · **Petición: marketdata token**

Solo documento lo que enviaste, sin suposiciones.

---

# 1) Dónde guardarlo (directorios)

Este endpoint **no es de velas ni de opciones**, es un **token de acceso para `legend`**. Guárdalo separado, pero accesible al módulo:

```
data/
└─ integrations/
   └─ robinhood/
      └─ marketdata_token/
         └─ session_id=ad5a3053-173d-4e76-a693-7cf1419e1ae7/
            ├─ raw/
            │  └─ response_<epoch_ms>.json           # respuesta completa (ver redacción)
            ├─ request_meta_<epoch_ms>.txt           # auditoría del request (sin Authorization)
            ├─ token_record.json                     # registro estructurado vigente
            └─ rotation_log.jsonl                    # historial de rotaciones
```

> El módulo de **opciones avanzadas (SPY)** debe **leer** desde `token_record.json` para abrir su `wss`.

---

# 2) Cómo recibir y procesar

**URL exacta aceptada**

```
https://api.robinhood.com/marketdata/token/v1/?session_id=<UUID>&session_type=blackwidow
```

**Metadatos del request → `request_meta_<epoch_ms>.txt`**

* `url` completa
* `method`
* `status_code`
* encabezados **con `authorization` eliminado**
* querystring literal (`session_id`, `session_type`)
* `timestamp_utc` (ISO 8601)

**Respuesta (parsing estricto)**

* Esperado (según tu payload):

  ```
  {
    "status":"SUCCESS",
    "data":{
      "status":"SUCCESS",
      "data":{
        "token": "<string>",
        "wss_url": "wss://api.robinhood.com/marketdata/streaming/legend/",
        "expiration": "<ISO8601>Z",
        "dxfeed_id": "<string>"
      }
    }
  }
  ```
* Si `status` o `data.status` ≠ `"SUCCESS"`, **no** persistir nada (solo log en `rotation_log.jsonl` con el error).

**Persistencia estructurada → `token_record.json`**
Guardar **solo** los campos recibidos + contexto mínimo del request:

```json
{
  "session_id": "ad5a3053-173d-4e76-a693-7cf1419e1ae7",
  "session_type": "blackwidow",
  "token": "<string>",
  "wss_url": "wss://api.robinhood.com/marketdata/streaming/legend/",
  "expiration": "2025-11-12T06:15:07.391053253Z",
  "dxfeed_id": "R28Gz5kMDCh6QWK8M1fo3kgPmNEJDvef",
  "obtained_at_utc": "<ISO now>",
  "ttl_seconds": <int>   // expiration - obtained_at_utc (en segundos, truncado >=0)
}
```

**Historial → `rotation_log.jsonl` (append-only)**
Una línea por respuesta **válida o inválida**:

```json
{"ts":"<ISO now>","session_id":"...","status":"SUCCESS","expiration":"..."}
```

**Copia cruda → `raw/response_<epoch_ms>.json`**

* Respuesta completa **pero con el valor de `"token"` parcialmente enmascarado** al escribir el archivo crudo (ej.: mantener los últimos 6 caracteres y reemplazar el resto por `"***"`).
* Razón: el archivo crudo suele usarse para depuración; evita exponer el secreto en claro.

---

# 3) ¿Se debe guardar? ¿Cómo?

* **Sí, temporalmente.** Es necesario para abrir/renovar el **WebSocket `legend`** que usan tus módulos (incluido “opciones avanzadas (SPY)”).
* **Dónde queda el secreto real:** en `token_record.json` (archivo de trabajo).

  * Permisos del archivo/carpeta: **solo lectura/escritura del proceso** (p. ej., `chmod 600` equivalente).
  * **Auto-purge**: al pasar `expiration`, eliminar `token_record.json` y cerrar cualquier WS que lo use.
* **Nunca** almacenar `Authorization` del request ni volcar el `token` en logs de consola.

---

# 4) Tipado y formato de archivos

* `token_record.json` → **JSON** (un único objeto; sobrescritura en cada rotación).
* `rotation_log.jsonl` → **JSON Lines** (una línea por evento).
* `request_meta_*.txt` → **texto plano**.
* `raw/response_*.json` → **JSON** (con `token` enmascarado como se indicó).

---

# 5) Funciones (qué hacen y qué devuelven)

* `isMarketdataTokenUrl(url: string): boolean`
  → `true` solo si coincide la ruta `/marketdata/token/v1/` y existen `session_id` y `session_type=blackwidow`.

* `parseTokenResponse(body: object): { token: string, wss_url: string, expiration: string, dxfeed_id: string } | Error`
  → Extrae exactamente los campos mostrados arriba. Si alguno falta, devuelve Error (no inventar valores).

* `writeRequestMeta(meta): void`
  → Escribe `request_meta_<epoch_ms>.txt` (sin `authorization`).

* `persistTokenRecord(record): void`
  → Sobrescribe `token_record.json` con el objeto indicado y **permisos restringidos**.

* `appendRotationLog(entry): void`
  → Añade una línea en `rotation_log.jsonl`.

* `maskTokenInRaw(body): object`
  → Devuelve copia del body con `data.data.token` enmascarado para el `raw/response_*.json`.

* `scheduleExpiryPurge(expirationIso: string): void`
  → Programa eliminación de `token_record.json` al expirar (si no tienes scheduler, verifica TTL al inicio de cada uso y purga en ese momento).

Todas devuelven `void` salvo `parseTokenResponse` (devuelve objeto o Error).

---

# 6) Interacciones con otros archivos/módulos

* **WebSocket legend** (los que ya documentaste): deben **leer `wss_url` y `token`** desde `token_record.json` **en tiempo real** antes de conectarse.
* **No transformar el token**: úsalo tal cual lo entrega el endpoint (tu payload no pide ningún formateo).

---

# 7) Reglas de rotación

* Si solicitas un nuevo token **antes** del vencimiento:

  * Sobrescribe `token_record.json` con el más reciente.
  * Añade entrada a `rotation_log.jsonl`.
* Si `expiration` pasó:

  * El WS que lo use debe reconectar **solo después** de obtener y persistir un nuevo token.
  * Purga el archivo viejo si aún existe.

---