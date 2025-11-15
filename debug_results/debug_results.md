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



PUNTO 13:

¡Recibido! ORDEN DEL MOMENTO — **Módulo “opciones avanzadas (SPY)”** · **Petición: `options/instruments` (chain_id=SPY, expiration=2025-11-12, state=active, page_size=2000)**

Todo **explícito**, sin suposiciones.

---

# 1) Directorios de salida

```
data/
└─ options/
   └─ SPY/
      └─ chains/
         └─ c277b118-58d9-4060-8dc5-a3b5898955cb/
            └─ 2025-11-12/
               ├─ raw/
               │  └─ instruments_response_<epoch_ms>.json     # respuesta cruda exacta
               ├─ normalized/
               │  ├─ instruments_latest.json                  # lista normalizada completa (último snapshot)
               │  └─ history/
               │     └─ instruments_<epoch_ms>.json           # copia por lote recibido
               └─ meta/
                  └─ request_instruments_<epoch_ms>.txt       # auditoría del request (sin Authorization)
```

---

# 2) Campos EXACTOS relevantes por instrumento

De cada elemento en `results` guardamos **tal cual** (strings/fechas/números según vienen):

* `id` (UUID del instrumento de opción)
* `chain_id`
* `chain_symbol` (esperado: `"SPY"`)
* `type` (`"call"`/`"put"`)
* `strike_price` (string numérica, ej. `"690.0000"`)
* `expiration_date` (YYYY-MM-DD)
* `issue_date`
* `state` (ej. `"active"`)
* `tradability`, `rhs_tradability`
* `sellout_datetime` (ISO con zona)
* `min_ticks` (objeto con `above_tick`, `below_tick`, `cutoff_price`)
* `underlying_type` (ej. `"equity"`)
* `url` (endpoint del instrumento)
* `created_at`, `updated_at`

**No añadimos ni inventamos más campos en la capa “raw”.**

---

# 3) Normalización (lista de instrumentos)

En `normalized/instruments_latest.json` y en cada `history/instruments_<epoch_ms>.json` escribimos un **array** de objetos con esta forma (tipos explícitos):

```json
{
  "id": "UUID",
  "symbol": "SPY",
  "chain_id": "c277b118-58d9-4060-8dc5-a3b5898955cb",
  "type": "call",
  "strike_price": 690.0,
  "expiration_date": "2025-11-12",
  "issue_date": "2025-10-29",
  "state": "active",
  "tradability": "tradable",
  "rhs_tradability": "tradable",
  "sellout_datetime": "2025-11-12T20:45:00+00:00",
  "min_ticks": { "above_tick": 0.01, "below_tick": 0.01, "cutoff_price": 0.0 },
  "underlying_type": "equity",
  "api_url": "https://api.robinhood.com/options/instruments/<id>/",
  "created_at": "2025-10-29T01:07:46.776188Z",
  "updated_at": "2025-10-29T01:07:46.776191Z"
}
```

Reglas de normalización (declaradas):

* `symbol` se fija al `chain_symbol` recibido por cada item (no se deduce).
* `strike_price` → `number` vía `parseFloat`; si falla, `null` y se agrega `parse_error_fields:["strike_price"]` en ese objeto.
* `min_ticks.*` → `number` vía `parseFloat`.
* No se crean códigos OCC ni “eventSymbol”; **no** hay mapeo implícito.

---

# 4) Índices y orden

Además del array, generamos **dos índices** (archivos JSON) para acceso rápido:

* `normalized/index_by_id.json`
  `{ "<instrument_id>": { "i": <posición_en_array> } }`

* `normalized/index_by_key.json`
  Clave compuesta **explícita**: `"<type>|<expiration_date>|<strike_price>"`
  Ej.: `"call|2025-11-12|690"` → `<instrument_id>`

Estos índices **no** duplican el objeto; apuntan a la posición o al id.

---

# 5) Paginación y consistencia

* Si `next` trae URL, **concatenamos** todos los `results` en un solo lote antes de escribir `instruments_latest.json`.
* En este caso, `next=null`, así que el lote es único.
* Si en una nueva corrida se recibe un conjunto distinto (altas/bajas), `instruments_latest.json` se **sobrescribe completo** y siempre se añade una copia a `history/`.

---

# 6) Auditoría del request (sin secretos)

`meta/request_instruments_<epoch_ms>.txt` contendrá:

* `url` completa
* `method: GET`
* `status_code` (recibido)
* `timestamp_utc` (ISO)
* `headers_sin_auth` (todos excepto `authorization`)
* `query_params` **exactos**:

  * `chain_id=c277b118-58d9-4060-8dc5-a3b5898955cb`
  * `expiration_dates=2025-11-12`
  * `page_size=2000`
  * `state=active`

La **respuesta cruda** exacta va a `raw/instruments_response_<epoch_ms>.json`.

---

# 7) Validaciones estrictas

* Verificar que cada item tenga `chain_symbol === "SPY"` y `expiration_date === "2025-11-12"`.
  Si no, incluir `mismatch: true` en ese objeto (pero no descartarlo).
* Duplicados por `id`: si aparecen, se mantiene **el último** encontrado (se pisa el anterior).
* Campos obligatorios por objeto: `id`, `type`, `strike_price`, `expiration_date`, `state`.
  Si falta alguno, marcar `invalid: true` y listar `missing_fields`.

---

# 8) Enlaces con otros módulos (solo vínculos, sin inferir)

* El `id` aquí coincide con el usado por órdenes/posiciones/quotes de opción en otros endpoints de Robinhood.
* **No** generamos `eventSymbol` (feed de dxFeed) ni símbolos OCC; cuando necesitemos ese mapeo, se hará con la fuente correspondiente y quedará documentado en su propia sección.

---