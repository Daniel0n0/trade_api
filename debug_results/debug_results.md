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



PUNTO 12:
¡Listo! ORDEN DEL MOMENTO — **Módulo “opciones avanzadas (SPY)”** · **Petición: `marketdata/quotes` (bounds=extended, id=8f92e76f-1e0e-4478-8580-16a6ffcfaef5)**

Todo **explícito**, sin suposiciones.

---

# 1) Directorios de salida

Usamos tu estructura de **stocks** y separamos por tipo de “bounds”:

```
data/
└─ stocks/
   └─ SPY/
      └─ 2025-11-12/                                   # fecha UTC de ingestión
         └─ quotes/
            ├─ raw/
            │  └─ extended_response_<epoch_ms>.json    # respuesta cruda exacta
            ├─ extended/
            │  ├─ latest.json                           # último snapshot normalizado
            │  └─ history/
            │     └─ 2025-11-12T01_00_00Z.json          # 1 archivo por `updated_at` (sanitizado)
            └─ meta/
               └─ request_extended_<epoch_ms>.txt       # auditoría del request (sin Authorization)
```

> Si llegan otros `bounds` (p. ej., `24_5`), se guardan en carpetas hermanas: `quotes/24_5/...` con el mismo esquema.

---

# 2) Campos EXACTOS que llegaron

De `results[0]`:

* `ask_price` (string numérica)
* `ask_size` (entero)
* `venue_ask_time` (ISO-8601)
* `bid_price` (string numérica)
* `bid_size` (entero)
* `venue_bid_time` (ISO-8601)
* `last_trade_price` (string numérica)
* `venue_last_trade_time` (ISO-8601)
* `last_extended_hours_trade_price` (string numérica)
* `last_non_reg_trade_price` (string numérica)
* `venue_last_non_reg_trade_time` (ISO-8601)
* `previous_close` (string numérica)
* `adjusted_previous_close` (string numérica)
* `previous_close_date` (YYYY-MM-DD)
* `symbol` = `"SPY"`
* `trading_halted` (boolean)
* `has_traded` (boolean)
* `last_trade_price_source` (string) = `"nls"`
* `last_non_reg_trade_price_source` (string) = `"consolidated"`
* `updated_at` (ISO-8601)
* `instrument` (URL)
* `instrument_id` = `"8f92e76f-1e0e-4478-8580-16a6ffcfaef5"`
* `state` (string) = `"active"`

**No se usan otros campos. No se inventa nada.**

---

# 3) Normalización (precisa y declarada)

En `quotes/extended/latest.json` (y en cada `history/<timestamp>.json`) guardar un objeto con **solo**:

* `symbol` (string)
* `instrument_id` (string)
* `bounds` = `"extended"` (string, fijo por esta petición)
* `updated_at` (ISO-8601, igual al de origen)
* `bid_price` (número) = parseFloat del string
* `bid_size` (entero)
* `ask_price` (número)
* `ask_size` (entero)
* `last_trade_price` (número)
* `venue_last_trade_time` (ISO-8601)
* `last_extended_hours_trade_price` (número)
* `last_non_reg_trade_price` (número)
* `venue_last_non_reg_trade_time` (ISO-8601)
* `previous_close` (número)
* `adjusted_previous_close` (número)
* `previous_close_date` (YYYY-MM-DD)
* `trading_halted` (boolean)
* `has_traded` (boolean)
* `last_trade_price_source` (string)
* `last_non_reg_trade_price_source` (string)
* `state` (string)

**Campos derivados (definidos explícitamente, sin “adivinar”):**

* `mid_price` (número) = `(bid_price + ask_price) / 2`
* `spread` (número) = `ask_price - bid_price`
* `spread_bps` (número) = `spread / mid_price * 10000`
  (Si `mid_price == 0`, entonces `spread_bps = null`).

> ÚNICAMENTE estas fórmulas; no se aplican otras transformaciones.

---

# 4) Versionado / historial

* `latest.json` se **sobrescribe** cada vez (último snapshot).
* En `history/`, crear un archivo por `updated_at` (reemplazando `: .` por `_` para el nombre).
  Si llega otra muestra con el **mismo** `updated_at`, se **sobrescribe** ese archivo.

---

# 5) Auditoría del request

Crear `quotes/meta/request_extended_<epoch_ms>.txt` con:

* `url` completa
* `method` (`GET`)
* `status_code` (esperado: `200`)
* `timestamp_utc` (ISO)
* `headers_sin_auth`: lista de headers recibidos **excluyendo** `authorization`
* `query_params` **exactos**:
  `bounds=extended` · `ids=8f92e76f-1e0e-4478-8580-16a6ffcfaef5` · `include_inactive=true`

La **respuesta cruda** completa se guarda en `quotes/raw/extended_response_<epoch_ms>.json`.

---

# 6) Validaciones estrictas

* `results` debe ser array con **1** elemento. Si no, error y se persiste igual en `raw/` + `request_extended_*.txt`; no se genera `latest.json`.
* Verificar `symbol === "SPY"` y `instrument_id === "8f92e76f-1e0e-4478-8580-16a6ffcfaef5"`.
  Si no coincide, marcar `mismatch: true` en el objeto normalizado y **aún así** persistir el snapshot (no se descarta).
* Parseo numérico: si algún precio viene no numérico, ese campo se escribe como `null` y `parse_error_fields` lista sus nombres.

---

# 7) Integración con otros módulos

* El `instrument_id` coincide con el usado en **chains** (SPY). Se puede cruzar sin mapear nada extra.
* Para streams (WS “legend”), este snapshot sirve como **referencia de último quote** fuera de horario regular.

---