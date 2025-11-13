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


PUNTO 3:
¡Recibido! Sigo la **ORDEN DEL MOMENTO** y **no asumo nada**: dejo todo explícito.

# Petición 3 — `GET https://api.robinhood.com/options/orders/…`

**Qué es:** listado paginado de **órdenes de opciones** (con legs y ejecuciones) para una cuenta, filtradas por `created_at__gte`.

---

## 1) Dónde encaja en el sistema de directorios (sin ambigüedad)

Vamos a guardar **por subyacente** (usa `chain_symbol` de cada orden) y por **fecha UTC del evento**. No mezclamos SPY con SPXW.

```
data/
└─ stocks/
   └─ <CHAIN_SYMBOL>/                 # ej. SPY, SPXW (tal cual llega en chain_symbol)
      └─ <YYYY-MM-DD>/                # fecha UTC de created_at de la orden
         └─ options/
            ├─ orders.jsonl           # bruto (1 línea = 1 orden)
            ├─ legs.csv               # 1 fila por leg
            ├─ executions.csv         # 1 fila por ejecución
            ├─ fees.csv               # 1 fila por fee (si viene no vacío)
            └─ raw/
               └─ options_orders_<TS>.json  # respuesta completa tal cual (para auditoría)
```

> Nota: Si **una** orden tiene `chain_symbol=SPXW`, va al árbol de `data/stocks/SPXW/...`. Si fuese otro símbolo, se crea su carpeta correspondiente.

---

## 2) Estructura exacta recibida (basada solo en lo que enviaste)

### Respuesta HTTP

```json
{
  "next": "https://api.robinhood.com/options/orders/?...&cursor=...",
  "previous": null,
  "results": [ <Order[]> ]
}
```

### `Order` (campos observados en tu payload)

* `account_number: string`
* `cancel_url: string | null`
* `canceled_quantity: string`               // decimal en texto
* `created_at: string`                      // ISO, ej. "2025-11-11T14:52:28.423799Z"
* `direction: "credit" | "debit" | ...`
* `id: string`                              // UUID de la orden
* `legs: Leg[]`
* `pending_quantity: string`
* `premium: string`
* `processed_premium: string | number`      // llegó "550" (número) y "93" (número)
* `processed_premium_direction: string`
* `market_hours: "regular_hours" | ...`
* `net_amount: string | number`
* `net_amount_direction: "credit" | "debit"`
* `price: string`
* `processed_quantity: string`
* `quantity: string`
* `ref_id: string`
* `regulatory_fees: string`
* `contract_fees: string`
* `gold_savings: string`
* `state: "filled" | ...`
* `time_in_force: "gfd" | ...`
* `trigger: "immediate" | ...`
* `type: "limit" | ...`
* `updated_at: string`
* `chain_id: string`
* `chain_symbol: string`                    // **clave** para decidir carpeta (SPY, SPXW,…)
* `response_category: any | null`
* `opening_strategy: string | null`
* `closing_strategy: string | null`
* `stop_price: string | null`
* `form_source: string | null`
* `client_bid_at_submission: string`
* `client_ask_at_submission: string`
* `client_time_at_submission: string | null`
* `average_net_premium_paid: string`
* `estimated_total_net_amount: string | number`
* `estimated_total_net_amount_direction: string`
* `is_replaceable: boolean`
* `strategy: string`
* `derived_state: string`
* `sales_taxes: any[]`

### `Leg`

* `id: string`
* `executions: Execution[]`
* `option: string`          // URL del instrumento
* `position_effect: "open" | "close"`
* `ratio_quantity: number`
* `side: "buy" | "sell"`
* `expiration_date: string` // "YYYY-MM-DD"
* `strike_price: string`    // decimal texto
* `option_type: "call" | "put"`
* `long_strategy_code: string`
* `short_strategy_code: string`

### `Execution`

* `id: string`
* `price: string`           // decimal texto
* `quantity: string`
* `settlement_date: string` // "YYYY-MM-DD"
* `timestamp: string`       // ISO, ej. "2025-11-11T14:52:28.886000Z"

