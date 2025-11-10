import type { WriteStream } from 'node:fs';
import type { Response, WebSocket } from 'playwright';

import { registerCloser } from '../bootstrap/signals.js';
import { getCsvWriter } from '../io/csvWriter.js';
import { dataPath } from '../io/paths.js';
import { toCsvLine } from '../io/row.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { RotatingWriter } from './rotating-writer.js';
import { normaliseFramePayload, safeJsonParse } from '../utils/payload.js';

const JSON_MIME_PATTERN = /application\/json/i;
const STATS_URL_HINT = /fundamental|stats|marketdata|phoenix|instruments|quote/i;
const DORA_INSTRUMENT_FEED_HINT = 'dora\\.robinhood\\.com\\/(?:feed|feeds)\\/instrument(?:\\b|[\\/?#]|$)';

const NEWS_URL_HINT = new RegExp(
  [
    'news',
    'article',
    'phoenix',
    'press',
    'stories',
    'legend',
    'dora',
    'feed',
    'instrument',
    DORA_INSTRUMENT_FEED_HINT,
  ].join('|'),
  'i',
);
const DORA_HOST_PATTERN = /(^|\.)dora\.robinhood\.com$/i;
const DORA_INSTRUMENT_FEED_INLINE_PATTERN = new RegExp(DORA_INSTRUMENT_FEED_HINT, 'i');
const DORA_INSTRUMENT_PATH_PATTERN = /\/feeds?\/instrument(?=\/|$|[?#])/i;
const ORDERBOOK_URL_HINT = /order[-_ ]?book|level2|depth|phoenix|marketdata|quotes/i;
const STOCK_WS_PATTERN = /(legend|phoenix|stream|socket|ws)/i;

const LOG_ENVIRONMENT_FLAGS = [
  'TRADE_API_DEBUG_STOCK_PAGE',
  'TRADE_API_DEBUG_STOCK',
  'DEBUG_STOCK_PAGE',
  'DEBUG_STOCK',
] as const;

const resolveLoggingEnabled = (): boolean => {
  for (const key of LOG_ENVIRONMENT_FLAGS) {
    const value = process.env[key];
    if (typeof value === 'string' && /^(1|true|yes)$/iu.test(value.trim())) {
      return true;
    }
  }
  return false;
};

const LOGGING_ENABLED = resolveLoggingEnabled();

const logHook = (event: string, details: Record<string, unknown>) => {
  if (!LOGGING_ENABLED) {
    return;
  }
  const printable = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );
  // eslint-disable-next-line no-console
  console.info(`[stock-daily][${event}]`, printable);
};

type Transport = 'http' | 'ws';

type TransportMeta = {
  readonly transport: Transport;
  readonly source: string;
};

const isJsonResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  return typeof contentType === 'string' && JSON_MIME_PATTERN.test(contentType);
};

const resolvePrimarySymbol = (symbols: readonly string[] | undefined, moduleName: string): string => {
  if (!symbols || symbols.length === 0) {
    throw new Error(`[${moduleName}] Se requiere al menos un símbolo para continuar.`);
  }

  for (const candidate of symbols) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed.toUpperCase();
    }
  }

  throw new Error(`[${moduleName}] No se encontró un símbolo válido.`);
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const cleaned = trimmed.replace(/,/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const toText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return undefined;
};

const METRIC_ALIASES: Record<string, readonly string[]> = {
  open: ['open', 'open_price', 'openPrice'],
  high: ['high', 'high_price', 'highPrice'],
  low: ['low', 'low_price', 'lowPrice'],
  close: ['close', 'close_price', 'closePrice'],
  volume: ['volume', 'volume_total', 'total_volume'],
  averageVolume: ['average_volume', 'averageVolume', 'volume_average'],
  marketCap: ['market_cap', 'marketCap'],
  peRatio: ['pe_ratio', 'peRatio'],
  dividendYield: ['dividend_yield', 'dividendYield'],
  week52High: ['fifty_two_week_high', 'fiftyTwoWeekHigh', '52_week_high'],
  week52Low: ['fifty_two_week_low', 'fiftyTwoWeekLow', '52_week_low'],
  beta: ['beta'],
};

const METRIC_KEYS = new Set(Object.values(METRIC_ALIASES).flat());

const normaliseMetricKey = (key: string): string | undefined => {
  const lower = key.trim().toLowerCase();
  for (const [metric, aliases] of Object.entries(METRIC_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === lower)) {
      return metric;
    }
  }
  return undefined;
};

