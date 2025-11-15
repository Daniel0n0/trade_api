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



PUNTO 8:
¡Voy! ORDEN DEL MOMENTO — **Módulo “opciones avanzadas (SPY)”** · **Petición: discovery lists (items)**

Solo uso lo que enviaste. Esta petición devuelve **una lista de instrumentos** con campos exactos:
`id, type, symbol, name, item_data (array)`, más `returned_all_items` a nivel raíz.

---

# 1) Dónde guardarlo (directorios)

Para mantenerlo dentro del módulo de SPY sin mezclar con velas/legend:

```
data/
└─ stocks/
   └─ SPY/
      └─ <YYYY-MM-DD>/
         └─ discovery/
            └─ lists/
               └─ 609ddf55-2da1-4d85-8f23-501ccbdf76eb/
                  ├─ raw/
                  │  └─ response_<epoch_ms>.json
                  ├─ request_meta_<epoch_ms>.txt
                  ├─ items.jsonl
                  └─ summary.json
```

* `<YYYY-MM-DD>` se toma en **UTC** del momento en que recibes la respuesta.
* El subdirectorio se nombra con el **list_id** literal del URL.
* `raw/` almacena la respuesta sin alterar (ver redacción de credenciales abajo).

---

# 2) Cómo recibir y procesar (paso a paso, sin suposiciones)

**Filtro de URL exacto**
Procesa solo si la URL es:

```
https://api.robinhood.com/discovery/lists/v2/<LIST_ID>/items/?owner_type=robinhood
```

**Metadatos de request**
Guarda en `request_meta_<epoch_ms>.txt`:

* `url` completa
* `method`
* `status_code`
* encabezados **con `authorization` REMOVIDO**
* `querystring` literal (`owner_type=robinhood`)
* timestamp UTC

**Respuesta**

* Escribe la **respuesta completa** en `raw/response_<epoch_ms>.json`.
* Parsea el JSON. Si **falla**, no sigas (log y termina).

**Estructurado (append-only)**

* Recorre `results` (array). Por **cada elemento**, escribe **una línea** en `items.jsonl` con SOLO los campos recibidos (sin añadir ni renombrar claves):

  ```json
  {"id":"...","type":"instrument","symbol":"NVDA","name":"NVIDIA","item_data":[]}
  ```
* Crea/actualiza `summary.json` con:

  ```json
  {
    "list_id": "609ddf55-2da1-4d85-8f23-501ccbdf76eb",
    "owner_type": "robinhood",
    "returned_all_items": true
  }
  ```

  > Si el campo no existe en la respuesta, **no lo inventes** y no lo escribas.

**Paginación**

* Si la respuesta incluyera **`next`** NO nulo (no está en tu payload), realiza **otra petición** a esa URL y **append** en el mismo `items.jsonl`.
* Si no hay `next`, termina. No asumas páginas adicionales.

**Redacción de credenciales**

* En cualquier archivo de metadatos, elimina **`authorization`** y cualquier token.

---

# 3) Esquemas y tipado de archivos

## `items.jsonl` (JSON Lines)

* **Una línea por elemento de `results`**.
* Claves exactas del payload. Ejemplo literal de tus datos:

```json
{"id":"a4ecd608-e7b4-4ff3-afa5-f77ae7632dfb","type":"instrument","symbol":"NVDA","name":"NVIDIA","item_data":[]}
{"id":"e39ed23a-7bd1-4587-b060-71988d9ef483","type":"instrument","symbol":"TSLA","name":"Tesla","item_data":[]}
...
```

> `item_data` se guarda tal cual como arreglo (vacío en tu ejemplo).

## `summary.json` (JSON)

Campos permitidos si existen en la respuesta o del contexto inmediato del request:

* `list_id` (extraído del path literal)
* `owner_type` (del query `owner_type=robinhood`)
* `returned_all_items` (si viene en el JSON raíz)

## `raw/response_<epoch_ms>.json` (JSON)

Respuesta completa sin mutar.

## `request_meta_<epoch_ms>.txt` (texto)

Campos de auditoría indicados arriba (sin `authorization`).

---

# 4) Reglas de guardado

* `items.jsonl` es **append-only**.
* `raw/` es inmutable por respuesta (un archivo por request).
* **No** se generan archivos derivados (por ejemplo, índices por símbolo) porque **no lo enviaste**; se evita asumir usos.

---

# 5) Funciones (qué hacen y qué devuelven)

* `isDiscoveryItemsUrl(url: string): boolean`
  → `true` solo si coincide exactamente el patrón mostrado.

* `extractListId(url: string): string`
  → Devuelve `609ddf55-2da1-4d85-8f23-501ccbdf76eb` para tu URL.

* `onDiscoveryItemsResponse(body: object, nowMs: number, url: string): void`
  → Escribe `raw/response_<nowMs>.json`, crea carpeta del `list_id`, agrega líneas en `items.jsonl`, y actualiza `summary.json` con campos existentes.

* `writeRequestMeta(meta: RequestMeta, nowMs: number): void`
  → Escribe `request_meta_<nowMs>.txt` sin `authorization`.

Todas devuelven `void`. En errores de I/O o parseo: log y abortar esa respuesta (no reintenta ni inventa campos).

---

# 6) Interacciones con otros módulos/archivos

* **Ninguna obligatoria.** No cruzamos con `legend/` ni con `options/` porque esta respuesta solo lista instrumentos generales (tal cual tu payload).
* Si más adelante envías otra petición que relacione estos símbolos con el módulo, se documenta allí. Por ahora, **solo se almacena**.

---