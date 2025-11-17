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



PUNTO 39:
Buenísima, ahora sí tenemos **news por instrumento** 💚.
Este endpoint es perfecto para tu módulo de “noticias SPY” y para features tipo *feed de eventos*.

Voy con el protocolo: esquema → normalización → guardado.

---

## 1. Clasificación rápida

* **Endpoint:**
  `GET https://dora.robinhood.com/feed/instrument/8f92e76f-1e0e-4478-8580-16a6ffcfaef5/?`
* **Transporte:** `http`
* **Dominio:** `news_feed`
* **Instrumento principal:**

  * `instrument_id: 8f92e76f-1e0e-4478-8580-16a6ffcfaef5`
  * `symbol: SPY`
* **Uso:** noticias/artículos relacionados con SPY (y otros símbolos asociados en cada nota).

En tu `Envelope` lo marcaría como:

```ts
topic: 'instrument_news'
```

---

## 2. Esquema del payload crudo

### 2.1. Top-level response

```ts
type DoraInstrumentFeedResponse = {
  next: string | null;
  previous: string | null;
  results: DoraFeedSection[];
};

type DoraFeedSection = {
  display_label: string;        // "Company"
  category: string;             // "company"
  templates: string[];          // ["news_regular"]
  contents: DoraFeedContent[];  // las noticias de verdad están aquí
  url: string;                  // "https://dora.robinhood.com/feed/?category=company"
  description: string | null;
  ranking_version: string;      // "v0.1"
  id: string;                   // id de la sección
  logo_asset_name: string | null;
  display_label_info_action: unknown | null;
  feed_type: string | null;
  feed_location: string | null;
};
```

### 2.2. Contenido (noticias)

```ts
type DoraFeedContent = {
  content_type: 'feed_article';   // lo que te interesa
  data: DoraArticleData;
  id: string;                     // id del contenido en el feed
  reason: string;                 // "instrument"
  instrument_id: string | null;   // casi siempre null aquí
  instrument_sector: string | null;
};

type DoraArticleData = {
  source: string;                 // "TipRanks", "Nasdaq", "Barchart", etc.
  title: string;
  published_at: string;           // "2025-11-12T21:25:03.000000Z" (ISO)
  related_instruments: Array<{
    instrument_id: string;
    symbol: string;
    name: string;
    sector: string | null;
    simple_name: string | null;
  }>;
  related_assets: Array<{
    asset_id: string;
    asset_type: 'equity' | 'index' | string;
    symbol: string;
  }>;
  url: string;                    // link a la noticia
  feedback: {
    positive_count: number;
  };
  media: null | {
    url: string;
    width: number;
    height: number;
    mimetype: string;
  };
  preview_media: unknown | null;
  preview_text: string;           // el “snippet” que ves en Robinhood
  is_embedded: boolean;
  logo_hex_code: string | null;
  authors: string;                // string ya preformateado
  popularity: number;             // 0 en tus ejemplos
};
```

### 2.3. Envelope específico

```ts
type InstrumentNewsEnvelope = Envelope & {
  topic: 'instrument_news';
  instrument_id: string;
  symbol: string;
  payload: DoraInstrumentFeedResponse;
};
```

---

## 3. Cómo recibirlo (handler)

```ts
async function fetchInstrumentNews(
  client: HttpClient,
  instrumentId: string,
  symbol: string
): Promise<InstrumentNewsEnvelope> {
  const url = `https://dora.robinhood.com/feed/instrument/${instrumentId}/?`;
  const text = await client.getText(url);
  const payload = safeJsonParse<DoraInstrumentFeedResponse>(text);

  return {
    ts: Date.now(),
    transport: 'http',
    source: url,
    topic: 'instrument_news',
    symbol,
    instrument_id: instrumentId,
    payload,
  };
}
```

---

## 4. Normalización: qué filas queremos

De este tocho solo te interesa **una fila por noticia** (mínimo).
Luego, si quieres algo más avanzado, puedes generar *una fila por noticia x símbolo relacionado*, pero eso puede venir después.

Yo te propongo una tabla/tipo:

```ts
type InstrumentNewsRow = {
  symbol: string;                // SPY
  instrument_id: string;         // id de SPY

  article_id: string;            // content.id
  provider: string;              // data.source
  title: string;
  published_ts: number;          // epoch ms
  published_at: string;          // ISO original
  date: string;                  // YYYY-MM-DD (extraído de published_at)

  url: string;
  preview_text: string;

  authors: string | null;
  popularity: number | null;

  // agregados útiles
  related_symbols: string;       // "SPY,QQQ,SPX" (join)
  related_asset_types: string;   // "equity,index"

  has_media: boolean;
  media_url: string | null;
  media_width: number | null;
  media_height: number | null;
  media_mimetype: string | null;

  // hueco para futuro NLP
  sentiment: string | null;      // "pos","neg","neu" o null
  sentiment_score: number | null;

  fetched_ts: number;
  source_transport: 'http';
  source_url: string;
};
```

Helpers:

```ts
function toEpochMs(iso: string): number {
  return Date.parse(iso);
}