const extractSymbolCandidate = (record: Record<string, unknown>): string | undefined => {
  const candidates = [record.symbol, record.eventSymbol, record.ticker, record.instrument, record.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toUpperCase();
    }
  }
  return undefined;
};

const looksLikeStatsRecord = (record: Record<string, unknown>): boolean => {
  return Object.keys(record).some((key) => METRIC_KEYS.has(key));
};

type StatsContext = {
  readonly symbol: string;
  readonly source: string;
};

type StatsRow = {
  readonly ts?: number;
  readonly symbol?: string;
  readonly source?: string;
  readonly metric?: string;
  readonly value?: string | number;
};

const STATS_HEADER = ['ts', 'symbol', 'source', 'metric', 'value'] as const;

type StatsHeader = typeof STATS_HEADER;

type StatsCsvRow = Partial<Record<StatsHeader[number], string | number | undefined>>;

const extractStatsRows = (payload: unknown, context: StatsContext): StatsRow[] => {
  const rows: StatsRow[] = [];
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (typeof current !== 'object') {
      continue;
    }

    const record = current as Record<string, unknown>;
    const candidateSymbol = extractSymbolCandidate(record);
    if (candidateSymbol && candidateSymbol !== context.symbol) {
      continue;
    }

    if (looksLikeStatsRecord(record)) {
      for (const [key, rawValue] of Object.entries(record)) {
        const metric = normaliseMetricKey(key);
        if (!metric) {
          continue;
        }

        const numeric = toNumber(rawValue);
        const text = numeric !== undefined ? numeric : toText(rawValue);
        if (text === undefined) {
          continue;
        }

        rows.push({
          ts: Date.now(),
          symbol: context.symbol,
          source: context.source,
          metric,
          value: text,
        });
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return rows;
};

const closeStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve) => {
    const finalize = () => resolve();
    const handleError = () => {
      stream.off('close', finalize);
      finalize();
    };
    stream.once('close', finalize);
    stream.once('error', handleError);
    if ((stream as { closed?: boolean }).closed || stream.destroyed || stream.writableEnded) {
      stream.off('close', finalize);
      stream.off('error', handleError);
      resolve();
      return;
    }
    stream.end();
  });

type StatsFeature = {
  readonly result: { statsPath: string };
  readonly shouldProcessUrl: (url: string) => boolean;
  readonly processPayload: (payload: unknown, meta: TransportMeta) => void;
  readonly close: () => Promise<void>;
};

const createStatsFeature = (symbol: string): StatsFeature => {
  const statsPath = dataPath({ assetClass: 'stock', symbol }, 'stats.csv');
  let writer: WriteStream | null = null;
  const trackedStreams = new Set<WriteStream>();
  const seenRows = new Set<string>();
  const loggedSources = new Set<string>();

  const ensureWriter = () => {
    if (!writer) {
      writer = getCsvWriter(statsPath, STATS_HEADER);
      trackedStreams.add(writer);
    }
    return writer;
  };

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }
    const upperUrl = url.toUpperCase();
    return upperUrl.includes(symbol) || STATS_URL_HINT.test(url);
  };

  const processPayload = (payload: unknown, meta: TransportMeta) => {
    const rows = extractStatsRows(payload, { symbol, source: meta.source });
    if (rows.length === 0) {
      return;
    }

    const stream = ensureWriter();
    for (const row of rows) {
      const key = `${row.metric ?? ''}|${row.value ?? ''}|${row.source ?? ''}`;
      if (seenRows.has(key)) {
        continue;
      }
      seenRows.add(key);
      const csvRow: StatsCsvRow = {
        ts: row.ts,
        symbol: row.symbol,
        source: row.source,
        metric: row.metric,
        value: row.value,
      };
      stream.write(`${toCsvLine(STATS_HEADER, csvRow)}\n`);
    }

    if (!loggedSources.has(meta.source)) {
      loggedSources.add(meta.source);
      logHook('stats', { transport: meta.transport, source: meta.source, rows: rows.length });
    }
  };

  const close = async () => {
    const closing = Array.from(trackedStreams.values()).map((stream) => closeStream(stream));
    if (closing.length > 0) {
      await Promise.allSettled(closing);
    }
  };

  return {
    result: { statsPath },
    shouldProcessUrl,
    processPayload,
    close,
  };
};

const NEWS_HEADER = ['ts', 'symbol', 'id', 'title', 'publishedAt', 'source', 'author', 'url'] as const;

type NewsHeader = typeof NEWS_HEADER;

