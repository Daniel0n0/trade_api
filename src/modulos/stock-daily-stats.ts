import type { WriteStream } from 'node:fs';
import type { Response } from 'playwright';

import { registerCloser } from '../bootstrap/signals.js';
import { MODULE_URL_CODES } from '../config.js';
import { getCsvWriter } from '../io/csvWriter.js';
import { dataPath } from '../io/paths.js';
import { toCsvLine } from '../io/row.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { safeJsonParse } from '../utils/payload.js';

const JSON_MIME_PATTERN = /application\/json/i;

const STATS_HEADER = ['ts', 'symbol', 'source', 'metric', 'value'] as const;
type StatsHeader = typeof STATS_HEADER;
type StatsRow = Partial<Record<StatsHeader[number], string | number | undefined>>;

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

const isJsonResponse = (response: Response): boolean => {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  return typeof contentType === 'string' && JSON_MIME_PATTERN.test(contentType);
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
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
  if (typeof value === 'bigint') {
    return Number(value);
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
  const candidates = [
    record.symbol,
    record.eventSymbol,
    record.ticker,
    record.instrument,
    record.id,
  ];
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

type ExtractStatsContext = {
  readonly symbol: string;
  readonly source: string;
};

const extractStatsRows = (payload: unknown, context: ExtractStatsContext): StatsRow[] => {
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

const resolvePrimarySymbol = (symbols: readonly string[] | undefined): string => {
  if (!symbols || symbols.length === 0) {
    throw new Error('[stock-daily-stats] Se requiere al menos un símbolo para capturar estadísticas.');
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

  throw new Error('[stock-daily-stats] No se pudo determinar un símbolo válido.');
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

export const runStockDailyStatsModule: ModuleRunner = async (args, { page }) => {
  const symbol = resolvePrimarySymbol(args.symbols);
  const urlCode = args.urlCode ?? MODULE_URL_CODES['stock-daily-stats'];
  const statsPath = dataPath({ assetClass: 'stock', symbol }, 'stats.csv');

  let writer: WriteStream | null = null;
  const trackedStreams = new Set<WriteStream>();
  const seenRows = new Set<string>();

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
    const containsSymbol = upperUrl.includes(symbol.toUpperCase());
    const containsCode = urlCode ? upperUrl.includes(urlCode.toUpperCase()) : false;
    return containsSymbol || containsCode || /fundamental|stats|instruments|marketdata/i.test(url);
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

    let payload: unknown;
    try {
      const text = await response.text();
      if (!text) {
        return;
      }
      payload = safeJsonParse(text);
    } catch (error) {
      console.warn('[stock-daily-stats] No se pudo leer la respuesta JSON:', error);
      return;
    }

    if (!payload) {
      return;
    }

    const rows = extractStatsRows(payload, { symbol, source: url });
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
      stream.write(`${toCsvLine(STATS_HEADER, row)}\n`);
    }
  };

  page.on('response', handleResponse);

  registerCloser(async () => {
    page.off('response', handleResponse);
    const closing = Array.from(trackedStreams.values()).map((stream) => closeStream(stream));
    if (closing.length > 0) {
      await Promise.allSettled(closing);
    }
  });

  return statsPath;
};

