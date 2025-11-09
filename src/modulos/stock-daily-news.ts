import type { WriteStream } from 'node:fs';
import type { Response, WebSocket } from 'playwright';

import { registerCloser } from '../bootstrap/signals.js';
import { MODULE_URL_CODES } from '../config.js';
import { getCsvWriter } from '../io/csvWriter.js';
import { dataPath } from '../io/paths.js';
import { toCsvLine } from '../io/row.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { RotatingWriter } from './rotating-writer.js';
import { LEGEND_WS_PATTERN, normaliseFramePayload, safeJsonParse } from '../utils/payload.js';

const JSON_MIME_PATTERN = /application\/json/i;
const NEWS_URL_HINT = /news|article|legend/i;

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

type WriteMeta = {
  readonly transport: 'http' | 'ws';
  readonly source: string;
};

const NEWS_ROTATE_POLICY = {
  maxBytes: 10_000_000,
  maxMinutes: 60,
  gzipOnRotate: false,
} as const;

const isJsonResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  return typeof contentType === 'string' && JSON_MIME_PATTERN.test(contentType);
};

const resolveSymbol = (symbols: readonly string[] | undefined): string => {
  if (!symbols || symbols.length === 0) {
    throw new Error('[stock-daily-news] Se requiere al menos un símbolo para capturar noticias.');
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
  throw new Error('[stock-daily-news] No se encontró un símbolo válido.');
};

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

const looksLikeNewsRecord = (record: Record<string, unknown>): boolean => {
  const keys = Object.keys(record);
  return keys.some((key) => {
    const lower = key.toLowerCase();
    return (
      lower.includes('title') ||
      lower.includes('headline') ||
      lower.includes('summary') ||
      lower.includes('published') ||
      lower.includes('article')
    );
  });
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

export const runStockDailyNewsModule: ModuleRunner = async (args, { page }) => {
  const symbol = resolveSymbol(args.symbols);
  const urlCode = args.urlCode ?? MODULE_URL_CODES['stock-daily-news'];

  const csvPath = dataPath({ assetClass: 'stock', symbol }, 'news.csv');
  const jsonlPath = dataPath({ assetClass: 'stock', symbol }, 'news.jsonl');

  const csvStream = getCsvWriter(csvPath, NEWS_HEADER);
  const jsonlWriter = new RotatingWriter(jsonlPath, NEWS_ROTATE_POLICY);

  const trackedStreams = new Set<WriteStream>([csvStream]);
  const websocketClosers = new Map<WebSocket, () => void>();
  const seen = new Set<string>();

  const writeItem = (item: NormalizedNewsItem, meta: WriteMeta) => {
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
    const upperUrl = url.toUpperCase();
    const containsSymbol = upperUrl.includes(symbol.toUpperCase());
    const containsCode = urlCode ? upperUrl.includes(urlCode.toUpperCase()) : false;
    return containsSymbol || containsCode || NEWS_URL_HINT.test(url);
  };

  const processPayload = (payload: unknown, meta: WriteMeta) => {
    const items = extractNewsItems(payload);
    for (const item of items) {
      writeItem(item, meta);
    }
  };

  const handleResponse = async (response: Response) => {
    if (!isJsonResponse(response)) {
      return;
    }
    const url = response.url();
    if (!shouldProcessUrl(url)) {
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
      console.warn('[stock-daily-news] No se pudo leer la respuesta JSON:', error);
      return;
    }

    if (!parsed) {
      return;
    }

    processPayload(parsed, { transport: 'http', source: url });
  };

  const handleWebSocket = (socket: WebSocket) => {
    const url = socket.url();
    if (!LEGEND_WS_PATTERN.test(url)) {
      return;
    }

    const onFrame = (frame: string) => {
      const { parsed, text } = normaliseFramePayload(frame);
      const payload = parsed ?? (text ? safeJsonParse(text) : undefined);
      if (!payload) {
        return;
      }
      processPayload(payload, { transport: 'ws', source: url });
    };

    const onClose = () => {
      socket.off('framereceived', onFrame);
      socket.off('close', onClose);
      websocketClosers.delete(socket);
    };

    socket.on('framereceived', onFrame);
    socket.on('close', onClose);
    websocketClosers.set(socket, () => {
      socket.off('framereceived', onFrame);
      socket.off('close', onClose);
    });
  };

  page.on('response', handleResponse);
  page.on('websocket', handleWebSocket);

  registerCloser(async () => {
    page.off('response', handleResponse);
    page.off('websocket', handleWebSocket);
    for (const closer of websocketClosers.values()) {
      closer();
    }
    websocketClosers.clear();

    const closing = Array.from(trackedStreams.values()).map((stream) => closeStream(stream));
    if (closing.length > 0) {
      await Promise.allSettled(closing);
    }
    jsonlWriter.close();
  });

  return { csvPath, jsonlPath };
};

