import type { WriteStream } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import type { Page, Response } from 'playwright';

import { getCsvWriter } from '../../io/csvWriter.js';
import { dataPath } from '../../io/paths.js';
import { toCsvLine } from '../../io/row.js';
import { safeJsonParse } from '../../utils/payload.js';

export const FUTURES_HISTORICAL_PATTERN = /marketdata\/futures\/historicals/i;
export const FUTURES_SNAPSHOT_PATTERN = /marketdata\/futures\/(?:prices|snapshots|quotes)/i;
export const FUTURES_FUNDAMENTALS_PATTERN = /marketdata\/futures\/fundamentals/i;
export const FUTURES_MARKET_HOURS_PATTERN = /markets\/[\w-]+\/hours/i;
export const FUTURES_CONTRACTS_BY_SYMBOL_PATTERN = /arsenal\/v1\/futures\/contracts\/symbol/i;
export const FUTURES_CONTRACTS_PATTERN = /arsenal\/v1\/futures\/contracts(?!\/symbol)/i;
export const FUTURES_TRADING_SESSIONS_PATTERN = /arsenal\/v1\/futures\/trading_sessions/i;
export const FUTURES_INBOX_THREADS_PATTERN = /inbox\/threads/i;

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
  'bidVenueTimestamp',
  'askPrice',
  'askSize',
  'askVenueTimestamp',
  'lastTradePrice',
  'lastTradeSize',
  'lastTradeVenueTimestamp',
  'previousClose',
  'openInterest',
  'state',
  'symbol',
  'instrumentId',
  'outOfBand',
] as const;

export type FuturesSnapshotHeader = typeof FUTURES_SNAPSHOT_HEADER;

export const FUTURES_FUNDAMENTALS_HEADER = [
  'symbol',
  'instrumentId',
  'productId',
  'rootSymbol',
  'contractType',
  'tradeable',
  'state',
  'open',
  'high',
  'low',
  'volume',
  'previousClose',
  'multiplier',
  'tickSize',
  'initialMargin',
  'maintenanceMargin',
  'overnightMaintenance',
  'listingDate',
  'expirationDate',
  'settlementDate',
  'lastTradeDate',
  'createdAt',
  'updatedAt',
] as const;

export type FuturesFundamentalsHeader = typeof FUTURES_FUNDAMENTALS_HEADER;

export const FUTURES_CONTRACTS_HEADER = [
  'id',
  'symbol',
  'displaySymbol',
  'instrumentId',
  'productId',
  'rootSymbol',
  'contractType',
  'description',
  'tradeable',
  'state',
  'multiplier',
  'tickSize',
  'listingDate',
  'expiration',
  'expirationDate',
  'expirationMmy',
  'customerLastCloseDate',
  'settlementStartTime',
  'firstTradeDate',
  'settlementDate',
  'lastTradeDate',
  'createdAt',
  'updatedAt',
] as const;

export type FuturesContractsHeader = typeof FUTURES_CONTRACTS_HEADER;

export const FUTURES_TRADING_SESSIONS_HEADER = [
  'symbol',
  'instrumentId',
  'productId',
  'sessionScope',
  'tradingDate',
  'sessionType',
  'isTrading',
  'startsAt',
  'endsAt',
  'timezone',
  'market',
  'createdAt',
  'updatedAt',
  'dayDate',
  'dayStartsAt',
  'dayEndsAt',
  'dayIsHoliday',
] as const;

export type FuturesTradingSessionsHeader = typeof FUTURES_TRADING_SESSIONS_HEADER;

export const FUTURES_MARKET_HOURS_HEADER = [
  'symbol',
  'instrumentId',
  'productId',
  'exchange',
  'date',
  'opensAt',
  'closesAt',
  'extendedOpensAt',
  'extendedClosesAt',
  'nextOpenAt',
  'previousCloseAt',
  'previousOpenHoursUrl',
  'nextOpenHoursUrl',
  'lateOptionClosesAt',
  'allDayOpensAt',
  'allDayClosesAt',
  'indexOption0dteClosesAt',
  'indexOptionNon0dteClosesAt',
  'curbOpensAt',
  'curbClosesAt',
  'fxOpensAt',
  'fxClosesAt',
  'fxNextOpenAt',
  'fxIsOpen',
  'isOpen',
  'isHoliday',
  'createdAt',
  'updatedAt',
] as const;

export type FuturesMarketHoursHeader = typeof FUTURES_MARKET_HOURS_HEADER;

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
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
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

const IGNORED_SEGMENT_PATTERNS = [/^\d{4}-\d{2}-\d{2}$/u, /^v\d+$/iu];

const parseInstrumentFromUrl = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }
      const trimmed = segment.trim();
      if (!trimmed || trimmed.includes('.')) {
        continue;
      }
      if (IGNORED_SEGMENT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
        continue;
      }
      const normalised = normaliseSymbol(trimmed);
      if (normalised) {
        return normalised;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
};