> **No inferimos** datos que no estén presentes. No resolvemos el `option` URL; **no es necesario** porque `leg` ya trae `expiration_date`, `strike_price` y `option_type`. Si en el futuro quieres enriquecer (`multiplier`, `underlying`, etc.), eso sería **otro paso** adicional contra `/options/instruments/:id` y se guardaría en archivos aparte (no en esta orden).

---

## 3) Cómo recibir (hook HTTP) y procesar — paso a paso, sin suposiciones

1. **Intercepta respuesta** HTTP cuya URL incluya `/options/orders/`.
2. **Exige**:

   * `status < 400`
   * `Content-Type` JSON.
3. **Parsea** el cuerpo a objeto.
4. **Valida** que existe `results` como array. Si no → registrar error y **no** escribir.
5. **Paginación**: si `next` es no nulo **debes** repetir el GET hasta agotar (esto es parte de “procesarla completa”).

   * Cada página se procesa idéntico y se escribe **append/idempotente** (ver abajo).
6. **Por cada orden** en `results`:

   * Determina `chain_symbol` **exactamente** del campo.
   * Deriva `order_date_utc` = `created_at.slice(0,10)` (YYYY-MM-DD) **sin conversión** (ya viene en `Z`).
   * Directorio **destino**:

     ```
     data/stocks/<chain_symbol>/<order_date_utc>/options/
     ```
   * **Guarda**:

     * **Bruto** (opcional pero recomendado para auditoría):

       * `raw/options_orders_<epochms>.json` con la página completa.
       * `orders.jsonl`: 1 línea por orden (objeto original).
     * **Normalizado** en CSV:

       * `legs.csv` (una fila por leg)
       * `executions.csv` (una fila por ejecución)
       * `fees.csv` (si `regulatory_fees`, `contract_fees`, `sales_taxes` no están vacíos)

---

## 4) Esquemas exactos de salida (CSV / JSONL)

### `orders.jsonl` (tal cual orden)

* **1 línea = 1 `Order`** completo en JSON textual, sin modificar claves ni tipos.
* Ventaja: auditoría perfecta / reprocesado posterior.

### `legs.csv`

Columnas (todas **literales**, en este orden):

```
order_id,account_number,created_at,updated_at,state,derived_state,
direction,market_hours,time_in_force,trigger,type,strategy,
chain_id,chain_symbol,ref_id,
leg_id,position_effect,side,ratio_quantity,option_type,expiration_date,strike_price,
long_strategy_code,short_strategy_code,option_url
```

### `executions.csv`

Columnas:

```
order_id,leg_id,execution_id,timestamp,settlement_date,price,quantity
```

### `fees.csv`

Columnas:

```
order_id,regulatory_fees,contract_fees,gold_savings,estimated_total_net_amount,estimated_total_net_amount_direction,net_amount,net_amount_direction,processed_premium,processed_premium_direction,average_net_premium_paid
```

> **Tipos** en CSV: los dejamos como **texto** tal cual recibidos (para no perder precisión ni formato). La ETL que consuma estos CSV puede tipar después.

---

## 5) Idempotencia y actualización (sin adivinar)

* **Clave primaria**:

  * `orders`: `order_id`
  * `legs`: `order_id + leg_id`
  * `executions`: `execution_id` (si faltara, usar `order_id + leg_id + index`)
* **Regla**: si la fila **ya existe** por clave primaria → **reemplazar** (por si `state` u otros cambian en páginas siguientes).
* **Orden** de escritura sugerido:

  1. `orders.jsonl` (append)
  2. `legs.csv` (upsert)
  3. `executions.csv` (upsert)
  4. `fees.csv` (upsert)
* **Batch/flush**: acumular en memoria y escribir cada N órdenes (p.ej., 100) para eficiencia.

---

## 6) Contratos (funciones y lo que devuelven)

### `shouldProcessUrl(url: string) => boolean`

* Devuelve `true` si la URL **contiene** `/options/orders/`.

### `processPayload(payload: unknown) => void`

* Precondición: `payload` es un objeto con `results` (array).
* Efecto: llama a normalizadores y escribe en disco (según directorio definido).
* No devuelve nada; si hay error, **log** y **no escribir**.

### `normalizeOrder(order: Order) => { legs: LegRow[]; execs: ExecRow[]; fees: FeeRow | null; date: string; symbol: string }`

