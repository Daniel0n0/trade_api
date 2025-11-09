import type { WriteStream } from 'node:fs';
import type { Page, Response } from 'playwright';

import { getCsvWriter } from '../../io/csvWriter.js';
import { dataPath } from '../../io/paths.js';
import { toCsvLine } from '../../io/row.js';
import { safeJsonParse } from '../../utils/payload.js';

export const FUTURES_HISTORICAL_PATTERN = /marketdata\/futures\/historicals/i;
export const FUTURES_SNAPSHOT_PATTERN = /marketdata\/futures\/(?:prices|snapshots)/i;

export const FUTURES_BARS_HEADER = [
  'beginsAt',
  'open',
  'high',
  'low',
  'close',
  'volume',
  'session',
  'symbol',
  'instrumentId',
  'interval',
  'span',
  'bounds',
] as const;

export type FuturesBarHeader = typeof FUTURES_BARS_HEADER;

export const FUTURES_SNAPSHOT_HEADER = [
  'asOf',
  'markPrice',
  'bidPrice',
  'bidSize',
  'askPrice',
  'askSize',
  'lastTradePrice',
  'lastTradeSize',
  'previousClose',
  'openInterest',
  'symbol',
  'instrumentId',
] as const;

export type FuturesSnapshotHeader = typeof FUTURES_SNAPSHOT_HEADER;

type FuturesCsvRow<T extends readonly string[]> = Partial<Record<T[number], string | number>>;

type NormalizeContext = {
  readonly url?: string;
  readonly fallbackSymbol?: string;
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

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
};

const toIsoString = (value: unknown): string | undefined => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined;
    }
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

const normaliseSymbol = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.toUpperCase();
};

const parseInstrumentFromUrl = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && !lastSegment.includes('.')) {
      return lastSegment.toUpperCase();
    }
    const penultimate = segments[segments.length - 2];
    return penultimate ? penultimate.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
};

const extractArray = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.results)) {
      return record.results;
    }
    if (Array.isArray(record.data)) {
      return record.data;
    }
    if (Array.isArray(record.data_points)) {
      return record.data_points;
    }
    if (Array.isArray(record.bars)) {
      return record.bars;
    }
  }
  return [];
};

const extractSymbol = (payload: unknown, fallbackSymbol: string | undefined): string | undefined => {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const candidates = [
      record.symbol,
      record.contract_code,
      record.contractCode,
      record.future_symbol,
      record.futureSymbol,
      record.code,
      record.instrument_id,
      record.instrumentId,
    ];
    for (const candidate of candidates) {
      const resolved = normaliseSymbol(candidate);
      if (resolved) {
        return resolved;
      }
    }
  }
  return fallbackSymbol;
};

const extractQueryParams = (url: string | undefined) => {
  if (!url) {
    return new URLSearchParams();
  }
  try {
    const parsed = new URL(url);
    return parsed.searchParams;
  } catch {
    return new URLSearchParams();
  }
};

const hasNumericFields = (row: Record<string, unknown>, keys: readonly string[]): boolean => {
  return keys.some((key) => {
    const value = row[key];
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return false;
  });
};

export function normalizeFuturesBars(
  payload: unknown,
  context: NormalizeContext,
): FuturesCsvRow<typeof FUTURES_BARS_HEADER>[] {
  const fallbackSymbol = normaliseSymbol(context.fallbackSymbol);
  const query = extractQueryParams(context.url);
  const payloadSymbol = extractSymbol(payload, fallbackSymbol);
  const instrumentId = parseInstrumentFromUrl(context.url) ?? extractSymbol(payload, undefined);
  const interval = toStringValue((payload as Record<string, unknown> | undefined)?.interval) ?? query.get('interval') ?? undefined;
  const span = toStringValue((payload as Record<string, unknown> | undefined)?.span) ?? query.get('span') ?? undefined;
  const bounds = toStringValue((payload as Record<string, unknown> | undefined)?.bounds) ?? query.get('bounds') ?? undefined;

  const out: FuturesCsvRow<typeof FUTURES_BARS_HEADER>[] = [];
  for (const entry of extractArray(payload)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const beginsAt =
      toIsoString(record.begins_at) ??
      toIsoString(record.beginsAt) ??
      toIsoString(record.starts_at) ??
      toIsoString(record.start_at) ??
      toIsoString(record.startTime) ??
      toIsoString(record.timestamp);
    if (!beginsAt) {
      continue;
    }

    const rowSymbol =
      extractSymbol(record, payloadSymbol ?? normaliseSymbol(query.get('symbol') ?? query.get('symbols'))) ??
      fallbackSymbol;
    const open = toNumber(record.open_price ?? record.openPrice ?? record.open);
    const high = toNumber(record.high_price ?? record.highPrice ?? record.high);
    const low = toNumber(record.low_price ?? record.lowPrice ?? record.low);
    const close =
      toNumber(record.close_price ?? record.closePrice ?? record.close ?? record.price ?? record.mark_price ?? record.markPrice);
    const volume = toNumber(record.volume ?? record.volume_avg ?? record.volumeAvg);
    const session = toStringValue(record.session ?? record.market_session ?? record.marketSession)?.toUpperCase();

    const row: FuturesCsvRow<typeof FUTURES_BARS_HEADER> = {
      beginsAt,
      open,
      high,
      low,
      close,
      volume,
      session,
      symbol: rowSymbol,
      instrumentId,
      interval: interval ?? undefined,
      span: span ?? undefined,
      bounds: bounds ?? undefined,
    };

    if (!rowSymbol) {
      row.symbol = fallbackSymbol;
    }

    if (!hasNumericFields(row, ['open', 'high', 'low', 'close', 'volume'])) {
      continue;
    }

    out.push(row);
  }

  return out;
}

