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



PUNTO 16:
¡Perfecto, Amo! **Petición `marketdata/options` (20 IDs más) recibida y procesada.**

### Qué haré con este lote

1. **Guardar crudo**
   `data/options/SPY/marketdata/raw/md_options_response_<epoch_ms>.json`

2. **Auditoría del request** (sin el `authorization`)
   `data/options/SPY/marketdata/meta/request_md_options_<epoch_ms>.txt`
   Incluye URL con los 20 IDs, método, `status=200`, `timestamp_utc`, headers útiles y `x-robinhood-md-num-instruments: 20`.

3. **Normalizar & upsert (sobre el snapshot activo)**

* Parseo cada `result` con el mismo esquema (precios, greeks, IV, COP, volumen, OI, `updated_at`).
* Upsert en `data/options/SPY/marketdata/normalized/options_md_latest.json`:

  * Si `instrument_id` existe → **reemplazo** usando el más reciente por `updated_at`.
  * Si no existe → **agrego**.
* Índices rápidos:

  * `index_by_instrument_id.json` y `index_by_occ.json`.
* Copia histórica del snapshot:
  `normalized/history/options_md_<epoch_ms>.json`.

4. **Derivados inmediatos**

* Calculo `mid = (bid+ask)/2`, `spread`, `relative_spread`, y **moneyness** (si ya tenemos el join con `options/instruments` y último spot de SPY).
* Actualizo `normalized/derived_latest.json`.

5. **Validaciones / banderas**

* `symbol` debe ser `SPY` → si no, `mismatch_symbol:true`.
* Campos numéricos inválidos → `null` + `parse_error_fields`.
* Heurísticas útiles marcadas por opción:

  * `one_sided_market:true` si `bid=0` y `ask>0`.
  * `sentinel_iv:true` para IVs “centinela” raras (p.ej., 0.000075 en puts ITM profundos).
  * `cop_is_extreme:true` si `chance_of_profit_long ∈ {0,1}`.

6. **Consistencia con `options/instruments`**

* Si algún `instrument_id` aún no está en caché de instruments, marco `needs_instrument_join:true` para completar el join en el siguiente paso.

---

### Pistas rápidas que ya se ven en este lote (útiles para trading intradía)

* **ATM calls 675–682** (vencen 2025-11-18) muestran **delta ~0.55–0.76** e **IV ~0.13–0.16**, spreads muy ajustados (buena calidad de cotización).
* **Pares call/put del mismo strike** permiten vigilar **paridad put-call** y detectar desalineaciones breves (alerta si |mid_call − mid_put − (S−K·DF)| > umbral).
* Volúmenes elevados en strikes **678–682**: candidatos para **scalps de gamma** si el spot oscila alrededor del strike.

### Alertas que activo (sobre este snapshot)

* **Spread% > 1.2× su media de 30 min** → posible iliquidez/rotura de book.
* **Salto de IV > +2σ intradía** por strike → noticia/flujo inusual.
* **COP extrema (≈0 o ≈1)** en OTM cercanos → riesgo de marcación “muerta”; evitar para entradas direccionales.
* **Open interest ≫ volumen del día** y spread ancho → evitar fills pobres.

**Nota de seguridad:** compartiste un `Bearer` en el ejemplo. Si ese token es real, te sugiero **rotarlo** por precaución.

---

PUNTO 17:

¡Listo, Amo! Ya tengo los **trading hours** para `XASE` del **2025-11-11** y te dejo el **módulo** para que la parte de *Greeks de futuros* sepa exactamente **cuándo** y **cómo** calcular/mostrar.

## 1) Parsing y normalización (UTC → ET)

Payload clave (UTC) → (ET, Nueva York; EST = UTC-5 en noviembre):

* `opens_at`: 14:30Z → **09:30 ET**
* `closes_at`: 21:00Z → **16:00 ET**
* `late_option_closes_at`: 21:15Z → **16:15 ET**
* `extended_opens_at`: 12:00Z → **07:00 ET**
* `extended_closes_at`: 01:00Z (día sig.) → **20:00 ET** (del mismo día calendario ET)
* `index_options_extended_hours.curb`: 21:15Z → 22:00Z → **16:15–17:00 ET**

Guárdalo como:

```json
{
  "market": "XASE",
  "date": "2025-11-11",
  "tz": "America/New_York",
  "sessions": {
    "premarket": ["07:00", "09:30"],
    "regular":   ["09:30", "16:00"],
    "late":      ["16:00", "16:15"],
    "curb_idx":  ["16:15", "17:00"],
    "extended":  ["07:00", "20:00"]
  }
}
```

