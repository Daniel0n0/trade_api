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



PUNTO 15:
¡Recibido! **Petición `marketdata/options` (otro lote de 20 IDs)**

La integro igual que el lote anterior y **upserto** en el mismo “snapshot” de opciones.

### Qué hago con este request

1. **Guardar crudo**

* `data/options/SPY/marketdata/raw/md_options_response_<epoch_ms>.json`

2. **Auditoría del request** (sin el `authorization`)

* `data/options/SPY/marketdata/meta/request_md_options_<epoch_ms>.txt`
  Incluye URL completa (los 20 IDs), método, `status=200`, `timestamp_utc`, headers útiles y `x-robinhood-md-num-instruments: 20`.

3. **Normalizar y upsert**

* Parseo los 20 `results` con el **mismo esquema** de la tanda anterior (precios/greeks numéricos; fechas string ISO).
* Actualizo `data/options/SPY/marketdata/normalized/options_md_latest.json`:

  * Si `instrument_id` **existe**, **reemplazo** el ítem completo (preferencia por el más reciente según `updated_at`; si falta, uso el orden de llegada).
  * Si **no existe**, lo **agrego** al array.
* Actualizo índices:

  * `index_by_instrument_id.json` → posición en el array
  * `index_by_occ.json` → `occ_symbol` → `instrument_id`
* Copia histórica del snapshot:
  `normalized/history/options_md_<epoch_ms>.json`

4. **Derivados opcionales**

* Si tengo último **spot** de SPY y strikes (vía `options/instruments`), refresco `normalized/derived_latest.json` con `mid`, `spread`, `relative_spread`, `moneyness` (sin tocar el snapshot base).

5. **Validaciones & flags**

* `symbol` debe ser `"SPY"`; si no, `mismatch_symbol:true`.
* Numéricos inválidos/`NaN` → guardo `null` y anoto `parse_error_fields:[...]`.
* Marcas típicas de datos “borde”:

  * **IV sentinela** `0.000075` en puts prof. ITM → lo registro en `sentinel_iv:true`.
  * `chance_of_profit_long ∈ {0,1}` en puts muy ITM u OTM → `cop_is_extreme:true`.
  * `bid=0` y `ask>0` → `one_sided_market:true`.

6. **Consistencia con instruments**

* Si alguno de estos 20 `instrument_id` aún **no** está en nuestro cache de `options/instruments`, marco `needs_instrument_join:true` (para forzar el join al próximo ciclo) y no calculo `moneyness` para ese ítem.

7. **Errores y casos raros**

* Si la respuesta hubiese venido vacía/parcial:

  * Registro `md_options_warning` en el meta con el recuento devuelto vs. `x-robinhood-md-num-instruments: 20`.
* Rate limit o 5xx: creo `meta/request_md_options_<epoch_ms>_error.txt` con el cuerpo y **no** toco `options_md_latest.json`.

---