function isoToDate(iso: string): string {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}
```

Normalizador principal:

```ts
function normaliseInstrumentNews(env: InstrumentNewsEnvelope): InstrumentNewsRow[] {
  const res = env.payload;

  const rows: InstrumentNewsRow[] = [];

  for (const section of res.results) {
    for (const content of section.contents) {
      if (content.content_type !== 'feed_article') continue;

      const d = content.data;
      const published_ts = toEpochMs(d.published_at);
      const date = isoToDate(d.published_at);

      const relatedSymbols = d.related_assets?.map(a => a.symbol).join(',') ?? '';
      const relatedTypes = d.related_assets?.map(a => a.asset_type).join(',') ?? '';

      const media = d.media;

      rows.push({
        symbol: env.symbol,
        instrument_id: env.instrument_id,

        article_id: content.id,
        provider: d.source,
        title: d.title,
        published_ts,
        published_at: d.published_at,
        date,

        url: d.url,
        preview_text: d.preview_text,

        authors: d.authors || null,
        popularity: d.popularity ?? null,

        related_symbols: relatedSymbols,
        related_asset_types: relatedTypes,

        has_media: !!media,
        media_url: media?.url ?? null,
        media_width: media?.width ?? null,
        media_height: media?.height ?? null,
        media_mimetype: media?.mimetype ?? null,

        sentiment: null,
        sentiment_score: null,

        fetched_ts: env.ts,
        source_transport: env.transport,
        source_url: env.source,
      });
    }
  }

  return rows;
}
```

---

## 5. ¿Dónde y cómo guardar?

Aquí engancho con el esquema de news que te propuse al principio del proyecto:

### Ruta base por símbolo y fecha de publicación

```text
data/stock/SPY/2025-11-12/news.csv
data/stock/SPY/2025-11-11/news.csv
...
```

* La **partición** la haces por `date = published_at[0:10]`.
* Así, una misma llamada que trae artículos de varios días se reparte en varios archivos.

### Encabezado `news.csv`

```csv
symbol,instrument_id,article_id,provider,title,published_ts,published_at,date,url,preview_text,authors,popularity,related_symbols,related_asset_types,has_media,media_url,media_width,media_height,media_mimetype,sentiment,sentiment_score,fetched_ts,source_transport,source_url
```

### Lógica de escritura (pseudo)

```ts
function persistInstrumentNews(rows: InstrumentNewsRow[]) {
  const groups = groupBy(rows, r => `${r.symbol}/${r.date}`); // p.ej "SPY/2025-11-12"

  for (const [key, group] of Object.entries(groups)) {
    const [symbol, date] = key.split('/');
    const dir = `data/stock/${symbol}/${date}`;
    const filePath = `${dir}/news.csv`;

    appendCsv(filePath, group, { ensureHeader: true });
  }
}
```

---

## 6. ¿Se guarda o no?

* ✅ **Sí**, merece la pena guardar, pero como **eventos ligeros**:

  * Tienes:

    * fecha/hora,
    * fuente,
    * título,
    * preview,
    * URL,
    * símbolos relacionados.
  * Te sirve para:

    * ver qué noticias había alrededor de un spike de precio,
    * alimentar un motor de alertas (por ejemplo, “cuando haya news de SPY con palabra ‘shutdown’”),
    * entrenar un futuro modelo de sentimiento (usa `preview_text` y `title`).

* **No guardas**:

  * Body completo del artículo (no lo tienes aquí, solo el link),
  * datos irrelevantes para trading (p. ej. `ranking_version`, `feed_location`).

Opcionalmente puedes limitar:

* Solo guardar noticias de los últimos **N días** o
* No duplicar `article_id` (si repites llamada al mismo feed).

---

## 7. Resumen rápido para esta petición

1. **Recibes** `InstrumentNewsEnvelope` con `topic='instrument_news'`.
2. **Normalizas**:

   * Flatten `response.results[].contents[]`
   * Filtras `content_type === 'feed_article'`
   * Mapeas a `InstrumentNewsRow`.
3. **Particionas** por `symbol` y `date` (de `published_at`) y haces append a:

   * `data/stock/SPY/YYYY-MM-DD/news.csv`
4. **Campos clave para tu motor de trading**:

   * `published_ts` (timeline),
   * `provider`, `title`, `preview_text`, `url`,
   * `related_symbols` (para saber si toca QQQ, SPX, NVDA, etc.).

---