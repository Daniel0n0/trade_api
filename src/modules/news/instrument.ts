import path from 'node:path';

import { upsertCsv, type CsvRowInput } from '../../io/upsertCsv.js';
import { safeJsonParse } from '../../utils/payload.js';
import type { HttpClient } from '../instrument/index.js';

type Envelope = {
  readonly ts: number;
  readonly transport: 'http' | 'ws' | string;
  readonly source: string;
  readonly payload: unknown;
};

export type DoraInstrumentFeedResponse = {
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly DoraFeedSection[];
};

export type DoraFeedSection = {
  readonly display_label: string;
  readonly category: string;
  readonly templates: readonly string[];
  readonly contents: readonly DoraFeedContent[];
  readonly url: string;
  readonly description: string | null;
  readonly ranking_version: string;
  readonly id: string;
  readonly logo_asset_name: string | null;
  readonly display_label_info_action: unknown | null;
  readonly feed_type: string | null;
  readonly feed_location: string | null;
};

export type DoraFeedContent = {
  readonly content_type: 'feed_article' | string;
  readonly data: DoraArticleData;
  readonly id: string;
  readonly reason: string;
  readonly instrument_id: string | null;
  readonly instrument_sector: string | null;
};

export type DoraArticleData = {
  readonly source: string;
  readonly title: string;
  readonly published_at: string;
  readonly related_instruments: ReadonlyArray<{
    readonly instrument_id: string;
    readonly symbol: string;
    readonly name: string;
    readonly sector: string | null;
    readonly simple_name: string | null;
  }>;
  readonly related_assets: ReadonlyArray<{
    readonly asset_id: string;
    readonly asset_type: string;
    readonly symbol: string;
  }>;
  readonly url: string;
  readonly feedback: { readonly positive_count: number };
  readonly media:
    | null
    | {
        readonly url: string;
        readonly width: number;
        readonly height: number;
        readonly mimetype: string;
      };
  readonly preview_media: unknown | null;
  readonly preview_text: string;
  readonly is_embedded: boolean;
  readonly logo_hex_code: string | null;
  readonly authors: string;
  readonly popularity: number;
};

export type InstrumentNewsEnvelope = Envelope & {
  readonly topic: 'instrument_news';
  readonly instrument_id: string;
  readonly symbol: string;
  readonly payload: DoraInstrumentFeedResponse;
};

export type InstrumentNewsRow = {
  readonly symbol: string;
  readonly instrument_id: string;

  readonly article_id: string;
  readonly provider: string;
  readonly title: string;
  readonly published_ts: number;
  readonly published_at: string;
  readonly date: string;

  readonly url: string;
  readonly preview_text: string;

  readonly authors: string | null;
  readonly popularity: number | null;

  readonly related_symbols: string;
  readonly related_asset_types: string;

  readonly has_media: boolean;
  readonly media_url: string | null;
  readonly media_width: number | null;
  readonly media_height: number | null;
  readonly media_mimetype: string | null;

  readonly sentiment: string | null;
  readonly sentiment_score: number | null;

  readonly fetched_ts: number;
  readonly source_transport: 'http';
  readonly source_url: string;
};

export type InstrumentNewsCsvRow = CsvRowInput<typeof INSTRUMENT_NEWS_HEADER>;

export const INSTRUMENT_NEWS_HEADER = [
  'symbol',
  'instrument_id',
  'article_id',
  'provider',
  'title',
  'published_ts',
  'published_at',
  'date',
  'url',
  'preview_text',
  'authors',
  'popularity',
  'related_symbols',
  'related_asset_types',
  'has_media',
  'media_url',
  'media_width',
  'media_height',
  'media_mimetype',
  'sentiment',
  'sentiment_score',
  'fetched_ts',
  'source_transport',
  'source_url',
] as const;

const toEpochMs = (iso: string | null | undefined, fallback: number): number => {
  if (!iso) {
    return fallback;
  }
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const isoToDate = (iso: string | undefined | null, fallbackTs: number): string => {
  if (iso && iso.length >= 10) {
    return iso.slice(0, 10);
  }
  return new Date(fallbackTs).toISOString().slice(0, 10);
};

export async function fetchInstrumentNews(
  client: HttpClient,
  instrumentId: string,
  symbol: string,
): Promise<InstrumentNewsEnvelope> {
  const source = `https://dora.robinhood.com/feed/instrument/${instrumentId}/?`;
  const text = await client.getText(source);
  const payload = safeJsonParse<DoraInstrumentFeedResponse>(text) ?? {
    next: null,
    previous: null,
    results: [],
  };

  return {
    ts: Date.now(),
    transport: 'http',
    source,
    topic: 'instrument_news',
    symbol,
    instrument_id: instrumentId,
    payload,
  };
}

export function normaliseInstrumentNews(env: InstrumentNewsEnvelope): InstrumentNewsRow[] {
  const results = env.payload?.results ?? [];
  const rows: InstrumentNewsRow[] = [];

  for (const section of results) {
    for (const content of section.contents ?? []) {
      if (content.content_type !== 'feed_article') {
        continue;
      }

      const d = content.data;
      const published_ts = toEpochMs(d?.published_at, env.ts);
      const published_at = d?.published_at ?? '';
      const date = isoToDate(d?.published_at, published_ts);

      const relatedSymbols = d?.related_assets?.map((asset) => asset.symbol).join(',') ?? '';
      const relatedTypes = d?.related_assets?.map((asset) => asset.asset_type).join(',') ?? '';
      const media = d?.media ?? null;

      rows.push({
        symbol: env.symbol,
        instrument_id: env.instrument_id,

        article_id: content.id,
        provider: d?.source ?? '',
        title: d?.title ?? '',
        published_ts,
        published_at,
        date,

        url: d?.url ?? '',
        preview_text: d?.preview_text ?? '',

        authors: d?.authors || null,
        popularity: d?.popularity ?? null,

        related_symbols: relatedSymbols,
        related_asset_types: relatedTypes,

        has_media: Boolean(media),
        media_url: media?.url ?? null,
        media_width: media?.width ?? null,
        media_height: media?.height ?? null,
        media_mimetype: media?.mimetype ?? null,

        sentiment: null,
        sentiment_score: null,

        fetched_ts: env.ts,
        source_transport: 'http',
        source_url: env.source,
      });
    }
  }

  return rows;
}

export async function persistInstrumentNews(rows: readonly InstrumentNewsRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const groups = new Map<string, InstrumentNewsRow[]>();
  for (const row of rows) {
    const key = `${row.symbol}/${row.date}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const tasks: Promise<void>[] = [];
  for (const [key, group] of groups.entries()) {
    const [symbol, date] = key.split('/');
    const filePath = path.join('data', 'stocks', symbol, date, 'news.csv');
    tasks.push(upsertCsv(filePath, INSTRUMENT_NEWS_HEADER, group, (row) => String(row.article_id)));
  }

  await Promise.all(tasks);
}

export async function syncInstrumentNews(
  client: HttpClient,
  instrumentId: string,
  symbol: string,
): Promise<InstrumentNewsRow[]> {
  const envelope = await fetchInstrumentNews(client, instrumentId, symbol);
  const rows = normaliseInstrumentNews(envelope);
  await persistInstrumentNews(rows);
  return rows;
}