type NewsCsvRow = Partial<Record<NewsHeader[number], string | number | undefined>>;

type NormalizedNewsItem = {
  readonly id?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly url?: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly source?: string;
  readonly symbols?: readonly string[];
};

type NewsFeature = {
  readonly result: { csvPath: string; jsonlPath: string };
  readonly shouldProcessUrl: (url: string) => boolean;
  readonly processPayload: (payload: unknown, meta: TransportMeta) => void;
  readonly close: () => Promise<void>;
};

const NEWS_ROTATE_POLICY = {
  maxBytes: 10_000_000,
  maxMinutes: 60,
  gzipOnRotate: false,
} as const;

const toCleanString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return undefined;
};

const toIsoString = (value: unknown): string | undefined => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 9_999_999_999 ? value : value * 1_000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return trimmed;
  }
  return undefined;
};

const extractSymbols = (value: unknown): readonly string[] | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed
      .split(/[\s,|;/]+/)
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === 'string' ? item : undefined))
      .filter((item): item is string => !!item && item.trim().length > 0)
      .map((item) => item.trim().toUpperCase());
    return normalized.length > 0 ? normalized : undefined;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.results)) {
      return extractSymbols(record.results);
    }
  }
  return undefined;
};

const PLACEHOLDER_URL = 'https://placeholder.local';

const parseUrlSafely = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    try {
      return new URL(rawUrl, PLACEHOLDER_URL);
    } catch {
      return null;
    }
  }
};

const decodeUriComponentSafely = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const containsDoraInstrumentHint = (value: string, depth = 0): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  if (DORA_INSTRUMENT_PATH_PATTERN.test(normalized)) {
    return true;
  }

  if (depth >= 3 || !normalized.includes('%')) {
    return false;
  }

  const decoded = decodeUriComponentSafely(value);
  if (!decoded || decoded === value) {
    return false;
  }

  return containsDoraInstrumentHint(decoded, depth + 1);
};

const matchesDoraInstrumentFeed = (rawUrl: string): boolean => {
  const candidate = rawUrl.trim();
  if (!candidate) {
    return false;
  }

  if (DORA_INSTRUMENT_FEED_INLINE_PATTERN.test(candidate)) {
    return true;
  }

  if (containsDoraInstrumentHint(candidate)) {
    return true;
  }

  const parsed = parseUrlSafely(candidate);
  if (!parsed) {
    return false;
  }

  if (DORA_HOST_PATTERN.test(parsed.hostname)) {
    return true;
  }

  if (containsDoraInstrumentHint(parsed.pathname)) {
    return true;
  }

  if (containsDoraInstrumentHint(parsed.search)) {
    return true;
  }

  if (containsDoraInstrumentHint(parsed.hash)) {
    return true;
  }

  for (const value of parsed.searchParams.values()) {
    if (containsDoraInstrumentHint(value)) {
      return true;
    }
  }

  return false;
};

const looksLikeNewsRecord = (record: Record<string, unknown>): boolean => {
  const tokens = ['news', 'article', 'headline', 'story', 'summary'];
  return Object.keys(record).some((key) => tokens.some((token) => key.toLowerCase().includes(token)));
};

