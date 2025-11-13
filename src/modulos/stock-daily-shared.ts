import type { WriteStream } from 'node:fs';
import type { Response, WebSocket } from 'playwright';

import { registerCloser } from '../bootstrap/signals.js';
import { getCsvWriter } from '../io/csvWriter.js';
import { dataPath } from '../io/paths.js';
import { toCsvLine } from '../io/row.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import {
  collectOptionRecords,
  deriveChainSymbol,
  normalizeExpiration,
  normaliseOptionType,
} from '../modules/options/interceptor.js';
import { RotatingWriter } from './rotating-writer.js';
import { normaliseFramePayload, safeJsonParse } from '../utils/payload.js';

const JSON_MIME_PATTERN = /application\/json/i;
const STATS_URL_HINT = /fundamental|stats|marketdata|phoenix|instruments|quote/i;
const DORA_INSTRUMENT_FEED_HINT = 'dora\\.robinhood\\.com\\/(?:feed|feeds)\\/instrument(?:\\b|[:\\/?#]|$)';

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
const DORA_INSTRUMENT_PATH_PATTERN = /\/feeds?\/instrument(?=[:\/]|$|[?#])/i;
const ORDERBOOK_URL_HINT = /order[-_ ]?book|level2|depth|phoenix|marketdata|quotes/i;
const GREEKS_URL_HINT = /options|greeks|chains|chain|marketdata|phoenix|legend/i;
const STOCK_WS_PATTERN = /(legend|phoenix|stream|socket|ws)/i;
const ROBINHOOD_HOST_PATTERN = /(^|\.)robinhood\.com$/i;
const ROBINHOOD_JSON_PATH_HINT = new RegExp(
  `${STATS_URL_HINT.source}|${NEWS_URL_HINT.source}|${ORDERBOOK_URL_HINT.source}|${GREEKS_URL_HINT.source}`,
  'i',
);
const STATS_HOST_PATTERN = /^(?:api|legend|midlands|phoenix)\.robinhood\.com$/i;
const NEWS_HOST_PATTERN = /^(?:api|legend|midlands|phoenix|dora)\.robinhood\.com$/i;
const ORDERBOOK_HOST_PATTERN = /^(?:api|legend|midlands|phoenix)\.robinhood\.com$/i;
const GREEKS_HOST_PATTERN = /^(?:api|legend|midlands|phoenix)\.robinhood\.com$/i;
const SYMBOL_PARAM_KEY_PATTERN = /(symbol|instrument|ticker|target|underlying|security|id)/i;

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

const normaliseEscapedUrl = (input: string): string => {
  return input.replace(/\\\//g, '/');
};

const tryParseUrl = (value: string): URL | undefined => {
  if (!value) {
    return undefined;
  }
  const candidates = [value];
  const normalised = normaliseEscapedUrl(value);
  if (normalised !== value) {
    candidates.push(normalised);
  }
  for (const candidate of candidates) {
    try {
      return new URL(candidate);
    } catch {
      try {
        return new URL(candidate, 'https://robinhood.com');
      } catch {
        // continue trying with the next candidate
      }
    }
  }
  return undefined;
};

const symbolMatchesPath = (pathname: string, symbol: string): boolean => {
  if (!pathname) {
    return false;
  }
  const normalizedSymbol = symbol.toUpperCase();
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    try {
      if (decodeURIComponent(segment).toUpperCase() === normalizedSymbol) {
        return true;
      }
    } catch {
      if (segment.toUpperCase() === normalizedSymbol) {
        return true;
      }
    }
  }
  return false;
};

const symbolMatchesSearch = (url: URL, symbol: string): boolean => {
  const normalizedSymbol = symbol.toLowerCase();
  for (const [key, value] of url.searchParams.entries()) {
    if (!value || !SYMBOL_PARAM_KEY_PATTERN.test(key)) {
      continue;
    }
    const tokens = value.split(/[,|\s]+/);
    for (const token of tokens) {
      if (token && token.trim().toLowerCase() === normalizedSymbol) {
        return true;
      }
    }
  }
  return false;
};

const escapeRegExp = (value: string): string => {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
};

const createSymbolBoundaryPattern = (symbol: string): RegExp => {
  const escaped = escapeRegExp(symbol.toUpperCase());
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?=[^A-Z0-9]|$)`, 'i');
};

const matchesSymbol = (parsed: URL | undefined, rawUrl: string, symbol: string, fallbackPattern: RegExp): boolean => {
  if (parsed) {
    if (symbolMatchesPath(parsed.pathname, symbol)) {
      return true;
    }
    if (symbolMatchesSearch(parsed, symbol)) {
      return true;
    }
    if (parsed.hash && fallbackPattern.test(parsed.hash)) {
      return true;
    }
  }
  return fallbackPattern.test(rawUrl);
};

const isJsonResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  if (typeof contentType !== 'string' || !JSON_MIME_PATTERN.test(contentType)) {
    return false;
  }
  const url = response.url();
  if (!url) {
    return false;
  }
  const parsed = tryParseUrl(url);
  if (!parsed) {
    return false;
  }
  return ROBINHOOD_HOST_PATTERN.test(parsed.hostname) && ROBINHOOD_JSON_PATH_HINT.test(parsed.href);
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

export const createStatsFeature = (symbol: string): StatsFeature => {
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

  const symbolPattern = createSymbolBoundaryPattern(symbol);

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !STATS_URL_HINT.test(trimmedUrl)) {
      return false;
    }
    const parsed = tryParseUrl(trimmedUrl);
    if (!parsed) {
      return symbolPattern.test(trimmedUrl);
    }
    if (!STATS_HOST_PATTERN.test(parsed.hostname)) {
      return false;
    }
    return matchesSymbol(parsed, trimmedUrl, symbol, symbolPattern);
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

const UNICODE_ESCAPE_PATTERN = /\\u([0-9a-fA-F]{4})/g;

const decodeUnicodeEscapes = (value: string): string | null => {
  if (!value.includes('\\u')) {
    return null;
  }

  let mutated = false;
  const decoded = value.replace(UNICODE_ESCAPE_PATTERN, (match, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    if (Number.isNaN(codePoint)) {
      return match;
    }
    mutated = true;
    return String.fromCharCode(codePoint);
  });

  return mutated ? decoded : null;
};

const pushCandidate = (queue: string[], candidate: string | null | undefined): void => {
  if (!candidate) {
    return;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return;
  }
  queue.push(trimmed);
};

const matchesDoraInstrumentFeed = (rawUrl: string): boolean => {
  const seed = rawUrl.trim();
  if (!seed) {
    return false;
  }

  const queue = [seed];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const candidate = queue.pop();
    if (!candidate || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    if (DORA_INSTRUMENT_FEED_INLINE_PATTERN.test(candidate)) {
      return true;
    }

    const lowered = candidate.toLowerCase();
    if (DORA_INSTRUMENT_PATH_PATTERN.test(lowered)) {
      return true;
    }

    if (candidate.includes('\\/')) {
      const unescaped = candidate.replace(/\\\//g, '/');
      if (!visited.has(unescaped)) {
        queue.push(unescaped);
      }
    }

    const unicodeDecoded = decodeUnicodeEscapes(candidate);
    if (unicodeDecoded && !visited.has(unicodeDecoded)) {
      queue.push(unicodeDecoded);
    }

    const percentDecoded = decodeUriComponentSafely(candidate);
    if (percentDecoded && percentDecoded !== candidate && !visited.has(percentDecoded)) {
      queue.push(percentDecoded);
    }

    const parsed = parseUrlSafely(candidate);
    if (!parsed) {
      continue;
    }

    if (DORA_HOST_PATTERN.test(parsed.hostname)) {
      if (DORA_INSTRUMENT_PATH_PATTERN.test(parsed.pathname.toLowerCase())) {
        return true;
      }
      if (DORA_INSTRUMENT_PATH_PATTERN.test(parsed.href.toLowerCase())) {
        return true;
      }
    }

    pushCandidate(queue, parsed.pathname);
    pushCandidate(queue, parsed.search);
    pushCandidate(queue, parsed.hash);

    for (const value of parsed.searchParams.values()) {
      pushCandidate(queue, value);
    }
  }

  return false;
};

const containsDoraInstrumentFeedHint = (rawUrl: string): boolean => {
  if (!rawUrl) {
    return false;
  }

  if (matchesDoraInstrumentFeed(rawUrl)) {
    return true;
  }

  const parsed = parseUrlSafely(rawUrl);
  if (!parsed) {
    return false;
  }

  if (DORA_HOST_PATTERN.test(parsed.hostname)) {
    const loweredPath = parsed.pathname.toLowerCase();
    if (DORA_INSTRUMENT_PATH_PATTERN.test(loweredPath)) {
      return true;
    }
  }

  if (parsed.hash && matchesDoraInstrumentFeed(parsed.hash)) {
    return true;
  }

  for (const value of parsed.searchParams.values()) {
    if (matchesDoraInstrumentFeed(value)) {
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

  const symbolPattern = createSymbolBoundaryPattern(symbol);

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return false;
    }

    if (containsDoraInstrumentFeedHint(trimmedUrl)) {
      return true;
    }

    if (
      DORA_INSTRUMENT_PATH_PATTERN.test(trimmedUrl) &&
      (!trimmedUrl.includes('://') || /dora\.robinhood\.com/i.test(trimmedUrl))
    ) {
      return true;
    }

    const normalizedUrl = trimmedUrl.toLowerCase();
    if (normalizedUrl !== trimmedUrl && containsDoraInstrumentFeedHint(normalizedUrl)) {
      return true;
    }
    const parsed = tryParseUrl(trimmedUrl);
    if (!parsed) {
      if (!NEWS_URL_HINT.test(trimmedUrl)) {
        return false;
      }
      return symbolPattern.test(trimmedUrl);
    }

    if (DORA_HOST_PATTERN.test(parsed.hostname) && DORA_INSTRUMENT_PATH_PATTERN.test(parsed.pathname)) {
      return true;
    }

    if (!NEWS_URL_HINT.test(trimmedUrl) || !NEWS_HOST_PATTERN.test(parsed.hostname)) {
      return false;
    }

    if (DORA_HOST_PATTERN.test(parsed.hostname)) {
      return true;
    }

    return matchesSymbol(parsed, trimmedUrl, symbol, symbolPattern);
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

export const createOrderbookFeature = (symbol: string): OrderbookFeature => {
  const csvPath = dataPath({ assetClass: 'stock', symbol }, 'orderbook', 'levels.csv');
  const stream = getCsvWriter(csvPath, ORDERBOOK_HEADER);
  const loggedSources = new Set<string>();

  const symbolPattern = createSymbolBoundaryPattern(symbol);

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }
    const trimmedUrl = url.trim();
    if (!trimmedUrl || !ORDERBOOK_URL_HINT.test(trimmedUrl)) {
      return false;
    }
    const parsed = tryParseUrl(trimmedUrl);
    if (!parsed) {
      return symbolPattern.test(trimmedUrl);
    }
    if (!ORDERBOOK_HOST_PATTERN.test(parsed.hostname)) {
      return false;
    }
    return matchesSymbol(parsed, trimmedUrl, symbol, symbolPattern);
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

const GREEKS_HEADER = [
  'ts',
  'symbol',
  'chainSymbol',
  'occSymbol',
  'optionType',
  'expirationDate',
  'strikePrice',
  'impliedVolatility',
  'delta',
  'gamma',
  'theta',
  'vega',
  'rho',
  'phi',
  'psi',
  'source',
] as const;

type GreeksHeader = typeof GREEKS_HEADER;

type GreeksCsvRow = Partial<Record<GreeksHeader[number], string | number | undefined>>;

type NormalizedGreeksRecord = {
  readonly chainSymbol?: string;
  readonly underlyingSymbol?: string;
  readonly occSymbol?: string;
  readonly optionType?: string;
  readonly expirationDate?: string;
  readonly strikePrice?: number;
  readonly instrumentId?: string;
  readonly optionId?: string;
  readonly impliedVolatility?: number;
  readonly delta?: number;
  readonly gamma?: number;
  readonly theta?: number;
  readonly vega?: number;
  readonly rho?: number;
  readonly phi?: number;
  readonly psi?: number;
};

type GreeksFeature = {
  readonly result: { csvPath: string; jsonlPath: string };
  readonly shouldProcessUrl: (url: string) => boolean;
  readonly processPayload: (payload: unknown, meta: TransportMeta) => void;
  readonly close: () => Promise<void>;
};

const GREEKS_ROTATE_POLICY = {
  maxBytes: 25_000_000,
  maxMinutes: 60,
  gzipOnRotate: false,
} as const;

const GREEK_VALUE_ALIASES: Record<keyof NormalizedGreeksRecord, readonly string[]> = {
  chainSymbol: ['chainSymbol', 'chain_symbol', 'chain'],
  underlyingSymbol: ['underlyingSymbol', 'underlying_symbol', 'symbol'],
  occSymbol: ['occSymbol', 'occ_symbol'],
  optionType: ['optionType', 'option_type', 'type', 'call_put'],
  expirationDate: ['expirationDate', 'expiration_date', 'expiration', 'expiry'],
  strikePrice: ['strikePrice', 'strike_price', 'strike'],
  instrumentId: ['instrumentId', 'instrument_id', 'option_id', 'optionId', 'id'],
  optionId: ['optionId', 'option_id', 'instrumentId', 'instrument_id', 'id'],
  impliedVolatility: ['implied_volatility', 'impliedVolatility', 'mark_iv', 'markIv'],
  delta: ['delta'],
  gamma: ['gamma'],
  theta: ['theta'],
  vega: ['vega'],
  rho: ['rho'],
  phi: ['phi'],
  psi: ['psi'],
};

const pickNumberField = (record: Record<string, unknown>, keys: readonly string[]): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    const parsed = toNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
};

const pickTextField = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    const text = toText(value);
    if (text) {
      return text;
    }
  }
  return undefined;
};

const normaliseChainSymbol = (record: Record<string, unknown>): string | undefined => {
  const derived = deriveChainSymbol(record);
  if (derived) {
    return derived;
  }
  const fallback = pickTextField(record, GREEK_VALUE_ALIASES.chainSymbol);
  return fallback ? fallback.toUpperCase() : undefined;
};

const normaliseOptionTypeField = (record: Record<string, unknown>): string | undefined => {
  const candidate = pickTextField(record, GREEK_VALUE_ALIASES.optionType);
  return candidate ? normaliseOptionType(candidate) : undefined;
};

const normaliseExpirationDate = (record: Record<string, unknown>): string | undefined => {
  const raw = pickTextField(record, GREEK_VALUE_ALIASES.expirationDate);
  return normalizeExpiration(raw);
};

const normaliseStrikePrice = (record: Record<string, unknown>): number | undefined => {
  return pickNumberField(record, GREEK_VALUE_ALIASES.strikePrice);
};

const normaliseInstrumentId = (record: Record<string, unknown>): string | undefined => {
  const raw = pickTextField(record, GREEK_VALUE_ALIASES.instrumentId);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const last = segments.pop();
    return last ?? raw;
  } catch {
    const match = raw.match(/[0-9a-fA-F-]{10,}/);
    return match ? match[0] : raw;
  }
};

const extractGreekValues = (record: Record<string, unknown>): Partial<NormalizedGreeksRecord> => {
  const values: Partial<NormalizedGreeksRecord> = {};
  let matches = 0;
  const numericKeys: (keyof NormalizedGreeksRecord)[] = [
    'impliedVolatility',
    'delta',
    'gamma',
    'theta',
    'vega',
    'rho',
    'phi',
    'psi',
  ];
  for (const key of numericKeys) {
    const aliases = GREEK_VALUE_ALIASES[key];
    const value = pickNumberField(record, aliases);
    if (value !== undefined) {
      values[key] = value;
      matches += 1;
    }
  }
  return matches > 0 ? values : {};
};

const normaliseGreeksRecord = (record: Record<string, unknown>): NormalizedGreeksRecord | undefined => {
  const greekValues = extractGreekValues(record);
  if (Object.keys(greekValues).length === 0) {
    return undefined;
  }

  const chainSymbol = normaliseChainSymbol(record);
  const underlyingSymbol = pickTextField(record, GREEK_VALUE_ALIASES.underlyingSymbol)?.toUpperCase();
  const occSymbol = pickTextField(record, GREEK_VALUE_ALIASES.occSymbol);
  const optionType = normaliseOptionTypeField(record);
  const expirationDate = normaliseExpirationDate(record);
  const strikePrice = normaliseStrikePrice(record);
  const instrumentId = normaliseInstrumentId(record);
  const optionId = pickTextField(record, GREEK_VALUE_ALIASES.optionId) ?? instrumentId;

  return {
    chainSymbol,
    underlyingSymbol,
    occSymbol,
    optionType,
    expirationDate,
    strikePrice,
    instrumentId,
    optionId,
    ...greekValues,
  };
};

const collectGreeksRecords = (payload: unknown): NormalizedGreeksRecord[] => {
  if (!looksLikeGreeksPayload(payload)) {
    return [];
  }
  const records = collectOptionRecords(payload);
  const normalized = records
    .map((record) => normaliseGreeksRecord(record))
    .filter((entry): entry is NormalizedGreeksRecord => Boolean(entry));
  return normalized;
};

export const createGreeksFeature = (symbol: string): GreeksFeature => {
  const csvPath = dataPath({ assetClass: 'stock', symbol }, 'greeks.csv');
  const jsonlPath = dataPath({ assetClass: 'stock', symbol }, 'greeks.jsonl');

  const csvStream = getCsvWriter(csvPath, GREEKS_HEADER);
  const jsonlWriter = new RotatingWriter(jsonlPath, GREEKS_ROTATE_POLICY);
  const trackedStreams = new Set<WriteStream>([csvStream]);
  const loggedSources = new Set<string>();

  const shouldProcessUrl = (url: string): boolean => {
    if (!url) {
      return false;
    }
    const trimmed = url.trim();
    if (!trimmed || !GREEKS_URL_HINT.test(trimmed)) {
      return false;
    }
    const parsed = tryParseUrl(trimmed);
    if (!parsed) {
      return false;
    }
    return GREEKS_HOST_PATTERN.test(parsed.hostname);
  };

  const processPayload = (payload: unknown, meta: TransportMeta) => {
    const entries = collectGreeksRecords(payload);
    if (entries.length === 0) {
      return;
    }

    for (const entry of entries) {
      const ts = Date.now();
      const csvRow: GreeksCsvRow = {
        ts,
        symbol,
        chainSymbol: entry.chainSymbol ?? entry.underlyingSymbol ?? symbol,
        occSymbol: entry.occSymbol,
        optionType: entry.optionType,
        expirationDate: entry.expirationDate,
        strikePrice: entry.strikePrice,
        impliedVolatility: entry.impliedVolatility,
        delta: entry.delta,
        gamma: entry.gamma,
        theta: entry.theta,
        vega: entry.vega,
        rho: entry.rho,
        phi: entry.phi,
        psi: entry.psi,
        source: meta.source,
      };
      csvStream.write(`${toCsvLine(GREEKS_HEADER, csvRow)}\n`);

      const payloadEntry = {
        ...entry,
        ts,
        symbol,
        transport: meta.transport,
        source: meta.source,
      };
      jsonlWriter.write(JSON.stringify(payloadEntry));
    }

    if (!loggedSources.has(meta.source)) {
      loggedSources.add(meta.source);
      logHook('greeks', { transport: meta.transport, source: meta.source, entries: entries.length });
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



type StockDailyFeatures = {
  readonly stats?: boolean;
  readonly news?: boolean;
  readonly orderbook?: boolean;
  readonly greeks?: boolean;
};

type StockDailyState = {
  stats?: StatsFeature['result'];
  news?: NewsFeature['result'];
  orderbook?: OrderbookFeature['result'];
  greeks?: GreeksFeature['result'];
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
    const greeksFeature = features.greeks ? createGreeksFeature(symbol) : undefined;

    if (LOGGING_ENABLED) {
      const enabledFeatures = [
        statsFeature ? 'stats' : null,
        newsFeature ? 'news' : null,
        orderbookFeature ? 'orderbook' : null,
        greeksFeature ? 'greeks' : null,
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
      const wantsGreeks = greeksFeature?.shouldProcessUrl(url) ?? false;

      if (!wantsStats && !wantsNews && !wantsOrderbook && !wantsGreeks) {
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
      if (wantsGreeks && greeksFeature) {
        greeksFeature.processPayload(parsed, meta);
      }

      logGreeksIfNeeded(parsed, meta);
    };

    const handleWebSocket = (socket: WebSocket) => {
      if (!newsFeature && !orderbookFeature && !greeksFeature) {
        return;
      }

      const url = socket.url();
      if (!STOCK_WS_PATTERN.test(url)) {
        return;
      }

      logHook('ws-open', { module: moduleName, url });

      const processFrame = (payload: string | Buffer) => {
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
        if (greeksFeature) {
          greeksFeature.processPayload(resolved, meta);
        }
        logGreeksIfNeeded(resolved, meta);
      };

      type WsFrame = { payload: string | Buffer };
      const onFrameReceived = ({ payload }: WsFrame) => processFrame(payload);
      const onFrameSent = ({ payload }: WsFrame) => processFrame(payload);

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
    if (newsFeature || orderbookFeature || greeksFeature) {
      page.on('websocket', handleWebSocket);
    }

    registerCloser(async () => {
      page.off('response', handleResponse);
      if (newsFeature || orderbookFeature || greeksFeature) {
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
      if (greeksFeature) {
        closers.push(greeksFeature.close());
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
    if (greeksFeature) {
      state.greeks = greeksFeature.result;
    }

    return buildResult(state);
  };
};