* Solo **transforma** campos 1:1 sin inventar datos.
* Devuelve:

  * `date`: `YYYY-MM-DD` desde `created_at`.
  * `symbol`: desde `chain_symbol`.
* No enriquece con instrumentos (no se asume).

### `upsertCsv(path: string, row: Row, key: (row)=>string) => Promise<void>`

* Lee (si existe), reemplaza por clave, o `append`.
* Devuelve `void` o lanza error I/O.

---

## 7) Seguridad y privacidad (explícito)

* **No** guardamos `Authorization` ni headers sensibles.
* Solo persistimos **cuerpo** de la respuesta.
* `account_number` viene en las órdenes; se guarda tal cual porque es un **dato del recurso**. Si quieres anonimizar, define una tabla de mapeo y aplícala **antes** de escribir.

---

## 8) Ejemplo real con tus datos (filas generadas)

**legs.csv**

```
order_id,account_number,created_at,updated_at,state,derived_state,direction,market_hours,time_in_force,trigger,type,strategy,chain_id,chain_symbol,ref_id,leg_id,position_effect,side,ratio_quantity,option_type,expiration_date,strike_price,long_strategy_code,short_strategy_code,option_url
69134dac-afd7-4fde-9f93-e17064c59a65,646012153,2025-11-11T14:52:28.423799Z,2025-11-11T14:52:29.040865Z,filled,filled,credit,regular_hours,gfd,immediate,limit,short_put,7a7fa2b1-b65e-4c75-a0b3-7f62749bee0a,SPXW,acdac931-0040-44b6-a1d4-423202133292,69134dac-d3b8-4e75-bf31-9a76ab1489e0,close,sell,1,put,2025-11-11,6795.0000,e08606eb-..._L1,e08606eb-..._S1,https://api.robinhood.com/options/instruments/e08606eb-...
69134d98-3639-476f-a5af-6caabf30ec89,646012153,2025-11-11T14:52:08.732506Z,2025-11-11T14:52:09.137009Z,filled,filled,credit,regular_hours,gfd,immediate,limit,short_put,c277b118-58d9-4060-8dc5-a3b5898955cb,SPY,67ba099c-1d4d-4893-a248-d13940d26f8a,69134d98-2adc-4b0b-8577-975e4c6a377f,close,sell,1,put,2025-11-11,679.0000,aa50e936-..._L1,aa50e936-..._S1,https://api.robinhood.com/options/instruments/aa50e936-...
...
```

**executions.csv**

```
order_id,leg_id,execution_id,timestamp,settlement_date,price,quantity
69134dac-afd7-4fde-9f93-e17064c59a65,69134dac-d3b8-4e75-bf31-9a76ab1489e0,69134dac-80a9-4dc5-88f0-36b8edb5d819,2025-11-11T14:52:28.886000Z,2025-11-12,5.50000000,1.00000
69134d98-3639-476f-a5af-6caabf30ec89,69134d98-2adc-4b0b-8577-975e4c6a377f,69134d98-f48e-4a82-90c2-4cdef38f384a,2025-11-11T14:52:08.960000Z,2025-11-12,0.93000000,1.00000
...
```

**fees.csv**

```
order_id,regulatory_fees,contract_fees,gold_savings,estimated_total_net_amount,estimated_total_net_amount_direction,net_amount,net_amount_direction,processed_premium,processed_premium_direction,average_net_premium_paid
69134dac-afd7-4fde-9f93-e17064c59a65,0.63,0.35,0.15,549.02,credit,549.02,credit,550,credit,-550.00000000
69134d98-3639-476f-a5af-6caabf30ec89,0.04,0,0,92.96,credit,92.96,credit,93,credit,-93.00000000
...
```

---

## 9) ¿Se guarda? Sí. ¿Cómo debe guardarse?

* **Siempre** guardamos el **bruto** (`orders.jsonl` + `raw/*.json`) y el **normalizado** (`legs.csv`, `executions.csv`, `fees.csv`).
* **Particionado** por `chain_symbol` y **fecha UTC** de `created_at`.
* **Upsert** por claves mencionadas para evitar duplicados si re-procesas la misma ventana temporal o si hay actualizaciones.

---