const extractNewsItems = (payload: unknown): NormalizedNewsItem[] => {
  const out: NormalizedNewsItem[] = [];
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (typeof current !== 'object') {
      continue;
    }

    const record = current as Record<string, unknown>;
    if (looksLikeNewsRecord(record)) {
      const id =
        toCleanString(record.id) ??
        toCleanString(record.uuid) ??
        toCleanString(record.article_id) ??
        toCleanString(record.slug);
      const title =
        toCleanString(record.title) ??
        toCleanString(record.headline) ??
        toCleanString(record.name) ??
        toCleanString(record.story_title);
      const summary =
        toCleanString(record.summary) ??
        toCleanString(record.description) ??
        toCleanString(record.body) ??
        toCleanString(record.preview_text);
      const url =
        toCleanString(record.url) ??
        toCleanString(record.article_url) ??
        toCleanString(record.link) ??
        toCleanString(record.share_url);
      const author =
        toCleanString(record.author) ??
        toCleanString(record.byline) ??
        toCleanString(record.writer);
      const publishedAt =
        toIsoString(record.published_at) ??
        toIsoString(record.publishedAt) ??
        toIsoString(record.date) ??
        toIsoString(record.created_at) ??
        toIsoString(record.first_published_at) ??
        toIsoString(record.timestamp);
      const source =
        toCleanString(record.source) ??
        toCleanString(record.publisher) ??
        toCleanString(record.provider) ??
        toCleanString(record.partner);
      const symbols =
        extractSymbols(record.symbols) ??
        extractSymbols(record.related_symbols) ??
        extractSymbols(record.tickers);

      if (title || summary || url) {
        out.push({ id, title, summary, url, author, publishedAt, source, symbols: symbols ?? undefined });
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return out;
};

export const createNewsFeature = (symbol: string): NewsFeature => {
  const csvPath = dataPath({ assetClass: 'stock', symbol }, 'news.csv');
  const jsonlPath = dataPath({ assetClass: 'stock', symbol }, 'news.jsonl');

  const csvStream = getCsvWriter(csvPath, NEWS_HEADER);
  const jsonlWriter = new RotatingWriter(jsonlPath, NEWS_ROTATE_POLICY);
  const trackedStreams = new Set<WriteStream>([csvStream]);
  const seen = new Set<string>();
  const loggedSources = new Set<string>();

  const writeItem = (item: NormalizedNewsItem, meta: TransportMeta) => {
    const key = `${item.id ?? ''}|${item.url ?? ''}|${item.title ?? ''}|${item.publishedAt ?? ''}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const ts = Date.now();
    const csvRow: NewsCsvRow = {
      ts,
      symbol,
      id: item.id,
      title: item.title ?? item.summary,
      publishedAt: item.publishedAt,
      source: item.source ?? meta.source,
      author: item.author,
      url: item.url,
    };

    csvStream.write(`${toCsvLine(NEWS_HEADER, csvRow)}\n`);

    const payload = {
      ...item,
      ts,
      symbol,
      transport: meta.transport,
      source: meta.source,
    };
    jsonlWriter.write(JSON.stringify(payload));
  };

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return false;
    }

    if (matchesDoraInstrumentFeed(trimmedUrl)) {
      return true;
    }

    const normalizedUrl = trimmedUrl.toLowerCase();
    if (normalizedUrl.includes(symbol.toLowerCase())) {
      return true;
    }

    if (NEWS_URL_HINT.test(trimmedUrl) || NEWS_URL_HINT.test(normalizedUrl)) {
      return true;
    }

    return false;
  };

  const processPayload = (payload: unknown, meta: TransportMeta) => {
    const items = extractNewsItems(payload);
    if (items.length === 0) {
      return;
    }
    for (const item of items) {
      writeItem(item, meta);
    }
    if (!loggedSources.has(meta.source)) {
      loggedSources.add(meta.source);
      logHook('news', { transport: meta.transport, source: meta.source, items: items.length });
    }
  };

  const close = async () => {
    const closing = Array.from(trackedStreams.values()).map((stream) => closeStream(stream));
    if (closing.length > 0) {
      await Promise.allSettled(closing);
    }
    jsonlWriter.close();
  };

  return {
    result: { csvPath, jsonlPath },
    shouldProcessUrl,
    processPayload,
    close,
  };
};

const ORDERBOOK_HEADER = ['ts', 'symbol', 'side', 'price', 'size', 'level', 'source'] as const;

type OrderbookHeader = typeof ORDERBOOK_HEADER;

type OrderbookRow = Partial<Record<OrderbookHeader[number], string | number | undefined>>;

type OrderbookLevel = {
  readonly side: 'bid' | 'ask';
  readonly price?: number;
  readonly size?: number;
  readonly level?: number;
};

type OrderbookFeature = {
  readonly result: { csvPath: string };
  readonly shouldProcessUrl: (url: string) => boolean;
  readonly processPayload: (payload: unknown, meta: TransportMeta) => void;
  readonly close: () => Promise<void>;
};

const ORDERBOOK_DEPTH_LIMIT = 25;

const pushLevel = (levels: OrderbookLevel[], side: 'bid' | 'ask', entry: unknown, index: number) => {
  if (levels.length >= ORDERBOOK_DEPTH_LIMIT) {
    return;
  }
  if (entry == null) {
    return;
  }

  let price: number | undefined;
  let size: number | undefined;
  let level: number | undefined;

  if (Array.isArray(entry)) {
    price = toNumber(entry[0]);
    size = toNumber(entry[1]);
    level = toNumber(entry[2]);
  } else if (typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    price = toNumber(record.price ?? record[0]);
    size = toNumber(record.size ?? record.quantity ?? record.qty ?? record.volume);
    level = toNumber(record.level ?? record.depth ?? record.rank ?? record.position);
  }

  levels.push({
    side,
    price,
    size,
    level: level ?? index + 1,
  });
};

const collectOrderbookLevels = (payload: unknown, symbol: string): OrderbookLevel[] => {
  const levels: OrderbookLevel[] = [];
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (typeof current !== 'object') {
      continue;
    }

    const record = current as Record<string, unknown>;
    const candidateSymbol = extractSymbolCandidate(record);
    if (candidateSymbol && candidateSymbol !== symbol) {
      continue;
    }

    const bids = record.bids ?? record.Bids ?? record.bid_levels ?? record.bidLevels;
    const asks = record.asks ?? record.Asks ?? record.ask_levels ?? record.askLevels;

    if (Array.isArray(bids)) {
      bids.forEach((entry, index) => pushLevel(levels, 'bid', entry, index));
    }
    if (Array.isArray(asks)) {
      asks.forEach((entry, index) => pushLevel(levels, 'ask', entry, index));
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return levels;
};

const createOrderbookFeature = (symbol: string): OrderbookFeature => {
  const csvPath = dataPath({ assetClass: 'stock', symbol }, 'orderbook', 'levels.csv');
  const stream = getCsvWriter(csvPath, ORDERBOOK_HEADER);
  const loggedSources = new Set<string>();

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }
    const upperUrl = url.toUpperCase();
    return upperUrl.includes(symbol) || ORDERBOOK_URL_HINT.test(url);
  };

  const writeRows = (meta: TransportMeta, levels: readonly OrderbookLevel[]) => {
    for (const level of levels) {
      const row: OrderbookRow = {
        ts: Date.now(),
        symbol,
        side: level.side,
        price: level.price,
        size: level.size,
        level: level.level,
        source: meta.source,
      };
      stream.write(`${toCsvLine(ORDERBOOK_HEADER, row)}\n`);
    }
  };

  const processPayload = (payload: unknown, meta: TransportMeta) => {
    const levels = collectOrderbookLevels(payload, symbol);
    if (levels.length === 0) {
      return;
    }
    writeRows(meta, levels);
    if (!loggedSources.has(meta.source)) {
      loggedSources.add(meta.source);
      logHook('orderbook', { transport: meta.transport, source: meta.source, levels: levels.length });
    }
  };

  const close = async () => {
    await closeStream(stream);
  };

  return {
    result: { csvPath },
    shouldProcessUrl,
    processPayload,
    close,
  };
};

const GREEK_CONTAINER_KEYS = new Set(['greeks', 'greeks_live', 'greeksLive', 'option_greeks']);
const GREEK_VALUE_KEYS = new Set([
  'delta',
  'gamma',
  'theta',
  'vega',
  'rho',
  'phi',
  'psi',
  'implied_volatility',
  'impliedVolatility',
]);

const looksLikeGreeksPayload = (payload: unknown): boolean => {
  const stack: unknown[] = [payload];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (typeof current !== 'object') {
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (GREEK_CONTAINER_KEYS.has(key)) {
        return true;
      }
    }

    let greekMatches = 0;
    for (const key of Object.keys(record)) {
      if (GREEK_VALUE_KEYS.has(key)) {
        greekMatches += 1;
      }
    }
    if (greekMatches >= 2) {
      return true;
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }

  return false;
};

type StockDailyFeatures = {
  readonly stats?: boolean;
  readonly news?: boolean;
  readonly orderbook?: boolean;
};

type StockDailyState = {
  stats?: StatsFeature['result'];
  news?: NewsFeature['result'];
  orderbook?: OrderbookFeature['result'];
};

const logGreeksIfNeeded = (() => {
  const loggedSources = new Set<string>();
  return (payload: unknown, meta: TransportMeta) => {
    if (!LOGGING_ENABLED) {
      return;
    }
    const key = `${meta.transport}|${meta.source}`;
    if (loggedSources.has(key)) {
      return;
    }
    if (looksLikeGreeksPayload(payload)) {
      loggedSources.add(key);
      logHook('greeks', { transport: meta.transport, source: meta.source });
    }
  };
})();

type RunnerOptions<T> = {
  readonly moduleName: string;
  readonly features: StockDailyFeatures;
  readonly buildResult: (state: StockDailyState) => T;
};

export const createStockDailyRunner = <T>(options: RunnerOptions<T>): ModuleRunner => {
  const { moduleName, features, buildResult } = options;

  return async (args, { page }) => {
    const symbol = resolvePrimarySymbol(args.symbols, moduleName);

    const statsFeature = features.stats ? createStatsFeature(symbol) : undefined;
    const newsFeature = features.news ? createNewsFeature(symbol) : undefined;
    const orderbookFeature = features.orderbook ? createOrderbookFeature(symbol) : undefined;

    if (LOGGING_ENABLED) {
      const enabledFeatures = [
        statsFeature ? 'stats' : null,
        newsFeature ? 'news' : null,
        orderbookFeature ? 'orderbook' : null,
      ]
        .filter((item): item is string => item !== null)
        .join(', ');
      logHook('init', { module: moduleName, symbol, features: enabledFeatures });
    }

    const websocketClosers = new Map<WebSocket, () => void>();

    const handleResponse = async (response: Response) => {
      if (!isJsonResponse(response)) {
        return;
      }

      const url = response.url();
      const wantsStats = statsFeature?.shouldProcessUrl(url) ?? false;
      const wantsNews = newsFeature?.shouldProcessUrl(url) ?? false;
      const wantsOrderbook = orderbookFeature?.shouldProcessUrl(url) ?? false;

      if (!wantsStats && !wantsNews && !wantsOrderbook) {
        return;
      }
      if (response.status() >= 400) {
        return;
      }

      let parsed: unknown;
      try {
        const text = await response.text();
        if (!text) {
          return;
        }
        parsed = safeJsonParse(text);
      } catch (error) {
        logHook('error', { module: moduleName, stage: 'response', source: url, error: (error as Error).message });
        return;
      }

      if (!parsed) {
        return;
      }

      const meta: TransportMeta = { transport: 'http', source: url };

      if (wantsStats && statsFeature) {
        statsFeature.processPayload(parsed, meta);
      }
      if (wantsNews && newsFeature) {
        newsFeature.processPayload(parsed, meta);
      }
      if (wantsOrderbook && orderbookFeature) {
        orderbookFeature.processPayload(parsed, meta);
      }

      logGreeksIfNeeded(parsed, meta);
    };

    const handleWebSocket = (socket: WebSocket) => {
      if (!newsFeature && !orderbookFeature) {
        return;
      }

      const url = socket.url();
      if (!STOCK_WS_PATTERN.test(url)) {
        return;
      }

      logHook('ws-open', { module: moduleName, url });

      const processFrame = (payload: unknown) => {
        const { parsed, text } = normaliseFramePayload(payload);
        const resolved = parsed ?? (text ? safeJsonParse(text) : undefined);
        if (!resolved) {
          return;
        }
        const meta: TransportMeta = { transport: 'ws', source: url };
        if (newsFeature) {
          newsFeature.processPayload(resolved, meta);
        }
        if (orderbookFeature) {
          orderbookFeature.processPayload(resolved, meta);
        }
        logGreeksIfNeeded(resolved, meta);
      };

      const onFrameReceived = (event: { payload: string }) => {
        processFrame(event);
      };
      const onFrameSent = (event: { payload: string }) => {
        processFrame(event);
      };

      const onClose = () => {
        socket.off('framereceived', onFrameReceived);
        socket.off('framesent', onFrameSent);
        socket.off('close', onClose);
        websocketClosers.delete(socket);
      };

      socket.on('framereceived', onFrameReceived);
      socket.on('framesent', onFrameSent);
      socket.on('close', onClose);
      websocketClosers.set(socket, () => {
        socket.off('framereceived', onFrameReceived);
        socket.off('framesent', onFrameSent);
        socket.off('close', onClose);
      });
    };

    page.on('response', handleResponse);
    if (newsFeature || orderbookFeature) {
      page.on('websocket', handleWebSocket);
    }

    registerCloser(async () => {
      page.off('response', handleResponse);
      if (newsFeature || orderbookFeature) {
        page.off('websocket', handleWebSocket);
      }

      for (const closer of websocketClosers.values()) {
        closer();
      }
      websocketClosers.clear();

      const closers: Promise<void>[] = [];
      if (statsFeature) {
        closers.push(statsFeature.close());
      }
      if (newsFeature) {
        closers.push(newsFeature.close());
      }
      if (orderbookFeature) {
        closers.push(orderbookFeature.close());
      }
      if (closers.length > 0) {
        await Promise.allSettled(closers);
      }
    });

    const state: StockDailyState = {};
    if (statsFeature) {
      state.stats = statsFeature.result;
    }
    if (newsFeature) {
      state.news = newsFeature.result;
    }
    if (orderbookFeature) {
      state.orderbook = orderbookFeature.result;
    }

    return buildResult(state);
  };
};