export function normalizeFuturesSnapshots(
  payload: unknown,
  context: NormalizeContext,
): FuturesCsvRow<typeof FUTURES_SNAPSHOT_HEADER>[] {
  const fallbackSymbol = normaliseSymbol(context.fallbackSymbol);
  const query = extractQueryParams(context.url);
  const payloadSymbol = extractSymbol(payload, fallbackSymbol);
  const instrumentId =
    parseInstrumentFromUrl(context.url) ??
    normaliseSymbol((payload as Record<string, unknown> | undefined)?.instrument_id) ??
    extractSymbol(payload, undefined);

  const out: FuturesCsvRow<typeof FUTURES_SNAPSHOT_HEADER>[] = [];
  for (const entry of extractArray(payload)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rowSymbol =
      extractSymbol(record, payloadSymbol ?? normaliseSymbol(query.get('symbol') ?? query.get('symbols'))) ?? fallbackSymbol;

    const markPrice = toNumber(record.mark_price ?? record.markPrice ?? record.price ?? record.last_price ?? record.lastPrice);
    const bidPrice = toNumber(record.bid_price ?? record.bidPrice);
    const bidSize = toNumber(record.bid_size ?? record.bidSize);
    const askPrice = toNumber(record.ask_price ?? record.askPrice);
    const askSize = toNumber(record.ask_size ?? record.askSize);
    const lastTradePrice =
      toNumber(record.last_trade_price ?? record.lastTradePrice ?? record.last_price ?? record.price ?? record.mark_price);
    const lastTradeSize = toNumber(record.last_trade_size ?? record.lastTradeSize ?? record.last_size ?? record.size);
    const previousClose = toNumber(record.previous_close_price ?? record.previousClosePrice ?? record.prev_close ?? record.prevClose);
    const openInterest = toNumber(record.open_interest ?? record.openInterest);
    const asOf =
      toIsoString(record.mark_price_timestamp ?? record.markPriceTimestamp ?? record.updated_at ?? record.updatedAt ?? record.timestamp) ??
      toIsoString((payload as Record<string, unknown> | undefined)?.updated_at);
    const instrument =
      normaliseSymbol(record.instrument_id ?? record.instrumentId ?? record.id ?? instrumentId) ?? instrumentId ?? undefined;

    const row: FuturesCsvRow<typeof FUTURES_SNAPSHOT_HEADER> = {
      asOf,
      markPrice,
      bidPrice,
      bidSize,
      askPrice,
      askSize,
      lastTradePrice,
      lastTradeSize,
      previousClose,
      openInterest,
      symbol: rowSymbol,
      instrumentId: instrument,
    };

    if (!hasNumericFields(row, [
      'markPrice',
      'bidPrice',
      'askPrice',
      'lastTradePrice',
      'previousClose',
      'openInterest',
    ])) {
      continue;
    }

    out.push(row);
  }

  return out;
}

type FuturesRecorderOptions = {
  readonly page: Page;
  readonly logPrefix?: string;
  readonly symbols?: readonly string[];
  readonly onDiscoveredSymbols?: (symbols: readonly string[]) => void;
};

export type FuturesRecorderHandle = {
  readonly close: () => Promise<void>;
};

const isJsonContentType = (headers: Record<string, string | undefined>): boolean => {
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  if (!contentType) {
    return false;
  }
  return /json/i.test(contentType);
};

