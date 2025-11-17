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



PUNTO 40:

Perfecto, vamos a diseñar ese **comando de saneamiento por temporalidad solo para SPY**.

---

## 1. Objetivo del comando

* **Símbolo fijo:** `SPY`
* **Temporalidades:** `5m`, `15m`, `1h`
* **Fuente de datos:** mismas respuestas que usa el **módulo de gráfica avanzada de velas de SPY**
* **Acción:**

  * Comparar cada vela nueva con lo ya guardado.
  * Si pasa los **middlewares de validación**, actualizar (“sanar”) la data en disco.
  * Si llega una vela de una **fecha que no existe aún**, crear carpeta/archivo para esa fecha y temporalidad.

---

## 2. Firma del comando (CLI sugerido)

Algo así:

```bash
trade_api sanitize-spy-tf \
  --since 2025-10-01 \
  --tfs 5m,15m,1h
```

Internamente:

```ts
type Timeframe = '5m' | '15m' | '1h';

interface SanitizeSpyOptions {
  since?: string;           // YYYY-MM-DD, opcional
  tfs: Timeframe[];         // ['5m','15m','1h']
}
```

---

## 3. Configuración de URLs (con placeholders)

Define un config central para las 3 fuentes de datos (2 URLs nuevas + la existente de la gráfica avanzada):

```ts
const SPY_TF_ENDPOINTS: Record<Timeframe, string> = {
  '5m':  '<<TODO_URL_5M_SPY>>',      // TODO: url nueva 5m
  '15m': '<<TODO_URL_15M_SPY>>',     // TODO: url nueva 15m
  '1h':  '<<TODO_URL_1H_SPY>>',      // TODO: url nueva 1h
};

/**
 * Comentario:
 * Una de estas (por ejemplo la de 5m) puede ser exactamente
 * la URL que usa el módulo de gráfica avanzada de velas del SPY
 * cuando selecciones esa temporalidad en Robinhood.
 */
```

Si prefieres mantener explícito “módulo avanzado”:

```ts
const SPY_ADVANCED_CHART_URL = '<<TODO_URL_GRAFICA_AVANZADA_SPY>>';
```

y documentas en comentario que los payloads que llegan aquí son los que se usan como modelo para las 3 temporalidades.

---

## 4. Esquema mínimo de vela (payload normalizado)

Suponiendo que el módulo avanzado devuelve algo tipo vela OHLC:

```ts
type RawSpyCandle = {
  // nombres aproximados; los adaptas al payload real
  begins_at: string;        // ISO, inicio de la vela
  open_price: string;
  high_price: string;
  low_price: string;
  close_price: string;
  volume: string | number;
  vwap?: string | number;
  session?: string;         // 'reg', 'pre', 'post'
  // ...otros campos que quieras ignorar o guardar
};

type SpyCandleRow = {
  timestamp: number;        // epoch ms (empieza la vela)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  tf: Timeframe;
  source_transport: 'http';
  source_url: string;
};
```

---

## 5. Rutas y archivos (aprovechando lo ya definido)

Solo SPY:

```text
data/stock/SPY/<YYYY-MM-DD>/
  5m.csv
  15m.csv
  1h.csv
```

Columnas de cada `<tf>.csv`:

```text
timestamp,open,high,low,close,volume,vwap,source_transport,source_url
```

> ✅ Con esto, si llega una vela con fecha de un día que aún no existe, simplemente se crea `data/stock/SPY/<fecha>/<tf>.csv` con encabezado y se append/upsert.

---

## 6. Middleware de validación (“saneamiento”)

### 6.1. Validación general (SPY + tipos)

```ts
function validateSpyCandle(raw: RawSpyCandle, tf: Timeframe): boolean {
  // 1) tipo numérico y no NaN
  const nums = [
    raw.open_price,
    raw.high_price,
    raw.low_price,
    raw.close_price,
    raw.volume,
  ].map(Number);

  if (nums.some(n => !Number.isFinite(n))) return false;

  const [open, high, low, close, volume] = nums;

  // 2) OHL C lógico
  if (!(high >= open && high >= close && low <= open && low <= close)) {
    return false;
  }

  if (volume < 0) return false;

  // 3) timestamp válido y alineado a temporalidad
  const ts = Date.parse(raw.begins_at);
  if (!Number.isFinite(ts)) return false;

  const date = new Date(ts);
  const min = date.getUTCMinutes();

  if (tf === '5m'  && min % 5  !== 0) return false;
  if (tf === '15m' && min % 15 !== 0) return false;
  if (tf === '1h'  && min !== 0)      return false;

  // Otros checks: dentro de horarios de mercado si quieres,
  // usando el endpoint /markets/XASE/hours/<date>/ que ya vimos.

  return true;
}
```