const parseExchangeSymbolFromUrl = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const marketsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'markets');
    if (marketsIndex === -1) {
      return undefined;
    }
    const exchangeSegment = segments[marketsIndex + 1];
    if (!exchangeSegment) {
      return undefined;
    }
    return normaliseSymbol(exchangeSegment);
  } catch {
    return undefined;
  }
};

const unwrapNestedData = (value: unknown): unknown => {
  let current = value;
  const visited = new Set<unknown>();
  while (current && typeof current === 'object' && !Array.isArray(current)) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (record.data !== undefined) {
      current = record.data;
      continue;
    }
    if (record.status && typeof record.status === 'object') {
      const status = record.status as Record<string, unknown>;
      if (status.data !== undefined) {
        current = status.data;
        continue;
      }
    }
    break;
  }
  return current;
};

const WRAPPED_ARRAY_KEYS = [
  'results',
  'data',
  'data_points',
  'bars',
  'quotes',
  'fundamentals',
  'entries',
  'values',
  'sessions',
] as const;

const WRAPPED_SINGLE_KEYS = [
  'result',
  'quote',
  'fundamental',
  'entry',
  'payload',
  'body',
  'currentSession',
  'previousSession',
  'nextSession',
] as const;

const WRAPPED_METADATA_KEYS = new Set([
  'status',
  'next',
  'previous',
  'cursor',
  'count',
]);

const unwrapEntry = (value: unknown): readonly unknown[] => {
  const results: unknown[] = [];
  const stack: unknown[] = [];
  const visited = new Set<unknown>();

  const push = (candidate: unknown) => {
    if (candidate === undefined || candidate === null) {
      return;
    }
    stack.push(candidate);
  };

  push(unwrapNestedData(value));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const unwrapped = unwrapNestedData(current);
    if (Array.isArray(unwrapped)) {
      for (const item of unwrapped) {
        push(item);
      }
      continue;
    }

    if (unwrapped && typeof unwrapped === 'object') {
      const record = unwrapped as Record<string, unknown>;
      let delegated = false;

      for (const key of WRAPPED_ARRAY_KEYS) {
        if (key in record) {
          delegated = true;
          const valueAtKey = record[key];
          if (Array.isArray(valueAtKey)) {
            for (const item of valueAtKey) {
              push(item);
            }
          } else {
            push(valueAtKey);
          }
        }
      }

      for (const key of WRAPPED_SINGLE_KEYS) {
        if (key in record) {
          delegated = true;
          push(record[key]);
        }
      }

      if (record.status && typeof record.status === 'object') {
        delegated = true;
        const statusRecord = record.status as Record<string, unknown>;
        if ('data' in statusRecord) {
          push(statusRecord.data);
        }
        if ('result' in statusRecord) {
          push(statusRecord.result);
        }
        if ('results' in statusRecord) {
          push(statusRecord.results);
        }
      }

      if (delegated) {
        const hasBusinessKeys = Object.keys(record).some((key) => {
          return (
            !WRAPPED_METADATA_KEYS.has(key) &&
            !WRAPPED_ARRAY_KEYS.includes(key as (typeof WRAPPED_ARRAY_KEYS)[number]) &&
            !WRAPPED_SINGLE_KEYS.includes(key as (typeof WRAPPED_SINGLE_KEYS)[number])
          );
        });
        if (hasBusinessKeys) {
          results.push(unwrapped);
        }
        continue;
      }

      results.push(unwrapped);
      continue;
    }

    results.push(unwrapped);
  }

  return results;
};

const extractArray = (value: unknown): readonly unknown[] => {
  const candidates = unwrapEntry(value);
  if (candidates.length > 0) {
    return candidates;
  }

  const unwrapped = unwrapNestedData(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.flatMap((item) => unwrapEntry(item));
  }

  if (unwrapped !== undefined && unwrapped !== null) {
    return unwrapEntry(unwrapped);
  }

  return [];
};

const ensureArray = (value: unknown): readonly unknown[] => {
  const fromExtract = extractArray(value);
  if (fromExtract.length > 0) {
    return fromExtract;
  }

  const unwrapped = unwrapNestedData(value);
  if (unwrapped && typeof unwrapped === 'object') {
    return unwrapEntry(unwrapped);
  }

  return [];
};

const pickFromRecord = <T>(
  record: Record<string, unknown>,
  keys: readonly string[],
  converter: (value: unknown) => T | undefined,
): T | undefined => {
  for (const key of keys) {
    if (key in record) {
      const resolved = converter(record[key]);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }
  return undefined;
};

const pickString = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  return pickFromRecord(record, keys, toStringValue);
};