export function installFuturesRecorder(options: FuturesRecorderOptions): FuturesRecorderHandle {
  const { page } = options;
  const fallbackSymbol = options.symbols?.[0];
  const tracked = new Set<WriteStream>();
  const seenSymbols = new Set<string>();

  const getWriter = (file: string, header: readonly string[]): WriteStream => {
    const writer = getCsvWriter(file, header);
    tracked.add(writer);
    return writer;
  };

  const closeWriters = async (): Promise<void> => {
    const closing = Array.from(tracked.values()).map(
      (stream) =>
        new Promise<void>((resolve) => {
          if ((stream as { closed?: boolean }).closed || stream.destroyed || stream.writableEnded) {
            resolve();
            return;
          }
          const finish = () => {
            stream.off('error', errorHandler);
            resolve();
          };
          const errorHandler = () => {
            stream.off('finish', finish);
            resolve();
          };
          stream.once('finish', finish);
          stream.once('error', errorHandler);
          stream.end();
        }),
    );

    if (closing.length > 0) {
      await Promise.allSettled(closing);
    }
    tracked.clear();
  };

  const notifyDiscoveredSymbols = (candidates: Iterable<string>) => {
    if (!options.onDiscoveredSymbols) {
      return;
    }

    const fresh: string[] = [];
    for (const candidate of candidates) {
      const normalized = normaliseSymbol(candidate);
      if (!normalized || seenSymbols.has(normalized)) {
        continue;
      }
      seenSymbols.add(normalized);
      fresh.push(normalized);
    }

    if (fresh.length > 0) {
      try {
        options.onDiscoveredSymbols(fresh);
      } catch (error) {
        console.warn('[futures-recorder] Error al notificar símbolos descubiertos:', error);
      }
    }
  };

  const extractSymbolsFromRows = <T extends readonly string[]>(rows: readonly FuturesCsvRow<T>[]): string[] => {
    const symbols: string[] = [];
    for (const row of rows) {
      const candidate = normaliseSymbol((row.symbol as string | undefined) ?? fallbackSymbol);
      if (candidate) {
        symbols.push(candidate);
      }
    }
    return symbols;
  };

  const handleBars = (payload: unknown, url: string | undefined) => {
    const rows = normalizeFuturesBars(payload, { url, fallbackSymbol });
    for (const row of rows) {
      const symbol = (row.symbol as string | undefined) ?? fallbackSymbol ?? 'GENERAL';
      const filePath = dataPath({ assetClass: 'futures', symbol }, 'bars', 'futures-bars.csv');
      getWriter(filePath, FUTURES_BARS_HEADER).write(toCsvLine(FUTURES_BARS_HEADER, row));
    }
    notifyDiscoveredSymbols(extractSymbolsFromRows(rows));
  };

  const handleSnapshots = (payload: unknown, url: string | undefined) => {
    const rows = normalizeFuturesSnapshots(payload, { url, fallbackSymbol });
    for (const row of rows) {
      const symbol = (row.symbol as string | undefined) ?? fallbackSymbol ?? 'GENERAL';
      const filePath = dataPath({ assetClass: 'futures', symbol }, 'snapshots', 'futures-snapshots.csv');
      getWriter(filePath, FUTURES_SNAPSHOT_HEADER).write(toCsvLine(FUTURES_SNAPSHOT_HEADER, row));
    }
    notifyDiscoveredSymbols(extractSymbolsFromRows(rows));
  };

  const handleResponse = async (response: Response) => {
    const url = response.url();
    if (!FUTURES_HISTORICAL_PATTERN.test(url) && !FUTURES_SNAPSHOT_PATTERN.test(url)) {
      return;
    }
    if (response.status() >= 400) {
      return;
    }

    const headers = response.headers();
    if (!isJsonContentType(headers)) {
      return;
    }

    let text: string;
    try {
      const body = await response.body();
      text = body.toString('utf8');
    } catch (error) {
      console.warn('[futures-recorder] No se pudo leer la respuesta:', error);
      return;
    }

    const parsed = safeJsonParse<unknown>(text);
    if (!parsed) {
      return;
    }

    if (FUTURES_HISTORICAL_PATTERN.test(url)) {
      handleBars(parsed, url);
      return;
    }

    if (FUTURES_SNAPSHOT_PATTERN.test(url)) {
      handleSnapshots(parsed, url);
    }
  };

  const onResponse = (response: Response) => {
    void handleResponse(response);
  };

  page.on('response', onResponse);

  return {
    close: async () => {
      page.off('response', onResponse);
      await closeWriters();
    },
  } satisfies FuturesRecorderHandle;
}