> Nota: “extended” abarca todo el tramo 07:00–20:00; “late/curb_idx” son sub-tramos especiales de opciones índice.

## 2) API del módulo (recomendación)

Funciones puras y fáciles de testear:

* `get_trading_phase(now_et) -> {"phase": premarket|regular|late|curb_idx|extended|closed, "is_open": bool}`
* `is_order_routable(instrument_type, now_et) -> bool`

  * Equity/ETF: premarket, regular, after (hasta 20:00)
  * **Futuros y opciones sobre futuros**: usa su propio venue/calendario si difiere; si ruteas vía XASE para opciones índice, respeta `late` y `curb_idx`.
* `next_transition(now_et) -> datetime_et`
* `time_to_close(now_et) -> timedelta`

## 3) Reglas de *Greeks* en función de la sesión

Aunque el modelo (p.ej., Black-Scholes/Bjerksund) usa **tiempo continuo** (calendario), a nivel **UI y riesgo** conviene modular:

**a) Reloj de theta (presentación)**

* `T_calendar = (expiry_utc - now_utc)/365`
* `theta_display`: en **regular/late/curb_idx** muestra la métrica en tiempo real.
* En **premarket/extended** muéstrala, pero etiqueta `liquidity_warning=true` (spreads amplios → sensibilidad poco confiable).

**b) Subyacente para FUTUROS**

* En **cualquier fase**, el subyacente para opciones de futuros debe ser **el precio del futuro** (no el spot cash).
* Si el *feed* de futuros está activo 23h, **actualiza greeks cada N=15–30s** fuera de regular, y cada **1–5s** en regular.

**c) IV & spreads**

* Si `bid=0` y `ask>0` → `one_sided_market=true` → fija `vega/theta` como **informativas** pero marca `confidence=low`.
* Si `relative_spread > 3%` fuera de regular → `iv_confidence=low`.

**d) Fronteras temporales críticas**

* `16:00:00 ET`: recalcula referencias (close cash) y valida *snap* de greeks.
* `16:15 ET` (`late_option_closes_at`): corta cotización de índice 0DTE y **congela** greeks de esas series.
* `17:00 ET` fin `curb_idx`: desbloques y vuelve a modo extended normal si aplica.

## 4) Señales/alertas automáticas (gammas y riesgo)

* **Gamma-risk spike**: si `phase in {"regular","late","curb_idx"}` y `|S−K|/S < 0.2%` con `vega>p95` → alerta “ATM hot”.
* **Decay cliff**: si `expiry` hoy y `time_to_close < 60 min` (según fase) → “theta-cliff”.
* **IV jump**: `ΔIV > 2σ_rolling_30min` por strike → “IV shock” (posibles gaps de futuros/índice).
* **Session switch**: notifica transición 5 min antes de cada cambio (p.ej., 15:55, 16:10, 16:55).

## 5) Integración con tu *pipeline* actual

* **Cache horario por día** en `cache/market_hours/XASE/2025-11-11.json` + *memoize* por fecha.
* **Middleware** previo a cálculo de greeks:

  1. `phase = get_trading_phase(now_et)`
  2. selecciona **feed** adecuado (futuro vs cash).
  3. ajusta *cadencia* de refresco: `regular=1–5s`, `late/curb=5–10s`, `extended=15–30s`.
  4. setea *flags* UI: `liquidity_warning`, `one_sided_market`, `iv_confidence`.

## 6) Validaciones y *edge cases*

* Si el *venue* reporta `is_open=false` pero aún estás en `extended` (07:00–20:00), no bloquees lectura de cotizaciones; solo marca `routing=limited`.
* Si `index_option_0dte_closes_at` difiere de `late_option_closes_at`, la **más estricta** domina para esas series.
* Cruce de día UTC: recuerda que `extended_closes_at` 01:00Z ya es **20:00 ET del día en curso**.

---

¿Te dejo un **helper** listo (pseudocódigo) para pegar?

```python
def classify_phase(now_et):
    t = now_et.time()
    if time(7,0)  <= t < time(9,30):  return "premarket"
    if time(9,30) <= t < time(16,0):  return "regular"
    if time(16,0) <= t < time(16,15): return "late"
    if time(16,15)<= t < time(17,0):  return "curb_idx"
    if time(17,0) <= t < time(20,0):  return "extended"
    return "closed"
```

---