const pickNumber = (record: Record<string, unknown>, keys: readonly string[]): number | undefined => {
  return pickFromRecord(record, keys, toNumber);
};

const pickIsoDate = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  return pickFromRecord(record, keys, toIsoString);
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
  const instrumentId = normaliseSymbol(query.get('ids') ?? undefined) ?? extractSymbol(payload, undefined);

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
    const bidVenueTimestamp = toIsoString(record.bid_venue_timestamp ?? record.bidVenueTimestamp);
    const askPrice = toNumber(record.ask_price ?? record.askPrice);
    const askSize = toNumber(record.ask_size ?? record.askSize);
    const askVenueTimestamp = toIsoString(record.ask_venue_timestamp ?? record.askVenueTimestamp);
    const lastTradePrice =
      toNumber(record.last_trade_price ?? record.lastTradePrice ?? record.last_price ?? record.price ?? record.mark_price);
    const lastTradeSize = toNumber(record.last_trade_size ?? record.lastTradeSize ?? record.last_size ?? record.size);
    const lastTradeVenueTimestamp = toIsoString(
      record.last_trade_venue_timestamp ?? record.lastTradeVenueTimestamp,
    );
    const previousClose = toNumber(record.previous_close_price ?? record.previousClosePrice ?? record.prev_close ?? record.prevClose);
    const openInterest = toNumber(record.open_interest ?? record.openInterest);
    const state = toStringValue(record.state ?? record.trading_status ?? record.status);
    const asOf =
      toIsoString(record.mark_price_timestamp ?? record.markPriceTimestamp ?? record.updated_at ?? record.updatedAt ?? record.timestamp) ??
      toIsoString((payload as Record<string, unknown> | undefined)?.updated_at);
    const instrument =
      normaliseSymbol(record.instrument_id ?? record.instrumentId ?? record.id ?? instrumentId) ?? instrumentId ?? undefined;
    const outOfBand = toStringValue(record.out_of_band ?? record.outOfBand);

    const row: FuturesCsvRow<typeof FUTURES_SNAPSHOT_HEADER> = {
      asOf,
      markPrice,
      bidPrice,
      bidSize,
      bidVenueTimestamp,
      askPrice,
      askSize,
      askVenueTimestamp,
      lastTradePrice,
      lastTradeSize,
      lastTradeVenueTimestamp,
      previousClose,
      openInterest,
      state,
      symbol: rowSymbol,
      instrumentId: instrument,
      outOfBand,
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

export function normalizeFuturesFundamentals(
  payload: unknown,
  context: NormalizeContext,
): FuturesCsvRow<typeof FUTURES_FUNDAMENTALS_HEADER>[] {
  const fallbackSymbol = normaliseSymbol(context.fallbackSymbol);
  const payloadSymbol = extractSymbol(payload, fallbackSymbol);
  const query = extractQueryParams(context.url);
  const queryInstrumentId = normaliseSymbol(query.get('ids') ?? undefined);
  const instrumentFromUrl = parseInstrumentFromUrl(context.url);

  const out: FuturesCsvRow<typeof FUTURES_FUNDAMENTALS_HEADER>[] = [];
  for (const entry of ensureArray(payload)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    let rowSymbol = extractSymbol(record, payloadSymbol ?? fallbackSymbol) ?? fallbackSymbol;
    const instrumentCandidate =
      pickString(record, ['instrument_id', 'instrumentId', 'instrument']) ??
      queryInstrumentId ??
      instrumentFromUrl ??
      rowSymbol ??
      fallbackSymbol;
    const normalizedInstrument =
      instrumentCandidate ? normaliseSymbol(instrumentCandidate) ?? instrumentCandidate : undefined;
    if (rowSymbol && normalizedInstrument && rowSymbol === normalizedInstrument && fallbackSymbol) {
      rowSymbol = fallbackSymbol;
    }
    const productId =
      pickString(record, ['product_id', 'productId', 'product_code', 'productCode', 'product']) ?? undefined;
    const rootRaw = pickString(record, ['root_symbol', 'rootSymbol', 'future_symbol', 'futureSymbol']);
    const contractType = pickString(record, ['contract_type', 'contractType', 'type']);
    const tradeable = pickString(record, ['tradeable', 'tradability', 'is_tradeable', 'isTradeable']);
    const state = pickString(record, ['state', 'trading_status', 'tradingStatus']);
    const open = pickNumber(record, ['open']);
    const high = pickNumber(record, ['high']);
    const low = pickNumber(record, ['low']);
    const volume = pickNumber(record, ['volume']);
    const previousClose = pickNumber(record, ['previous_close_price', 'previousClosePrice', 'prev_close', 'prevClose']);
    const multiplier = pickNumber(record, ['multiplier']);
    const tickSize = pickNumber(record, ['tick_size', 'tickSize']);
    const initialMargin = pickNumber(record, [
      'initial_margin',
      'initial_margin_requirement',
      'initialMargin',
      'initialMarginRequirement',
    ]);
    const maintenanceMargin = pickNumber(record, [
      'maintenance_margin',
      'maintenance_margin_requirement',
      'maintenanceMargin',
      'maintenanceMarginRequirement',
    ]);
    const overnightMaintenance = pickNumber(record, [
      'overnight_maintenance_margin',
      'overnightMaintenanceMargin',
      'overnight_margin',
      'overnightMargin',
    ]);
    const listingDate = pickIsoDate(record, ['listing_date', 'listingDate', 'listed_at', 'listedAt']);
    const expirationDate = pickIsoDate(record, ['expiration_date', 'expirationDate', 'expiry', 'expires_at', 'expiresAt']);
    const settlementDate = pickIsoDate(record, ['settlement_date', 'settlementDate']);
    const lastTradeDate = pickIsoDate(record, [
      'last_trade_date',
      'lastTradeDate',
      'last_trade_time',
      'lastTradeTime',
    ]);
    const createdAt = pickIsoDate(record, ['created_at', 'createdAt']);
    const updatedAt = pickIsoDate(record, ['updated_at', 'updatedAt']);

    const row: FuturesCsvRow<typeof FUTURES_FUNDAMENTALS_HEADER> = {
      symbol: rowSymbol ?? fallbackSymbol,
      instrumentId: normalizedInstrument,
      productId,
      rootSymbol: rootRaw ? normaliseSymbol(rootRaw) ?? rootRaw : undefined,
      contractType,
      tradeable,
      state,
      open,
      high,
      low,
      volume,
      previousClose,
      multiplier,
      tickSize,
      initialMargin,
      maintenanceMargin,
      overnightMaintenance,
      listingDate,
      expirationDate,
      settlementDate,
      lastTradeDate,
      createdAt,
      updatedAt,
    };

    if (!row.symbol) {
      row.symbol = fallbackSymbol;
    }

    if (!row.symbol && !row.instrumentId && !row.productId) {
      continue;
    }

    out.push(row);
  }

  return out;
}

export function normalizeFuturesContracts(
  payload: unknown,
  context: NormalizeContext,
): FuturesCsvRow<typeof FUTURES_CONTRACTS_HEADER>[] {
  const fallbackSymbol = normaliseSymbol(context.fallbackSymbol);
  const payloadSymbol = extractSymbol(payload, fallbackSymbol);
  const query = extractQueryParams(context.url);
  const queryInstrumentId = normaliseSymbol(query.get('ids') ?? undefined);
  const instrumentFromUrl = parseInstrumentFromUrl(context.url);

  const out: FuturesCsvRow<typeof FUTURES_CONTRACTS_HEADER>[] = [];
  for (const entry of ensureArray(payload)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    let rowSymbol = extractSymbol(record, payloadSymbol ?? fallbackSymbol) ?? fallbackSymbol;
    const instrumentCandidate =
      pickString(record, ['instrument_id', 'instrumentId', 'instrument']) ??
      queryInstrumentId ??
      instrumentFromUrl ??
      rowSymbol ??
      fallbackSymbol;
    const normalizedInstrument =
      instrumentCandidate ? normaliseSymbol(instrumentCandidate) ?? instrumentCandidate : undefined;
    if (rowSymbol && normalizedInstrument && rowSymbol === normalizedInstrument && fallbackSymbol) {
      rowSymbol = fallbackSymbol;
    }
    const productId =
      pickString(record, ['product_id', 'productId', 'product_code', 'productCode', 'product']) ?? undefined;
    const rootRaw = pickString(record, ['root_symbol', 'rootSymbol', 'future_symbol', 'futureSymbol']);
    const contractType = pickString(record, ['contract_type', 'contractType', 'type']);
    const description = pickString(record, ['description', 'name', 'title']);
    const tradeable = pickString(record, ['tradeable', 'tradability', 'is_tradeable', 'isTradeable']);
    const state = pickString(record, ['state', 'trading_status', 'tradingStatus']);
    const multiplier = pickNumber(record, ['multiplier']);
    const tickSize = pickNumber(record, ['tick_size', 'tickSize']);
    const listingDate = pickIsoDate(record, ['listing_date', 'listingDate', 'listed_at', 'listedAt']);
    const expiration = pickIsoDate(record, ['expiration']);
    const expirationDate = pickIsoDate(record, ['expiration_date', 'expirationDate', 'expiry', 'expires_at', 'expiresAt']);
    const expirationMmy = pickString(record, ['expiration_mmy', 'expirationMmy']);
    const customerLastCloseDate = pickIsoDate(record, ['customer_last_close_date', 'customerLastCloseDate']);
    const settlementStartTime = pickString(record, ['settlement_start_time', 'settlementStartTime']);
    const firstTradeDate = pickIsoDate(record, ['first_trade_date', 'firstTradeDate']);
    const settlementDate = pickIsoDate(record, ['settlement_date', 'settlementDate']);
    const lastTradeDate = pickIsoDate(record, [
      'last_trade_date',
      'lastTradeDate',
      'last_trade_time',
      'lastTradeTime',
    ]);
    const createdAt = pickIsoDate(record, ['created_at', 'createdAt']);
    const updatedAt = pickIsoDate(record, ['updated_at', 'updatedAt']);
    const contractId = pickString(record, ['id']);
    const normalizedContractId = contractId ? normaliseSymbol(contractId) ?? contractId : undefined;

    const row: FuturesCsvRow<typeof FUTURES_CONTRACTS_HEADER> = {
      id: normalizedContractId,
      symbol: rowSymbol ?? fallbackSymbol,
      displaySymbol: pickString(record, ['display_symbol', 'displaySymbol']),
      instrumentId: normalizedInstrument,
      productId,
      rootSymbol: rootRaw ? normaliseSymbol(rootRaw) ?? rootRaw : undefined,
      contractType,
      description,
      tradeable,
      state,
      multiplier,
      tickSize,
      listingDate,
      expiration,
      expirationDate,
      expirationMmy,
      customerLastCloseDate,
      settlementStartTime,
      firstTradeDate,
      settlementDate,
      lastTradeDate,
      createdAt,
      updatedAt,
    };

    if (!row.symbol) {
      row.symbol = fallbackSymbol;
    }

    if (!row.symbol && !row.instrumentId && !row.productId) {
      continue;
    }

    out.push(row);
  }

  return out;
}

export function normalizeFuturesTradingSessions(
  payload: unknown,
  context: NormalizeContext,
): FuturesCsvRow<typeof FUTURES_TRADING_SESSIONS_HEADER>[] {
  const fallbackSymbol = normaliseSymbol(context.fallbackSymbol);
  const payloadSymbol = extractSymbol(payload, fallbackSymbol);
  const query = extractQueryParams(context.url);
  const queryInstrumentId = normaliseSymbol(query.get('ids') ?? undefined);
  const instrumentFromUrl = parseInstrumentFromUrl(context.url);

  const out: FuturesCsvRow<typeof FUTURES_TRADING_SESSIONS_HEADER>[] = [];
  for (const entry of ensureArray(payload)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    let rowSymbol = extractSymbol(record, payloadSymbol ?? fallbackSymbol) ?? fallbackSymbol;
    const instrumentCandidate =
      pickString(record, [
        'instrument_id',
        'instrumentId',
        'instrument',
        'futures_contract_id',
        'futuresContractId',
      ]) ??
      queryInstrumentId ??
      instrumentFromUrl ??
      rowSymbol ??
      fallbackSymbol;
    const normalizedInstrument =
      instrumentCandidate ? normaliseSymbol(instrumentCandidate) ?? instrumentCandidate : undefined;
    if (rowSymbol && normalizedInstrument && rowSymbol === normalizedInstrument && fallbackSymbol) {
      rowSymbol = fallbackSymbol;
    }
    const productId =
      pickString(record, ['product_id', 'productId', 'product_code', 'productCode', 'product']) ?? undefined;
    const defaultTimezone = pickString(record, ['timezone', 'time_zone']);
    const defaultMarket = pickString(record, ['market', 'exchange']);
    const defaultCreatedAt = pickIsoDate(record, ['created_at', 'createdAt']);
    const defaultUpdatedAt = pickIsoDate(record, ['updated_at', 'updatedAt']);
    const dayDate = pickIsoDate(record, ['date', 'trading_date', 'tradingDate']);
    const dayStartsAt = pickIsoDate(record, ['start_time', 'startTime']);
    const dayEndsAt = pickIsoDate(record, ['end_time', 'endTime']);
    const dayIsHoliday = pickString(record, ['is_holiday', 'isHoliday']);

    const groups: Array<[string, readonly unknown[]]> = [
      ['sessions', unwrapEntry((record as Record<string, unknown>).sessions)],
      ['currentSession', unwrapEntry((record as Record<string, unknown>).currentSession)],
      ['previousSession', unwrapEntry((record as Record<string, unknown>).previousSession)],
      ['nextSession', unwrapEntry((record as Record<string, unknown>).nextSession)],
    ];

    const hasSessionGroupData = groups.some(([, entries]) => entries.length > 0);
    const looksLikeRootRecord =
      hasSessionGroupData ||
      'futures_contract_id' in record ||
      'futuresContractId' in record ||
      'instrument_id' in record ||
      'instrumentId' in record ||
      'product_id' in record ||
      'productId' in record;

    if (looksLikeRootRecord && (dayDate || dayStartsAt || dayEndsAt || dayIsHoliday)) {
      const summaryRow: FuturesCsvRow<typeof FUTURES_TRADING_SESSIONS_HEADER> = {
        symbol: rowSymbol ?? fallbackSymbol,
        instrumentId: normalizedInstrument,
        productId,
        sessionScope: 'summary',
        tradingDate: dayDate,
        startsAt: dayStartsAt,
        endsAt: dayEndsAt,
        timezone: defaultTimezone,
        market: defaultMarket,
        createdAt: defaultCreatedAt,
        updatedAt: defaultUpdatedAt,
        dayDate,
        dayStartsAt,
        dayEndsAt,
        dayIsHoliday,
      };

      if (!summaryRow.symbol) {
        summaryRow.symbol = fallbackSymbol;
      }

      if (summaryRow.symbol || summaryRow.instrumentId || summaryRow.productId) {
        out.push(summaryRow);
      }
    }

    for (const [scope, entries] of groups) {
      for (const sessionEntry of entries) {
        if (!sessionEntry || typeof sessionEntry !== 'object') {
          continue;
        }

        const sessionRecord = sessionEntry as Record<string, unknown>;
        const tradingDate = pickIsoDate(sessionRecord, ['trading_date', 'tradingDate', 'date']);
        const sessionType = pickString(sessionRecord, ['session_type', 'sessionType', 'session']);
        const isTrading = pickString(sessionRecord, ['is_trading', 'isTrading', 'trading']);
        const startsAt = pickIsoDate(sessionRecord, [
          'starts_at',
          'start_time',
          'start_at',
          'startsAt',
          'startTime',
        ]) ??
          pickIsoDate(record, ['start_time', 'startTime']);
        const endsAt = pickIsoDate(sessionRecord, [
          'ends_at',
          'end_time',
          'end_at',
          'endsAt',
          'endTime',
        ]) ??
          pickIsoDate(record, ['end_time', 'endTime']);
        const timezone = pickString(sessionRecord, ['timezone', 'time_zone']) ?? defaultTimezone;
        const market = pickString(sessionRecord, ['market', 'exchange']) ?? defaultMarket;
        const createdAt = pickIsoDate(sessionRecord, ['created_at', 'createdAt']) ?? defaultCreatedAt;
        const updatedAt = pickIsoDate(sessionRecord, ['updated_at', 'updatedAt']) ?? defaultUpdatedAt;

        const row: FuturesCsvRow<typeof FUTURES_TRADING_SESSIONS_HEADER> = {
          symbol: rowSymbol ?? fallbackSymbol,
          instrumentId: normalizedInstrument,
          productId,
          sessionScope: scope,
          tradingDate,
          sessionType,
          isTrading,
          startsAt,
          endsAt,
          timezone,
          market,
          createdAt,
          updatedAt,
        };

        if (!row.symbol) {
          row.symbol = fallbackSymbol;
        }

        if (!row.symbol && !row.instrumentId && !row.productId) {
          continue;
        }

        out.push(row);
      }
    }
  }

  return out;
}

export function normalizeFuturesMarketHours(
  payload: unknown,
  context: NormalizeContext,
): FuturesCsvRow<typeof FUTURES_MARKET_HOURS_HEADER>[] {
  const fallbackSymbol = normaliseSymbol(context.fallbackSymbol);
  const payloadSymbol = extractSymbol(payload, fallbackSymbol);
  const query = extractQueryParams(context.url);
  const queryInstrumentId = normaliseSymbol(query.get('ids') ?? undefined);
  const exchangeFromUrl = parseExchangeSymbolFromUrl(context.url);

  const out: FuturesCsvRow<typeof FUTURES_MARKET_HOURS_HEADER>[] = [];
  for (const entry of ensureArray(payload)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const symbolFromRecord = extractSymbol(record, payloadSymbol ?? fallbackSymbol);
    const exchangeValue = pickString(record, ['exchange', 'market']);
    const exchangeSymbol =
      normaliseSymbol(exchangeValue) ?? exchangeFromUrl ?? symbolFromRecord ?? fallbackSymbol;
    const instrumentCandidate =
      pickString(record, [
        'instrument_id',
        'instrumentId',
        'instrument',
        'futures_contract_id',
        'futuresContractId',
      ]) ??
      queryInstrumentId ??
      undefined;
    const normalizedInstrument =
      instrumentCandidate ? normaliseSymbol(instrumentCandidate) ?? instrumentCandidate : undefined;
    const productId =
      pickString(record, ['product_id', 'productId', 'product_code', 'productCode', 'product']) ?? undefined;
    const exchange = exchangeValue ?? (exchangeSymbol ?? undefined);
    const date = pickIsoDate(record, ['date', 'trading_date', 'tradingDate']);
    const opensAt = pickIsoDate(record, ['opens_at', 'open_time', 'openAt', 'openTime']);
    const closesAt = pickIsoDate(record, ['closes_at', 'close_time', 'closeAt', 'closeTime']);
    const extendedOpensAt = pickIsoDate(record, [
      'extended_opens_at',
      'extended_open_time',
      'extendedOpensAt',
      'extendedOpenTime',
    ]);
    const extendedClosesAt = pickIsoDate(record, [
      'extended_closes_at',
      'extended_close_time',
      'extendedClosesAt',
      'extendedCloseTime',
    ]);
    const nextOpenAt = pickIsoDate(record, ['next_open_at', 'nextOpenAt']);
    const previousCloseAt = pickIsoDate(record, ['previous_close_at', 'previousCloseAt']);
    const previousOpenHoursUrl = pickString(record, [
      'previous_open_hours',
      'previousOpenHours',
      'previous_open_hours_url',
      'previousOpenHoursUrl',
    ]);
    const nextOpenHoursUrl = pickString(record, [
      'next_open_hours',
      'nextOpenHours',
      'next_open_hours_url',
      'nextOpenHoursUrl',
    ]);
    const lateOptionClosesAt = pickIsoDate(record, ['late_option_closes_at', 'lateOptionClosesAt']);
    const allDayOpensAt = pickIsoDate(record, ['all_day_opens_at', 'allDayOpensAt']);
    const allDayClosesAt = pickIsoDate(record, ['all_day_closes_at', 'allDayClosesAt']);
    const indexOption0dteClosesAt = pickIsoDate(record, ['index_option_0dte_closes_at', 'indexOption0dteClosesAt']);
    const indexOptionNon0dteClosesAt = pickIsoDate(record, ['index_option_non_0dte_closes_at', 'indexOptionNon0dteClosesAt']);
    const extendedHours =
      (record.index_options_extended_hours as Record<string, unknown> | undefined) ??
      ((record as Record<string, unknown>).indexOptionsExtendedHours as Record<string, unknown> | undefined);
    const curbOpensAt = pickIsoDate(extendedHours ?? {}, ['curb_opens_at', 'curbOpensAt']);
    const curbClosesAt = pickIsoDate(extendedHours ?? {}, ['curb_closes_at', 'curbClosesAt']);
    const fxOpensAt = pickIsoDate(record, ['fx_opens_at', 'fxOpensAt']);
    const fxClosesAt = pickIsoDate(record, ['fx_closes_at', 'fxClosesAt']);
    const fxNextOpenAt = pickIsoDate(record, ['fx_next_open_hours', 'fxNextOpenHours']);
    const fxIsOpen = pickString(record, ['fx_is_open', 'fxIsOpen']);
    const isOpen = pickString(record, ['is_open', 'isOpen']);
    const isHoliday = pickString(record, ['is_holiday', 'isHoliday']);
    const createdAt = pickIsoDate(record, ['created_at', 'createdAt']);
    const updatedAt = pickIsoDate(record, ['updated_at', 'updatedAt']);

    const row: FuturesCsvRow<typeof FUTURES_MARKET_HOURS_HEADER> = {
      symbol: exchangeSymbol ?? fallbackSymbol,
      instrumentId: normalizedInstrument,
      productId,
      exchange,
      date,
      opensAt,
      closesAt,
      extendedOpensAt,
      extendedClosesAt,
      nextOpenAt,
      previousCloseAt,
      previousOpenHoursUrl,
      nextOpenHoursUrl,
      lateOptionClosesAt,
      allDayOpensAt,
      allDayClosesAt,
      indexOption0dteClosesAt,
      indexOptionNon0dteClosesAt,
      curbOpensAt,
      curbClosesAt,
      fxOpensAt,
      fxClosesAt,
      fxNextOpenAt,
      fxIsOpen,
      isOpen,
      isHoliday,
      createdAt,
      updatedAt,
    };

    if (!row.symbol) {
      row.symbol = fallbackSymbol;
    }

    if (!row.symbol && !row.instrumentId && !row.productId) {
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

const persistInboxThreadsSnapshot = async (payload: string): Promise<void> => {
  const filePath = dataPath(
    { assetClass: 'futures', symbol: 'GENERAL' },
    'overview',
    'inbox-threads.jsonl',
  );

  try {
    await appendFile(filePath, payload.endsWith('\n') ? payload : `${payload}\n`, 'utf8');
  } catch (error) {
    console.warn('[futures-recorder] No se pudo guardar el snapshot de inbox/threads:', error);
  }
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

  const extractSymbolsFromRows = <T extends readonly string[] & readonly ["symbol", ...string[]]>(rows: readonly FuturesCsvRow<T>[]): string[] => {
    const symbols: string[] = [];
    for (const row of rows) {
      const candidate = normaliseSymbol((row["symbol" as T[number]] as string | undefined) ?? fallbackSymbol);
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

  const handleFundamentals = (payload: unknown, url: string | undefined) => {
    const rows = normalizeFuturesFundamentals(payload, { url, fallbackSymbol });
    for (const row of rows) {
      const symbol = (row.symbol as string | undefined) ?? fallbackSymbol ?? 'GENERAL';
      const filePath = dataPath({ assetClass: 'futures', symbol }, 'fundamentals', 'futures-fundamentals.csv');
      getWriter(filePath, FUTURES_FUNDAMENTALS_HEADER).write(toCsvLine(FUTURES_FUNDAMENTALS_HEADER, row));
    }
    notifyDiscoveredSymbols(extractSymbolsFromRows(rows));
  };

  const handleContracts = (payload: unknown, url: string | undefined) => {
    const rows = normalizeFuturesContracts(payload, { url, fallbackSymbol });
    for (const row of rows) {
      const symbol = (row.symbol as string | undefined) ?? fallbackSymbol ?? 'GENERAL';
      const filePath = dataPath({ assetClass: 'futures', symbol }, 'contracts', 'futures-contracts.csv');
      getWriter(filePath, FUTURES_CONTRACTS_HEADER).write(toCsvLine(FUTURES_CONTRACTS_HEADER, row));
    }
    notifyDiscoveredSymbols(extractSymbolsFromRows(rows));
  };

  const handleTradingSessions = (payload: unknown, url: string | undefined) => {
    const rows = normalizeFuturesTradingSessions(payload, { url, fallbackSymbol });
    for (const row of rows) {
      const symbol = (row.symbol as string | undefined) ?? fallbackSymbol ?? 'GENERAL';
      const filePath = dataPath({ assetClass: 'futures', symbol }, 'sessions', 'futures-trading-sessions.csv');
      getWriter(filePath, FUTURES_TRADING_SESSIONS_HEADER).write(toCsvLine(FUTURES_TRADING_SESSIONS_HEADER, row));
    }
    notifyDiscoveredSymbols(extractSymbolsFromRows(rows));
  };

  const handleMarketHours = (payload: unknown, url: string | undefined) => {
    const rows = normalizeFuturesMarketHours(payload, { url, fallbackSymbol });
    for (const row of rows) {
      const symbol = (row.symbol as string | undefined) ?? fallbackSymbol ?? 'GENERAL';
      const filePath = dataPath({ assetClass: 'futures', symbol }, 'market-hours', 'futures-market-hours.csv');
      getWriter(filePath, FUTURES_MARKET_HOURS_HEADER).write(toCsvLine(FUTURES_MARKET_HOURS_HEADER, row));
    }
    notifyDiscoveredSymbols(extractSymbolsFromRows(rows));
  };

  const handleResponse = async (response: Response) => {
    const url = response.url();
    if (
      !FUTURES_HISTORICAL_PATTERN.test(url) &&
      !FUTURES_SNAPSHOT_PATTERN.test(url) &&
      !FUTURES_FUNDAMENTALS_PATTERN.test(url) &&
      !FUTURES_MARKET_HOURS_PATTERN.test(url) &&
      !FUTURES_CONTRACTS_PATTERN.test(url) &&
      !FUTURES_CONTRACTS_BY_SYMBOL_PATTERN.test(url) &&
      !FUTURES_TRADING_SESSIONS_PATTERN.test(url) &&
      !FUTURES_INBOX_THREADS_PATTERN.test(url)
    ) {
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
      if (FUTURES_INBOX_THREADS_PATTERN.test(url)) {
        await persistInboxThreadsSnapshot(text);
      }
      return;
    }

    if (FUTURES_INBOX_THREADS_PATTERN.test(url)) {
      await persistInboxThreadsSnapshot(text);
      return;
    }

    if (FUTURES_HISTORICAL_PATTERN.test(url)) {
      handleBars(parsed, url);
      return;
    }

    if (FUTURES_SNAPSHOT_PATTERN.test(url)) {
      handleSnapshots(parsed, url);
      return;
    }

    if (FUTURES_FUNDAMENTALS_PATTERN.test(url)) {
      handleFundamentals(parsed, url);
      return;
    }

    if (FUTURES_MARKET_HOURS_PATTERN.test(url)) {
      handleMarketHours(parsed, url);
      return;
    }

    if (FUTURES_CONTRACTS_PATTERN.test(url) || FUTURES_CONTRACTS_BY_SYMBOL_PATTERN.test(url)) {
      handleContracts(parsed, url);
      return;
    }

    if (FUTURES_TRADING_SESSIONS_PATTERN.test(url)) {
      handleTradingSessions(parsed, url);
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