### 6.2. Normalización

```ts
function normalizeSpyCandle(raw: RawSpyCandle, tf: Timeframe, sourceUrl: string): SpyCandleRow {
  const ts = Date.parse(raw.begins_at);

  return {
    timestamp: ts,
    open:  Number(raw.open_price),
    high:  Number(raw.high_price),
    low:   Number(raw.low_price),
    close: Number(raw.close_price),
    volume: Number(raw.volume),
    vwap:  raw.vwap != null ? Number(raw.vwap) : null,
    tf,
    source_transport: 'http',
    source_url: sourceUrl,
  };
}
```

---

## 7. Lógica de saneamiento / upsert por vela

### 7.1. Resolver ruta según timestamp + tf

```ts
function resolveSpyPath(row: SpyCandleRow): string {
  const d = new Date(row.timestamp);
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(d.getUTCDate()).padStart(2, '0');

  const dateStr = `${yyyy}-${mm}-${dd}`;

  return `data/stock/SPY/${dateStr}/${row.tf}.csv`;
}
```

### 7.2. Upsert (crea fecha/archivo si no existe)

Pseudo-código:

```ts
async function upsertSpyCandle(row: SpyCandleRow) {
  const filePath = resolveSpyPath(row);

  // 1) si el archivo NO existe -> crear con header + fila
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const header = 'timestamp,open,high,low,close,volume,vwap,source_transport,source_url\n';
    const firstLine = serializeRow(row) + '\n';
    fs.writeFileSync(filePath, header + firstLine);
    return;
  }

  // 2) si ya existe, leer y reemplazar/insertar por timestamp
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const header = lines[0];
  const body   = lines.slice(1);

  const tsStr = String(row.timestamp);
  let replaced = false;

  const newBody = body.map(line => {
    const [ts] = line.split(',');
    if (ts === tsStr) {
      replaced = true;
      return serializeRow(row); // reemplaza la fila corrupta
    }
    return line;
  });

  if (!replaced) {
    // Si no existía, añade y luego (opcional) reordena por timestamp
    newBody.push(serializeRow(row));
    newBody.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));
  }

  fs.writeFileSync(filePath, [header, ...newBody].join('\n') + '\n');
}

function serializeRow(row: SpyCandleRow): string {
  const { timestamp, open, high, low, close, volume, vwap, source_transport, source_url } = row;
  return [
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    vwap ?? '',
    source_transport,
    source_url,
  ].join(',');
}
```

> 🔹 Si llega un dato con **fecha anterior a todo lo que había**, `resolveSpyPath` generará una ruta de un día que no existe → `upsertSpyCandle` creará carpeta y CSV nuevos. Eso cumple tu requisito de backfill automático.

---

## 8. Flujo completo del comando

```ts
async function sanitizeSpyTf(opts: SanitizeSpyOptions) {
  const timeframes = opts.tfs;

  for (const tf of timeframes) {
    const url = SPY_TF_ENDPOINTS[tf]; // TODO: poner URLs reales

    const rawResponse = await fetch(url);
    const json = await rawResponse.json();

    // aquí adaptas a cómo venga exactamente:
    const rawCandles: RawSpyCandle[] = json.results ?? json.candles ?? [];

    for (const raw of rawCandles) {
      if (!validateSpyCandle(raw, tf)) continue;

      const row = normalizeSpyCandle(raw, tf, url);
      await upsertSpyCandle(row);
    }
  }
}
```

---

## 9. Resumen rápido de lo importante

* **Solo SPY**, hardcodeado en rutas.
* **Temporalidades fijas:** `5m`, `15m`, `1h`.
* **3 URLs configurables** (2 nuevas + la del módulo de velas avanzadas) dejadas con `TODO` en comentarios, como pediste.
* **Middleware de validación**:

  * tipos numéricos y OHL C lógicos;
  * alineación exacta de timestamp a la temporalidad;
  * opcional: dentro del horario de mercado.
* **Saneamiento** = *upsert por timestamp*:

  * si existe → reemplaza fila “sucia”;
  * si no existe → añade, creando fecha/archivo si hace falta.

Cuando tengas las URLs reales del módulo avanzado y las nuevas temporalidades, solo tendrías que rellenar los `<<TODO_...>>` y este comando te sirve como “motor de saneamiento” de toda la data histórica e intradía de SPY para 5m, 15m y 1h.


---