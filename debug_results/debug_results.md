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



PUNTO 4:
¡Voy con la **ORDEN DEL MOMENTO** para la **Petición 4** y lo dejo todo explícito, sin asumir nada.

# Petición 4 — `GET https://api.robinhood.com/hippo/bw/layouts`

**Qué es:** un listado JSON con **layouts (distribuciones de Legend)** y sus **widgets** (gráficas, tablas, etc.).
**Para qué sirve:** documentar/replicar las vistas que tienes configuradas (IDs de layout y de widget, posiciones, tamaños, tipos).

---

## 1) Dónde guardarlo en tu sistema de directorios (sin ambigüedad)

No pertenece a un símbolo ni a futuros; es **metadata de UI**. Guardamos por **fecha UTC del snapshot** (día del momento en que se captura).

```
data/
└─ app/
   └─ layouts/
      └─ <YYYY-MM-DD>/                       # fecha UTC del snapshot (p.ej. 2025-11-12)
         ├─ raw/
         │  └─ hippo_bw_layouts_<epoch_ms>.json    # respuesta completa tal cual
         ├─ layouts.jsonl                    # 1 línea = 1 layout (objeto completo)
         ├─ layouts_index.csv                # índice de layouts (campos seleccionados)
         └─ widgets.csv                      # 1 fila por widget (con relación a layout_id)
```

> No se mezcla con `data/stocks/...` ni `data/futures/...`. Es independiente.

---

## 2) Estructura exacta recibida (solo lo que enviaste)

### Respuesta HTTP

```json
{
  "layouts": [ Layout, Layout, ... ]
}
```

### `Layout`

* `id: string`                // UUID del layout
* `version: string`           // ej. "1.0.0"
* `name: string`              // ej. "SPY 60-30-15"
* `icon: string`              // ej. "LAYOUT" | "TABLES"
* `widgets: Widget[]`

### `Widget`

* `id: string`                // UUID del widget
* `widgetType: string`        // ej. "WIDGET_TYPE_CHART", "WIDGET_TYPE_OPTION_CHAIN", etc.
* `typeSlot: number`          // entero
* `position: { x: number, y: number }`
* `size: { height: number, width: number }`

> No hay paginación en lo que enviaste. No añadimos campos que no existen.
> **No** guardamos headers ni el token.

---

## 3) Cómo recibir y procesar (paso a paso, sin suposiciones)

1. **Interceptar** la respuesta cuya URL sea exactamente `https://api.robinhood.com/hippo/bw/layouts`.
2. Requisitos:

   * `status < 400`
   * `Content-Type: application/json`
3. **Parsear** JSON.
4. Validar que `layouts` existe y es array. Si no, registrar error y **no escribir**.
5. **Calcular** `snapshot_date_utc = currentUTC().slice(0,10)` (YYYY-MM-DD) y `snapshot_ts_ms = nowEpochMs()`.
6. **Escritura**:

   * `raw/hippo_bw_layouts_<snapshot_ts_ms>.json` — **respuesta completa**.
   * `layouts.jsonl` — **una línea por layout**, el objeto **completo** sin modificar.
   * `layouts_index.csv` — índice con columnas fijas (ver abajo).
   * `widgets.csv` — una fila por cada widget enlazado a su `layout_id`.

---

## 4) Esquemas de salida (exactos)

### `layouts_index.csv`

Columnas (en este orden):

```
snapshot_ts_ms,snapshot_date_utc,layout_id,version,name,icon,widget_count
```

### `widgets.csv`

Columnas (en este orden):

```
snapshot_ts_ms,snapshot_date_utc,layout_id,layout_name,widget_id,widgetType,typeSlot,pos_x,pos_y,size_height,size_width
```

### `layouts.jsonl`

* **1 línea = 1 layout** como JSON textual completo (tal cual llegó).

> Motivo del `snapshot_ts_ms` y la fecha: permitir comparar cambios a lo largo del tiempo y evitar ambigüedades si modificas layouts el mismo día.

---

## 5) Reglas de idempotencia/actualización

* Claves primarias:

  * En `layouts_index.csv`: `snapshot_ts_ms + layout_id`
  * En `widgets.csv`: `snapshot_ts_ms + layout_id + widget_id`
* No se **reemplazan** filas de snapshots anteriores (son históricos).
* Si re-ejecutas **el mismo snapshot** (mismo `snapshot_ts_ms`) por error, usa **upsert** por las claves indicadas.

---

## 6) Contratos de funciones (qué hacen y qué devuelven)

* `shouldProcessUrl(url: string): boolean`

  * `true` **solo** para `https://api.robinhood.com/hippo/bw/layouts`.

* `processLayoutsPayload(payload: unknown, clock: Clock): void`

  * `payload` debe tener `layouts: Layout[]` según el esquema anterior.
  * `clock.now()` entrega `snapshot_ts_ms` y `snapshot_date_utc`.
  * **Efectos**: escribe `raw/*.json`, `layouts.jsonl`, `layouts_index.csv`, `widgets.csv`.
  * No devuelve nada; en error, registra log y **no escribe**.

* `toLayoutsIndexRows(layouts: Layout[], snapshot): LayoutIndexRow[]`

  * Extrae: `layout_id, version, name, icon, widget_count` + snapshot.

* `toWidgetRows(layouts: Layout[], snapshot): WidgetRow[]`

  * Expande `widgets` agregando `layout_id` y `layout_name`.

* `appendJsonl(path: string, objects: any[]): Promise<void>`

  * Añade cada objeto como línea JSON en `layouts.jsonl`.

* `appendCsv(path: string, rows: Row[], header: string[]): Promise<void>`

  * Crea el archivo si no existe (con cabecera) y **append** de filas.

> No se hace “merge” entre snapshots distintos: son históricos.

---

## 7) Ejemplos de filas con tus datos

**layouts_index.csv**

```
snapshot_ts_ms,snapshot_date_utc,layout_id,version,name,icon,widget_count
1762910135000,2025-11-12,6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da,1.0.0,SPY 60-30-15,LAYOUT,6
1762910135000,2025-11-12,9a624e15-84c5-4a0e-8391-69f32b32d8d5,1.0.0,SPY 5-1-0,LAYOUT,2
1762910135000,2025-11-12,c59d5a8e-397f-421a-a6e4-8ffe753c3456,1.0.0,SPY options,LAYOUT,1
1762910135000,2025-11-12,0413b972-f84e-4ce7-8eae-c0a50b96cc90,1.0.0,SPX options,LAYOUT,1
1762910135000,2025-11-12,a869fb2f-88a0-478e-8e7d-66e73e6e02ae,1.0.0,Advanced options,TABLES,6
1762910135000,2025-11-12,b3d3c7d2-7a55-45ae-9509-aa9e042e2e0b,1.0.0,Futures,LAYOUT,6
```

**widgets.csv** (muestras)

```
snapshot_ts_ms,snapshot_date_utc,layout_id,layout_name,widget_id,widgetType,typeSlot,pos_x,pos_y,size_height,size_width
1762910135000,2025-11-12,6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da,SPY 60-30-15,16fb0d62-8b78-4ec1-9b49-de608f34fb6d,WIDGET_TYPE_CHART,0,0,12,12,8
1762910135000,2025-11-12,6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da,SPY 60-30-15,7c16a75b-a8a5-4449-a495-9e6f46aebe2f,WIDGET_TYPE_CHART,0,8,0,12,8
...
1762910135000,2025-11-12,c59d5a8e-397f-421a-a6e4-8ffe753c3456,SPY options,1052edbf-9da6-46c0-a9e4-0a645e58e4de,WIDGET_TYPE_OPTION_CHAIN,0,0,0,24,24
```

---

## 8) Interacciones con otros archivos (y por qué)

* **Ninguna obligatoria**.
  Este dataset es **independiente**; describe **layouts y widgets**.
  Si deseas **mapear un layout a un módulo** (por ejemplo, tu módulo “spy-5m-1m” abre la `layout_id` `6bb4…`), puedes mantener un **archivo de mapeo** aparte (p.ej., `data/app/layouts/module_map.csv`: `module_name,layout_id,motivo`) — pero **no es necesario** para guardar la petición 4.

---

## 9) Expectativas de funciones y usos

* Estos archivos sirven para:

  * Trazabilidad: ¿qué layouts y widgets hay, y cómo cambian día a día?
  * Automatización: reabrir un layout concreto con su `layout_id`.
  * Auditoría: `raw/*.json` conserva exactamente lo que devolvió la API.

* Las funciones no devuelven valores complejos: escriben a disco y registran logs.
  En error (formato inesperado / I/O), **no escriben** y **reportan**.

---

## 10) Notas de seguridad

* **No** persistir `Authorization`, ni headers.
* Solo el cuerpo JSON.
* El endpoint no incluye datos sensibles de cuenta (no aparece `account_number`), por lo que no requiere anonimización adicional.

---
