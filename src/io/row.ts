import type { Bar } from '../modulos/timebar.js';
import type { BaseEvent } from './schemas.js';
import type { BarsHeader, CandleHeader, QuoteHeader, StatsHeader } from './csvHeaders.js';

export { CSV_HEADERS, CSV_HEADER_TEXT } from './csvHeaders.js';

export function toMsUtc(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  let numeric: number | null = null;
  if (typeof value === 'number') {
    numeric = Number.isFinite(value) ? value : null;
  } else if (typeof value === 'bigint') {
    numeric = Number(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    numeric = Number.isFinite(parsed) ? parsed : null;
  }

  if (numeric === null) {
    return null;
  }

  if (numeric === 0) {
    return 0;
  }

  const abs = Math.abs(numeric);
  if (abs < 1_000) {
    return Math.round(numeric * 1_000);
  }

  const digits = Math.floor(Math.log10(abs)) + 1;
  if (digits <= 10) {
    return Math.round(numeric * 1_000);
  }
  if (digits <= 13) {
    return Math.round(numeric);
  }
  if (digits <= 16) {
    return Math.round(numeric / 1_000);
  }
  return Math.round(numeric / 1_000_000);
}

type HeaderKey<T extends readonly string[]> = T[number];

type CsvRow<T extends readonly string[]> = Partial<Record<HeaderKey<T>, string | number | undefined>>;

const CSV_SPECIAL_CHARACTERS = /[",\n]/;
const DOUBLE_QUOTE = '"';

const escapeCsvString = (value: string): string => {
  const normalized = value.replace(/\r\n?/g, '\n');
  const escapedNewLines = normalized.replace(/\n/g, '\\n');
  const escapedQuotes = escapedNewLines.split(DOUBLE_QUOTE).join(DOUBLE_QUOTE + DOUBLE_QUOTE);
  if (CSV_SPECIAL_CHARACTERS.test(normalized)) {
    return `${DOUBLE_QUOTE}${escapedQuotes}${DOUBLE_QUOTE}`;
  }
  return escapedQuotes;
};

export function toCsvLine<T extends readonly string[]>(header: T, row: CsvRow<T>): string {
  return header
    .map((key) => {
      const value = row[key as HeaderKey<T>];
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : '';
      }
      const stringValue = String(value);
      if (!stringValue) {
        return '';
      }
      return escapeCsvString(stringValue);
    })
    .join(',');
}

const assignNumber = (target: Record<string, unknown>, key: string, value: number | undefined): void => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value;
  }
};

const assignString = (target: Record<string, unknown>, key: string, value: string | undefined): void => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      target[key] = trimmed;
    }
  }
};

const assignNumbers = (target: Record<string, unknown>, source: BaseEvent, keys: readonly string[]): void => {
  const record = source as Record<string, number | undefined>;
  for (const key of keys) {
    assignNumber(target, key, record[key]);
  }
};

const symbolFromEvent = (event: BaseEvent): string | undefined => event.eventSymbol ?? event.symbol ?? undefined;

export type NormalizedDxFeedRow = Record<string, unknown> & {
  readonly ts: number;
  readonly channel: number;
  readonly symbol?: string;
  readonly eventType?: string;
};

export function normalizeDxFeedRow(channel: number, event: BaseEvent): NormalizedDxFeedRow {
  const symbol = symbolFromEvent(event);
  const normalized: Record<string, unknown> = {
    ts: Date.now(),
    channel,
  };

  if (symbol) {
    normalized.symbol = symbol;
  }
  if (event.eventType) {
    normalized.eventType = event.eventType;
  }
  if (typeof event.eventFlags === 'number' && Number.isFinite(event.eventFlags)) {
    normalized.eventFlags = event.eventFlags;
  }

  const eventTime = toMsUtc(event.time ?? event.eventTime ?? null);
  if (eventTime !== null) {
    normalized.eventTime = eventTime;
  }

  const type = event.eventType ?? inferEventType(channel);
  switch (type) {
    case 'Candle': {
      assignNumber(normalized, 'open', event.open);
      assignNumber(normalized, 'high', event.high);
      assignNumber(normalized, 'low', event.low);
      assignNumber(normalized, 'close', event.close);
      assignNumber(normalized, 'volume', event.volume);
      assignNumber(normalized, 'vwap', event.vwap);
      assignNumber(normalized, 'count', event.count);
      assignNumber(normalized, 'sequence', event.sequence);
      assignNumber(normalized, 'impliedVolatility', event.impliedVolatility);
      assignNumber(normalized, 'openInterest', event.openInterest);
      break;
    }
    case 'Trade': {
      assignNumber(normalized, 'price', event.price);
      assignNumber(normalized, 'dayVolume', event.dayVolume);
      break;
    }
    case 'TradeETH': {
      assignNumber(normalized, 'price', event.price);
      assignNumber(normalized, 'dayVolume', event.dayVolume);
      normalized.session = 'ETH';
      break;
    }
    case 'Quote': {
      assignNumber(normalized, 'bidPrice', event.bidPrice);
      assignNumber(normalized, 'bidSize', event.bidSize);
      assignNumber(normalized, 'askPrice', event.askPrice);
      assignNumber(normalized, 'askSize', event.askSize);
      const bidTime = toMsUtc(event.bidTime);
      const askTime = toMsUtc(event.askTime);
      if (bidTime !== null) {
        normalized.bidTime = bidTime;
      }
      if (askTime !== null) {
        normalized.askTime = askTime;
      }
      break;
    }
    case 'Greeks': {
      assignNumbers(normalized, event, [
        'bidPrice',
        'askPrice',
        'markPrice',
        'theoreticalPrice',
        'underlyingPrice',
        'impliedVolatility',
        'delta',
        'gamma',
        'theta',
        'vega',
        'rho',
        'phi',
        'vanna',
        'vomma',
        'speed',
        'charm',
        'color',
        'ultima',
      ]);
      break;
    }
    case 'SeriesSummary': {
      assignNumbers(normalized, event, [
        'openInterest',
        'volume',
        'callVolume',
        'putVolume',
        'callOpenInterest',
        'putOpenInterest',
        'underlyingPrice',
        'impliedVolatility',
        'frontVolatility',
        'backVolatility',
        'atmVolatility',
        'theoreticalPrice',
      ]);
      assignString(normalized, 'underlyingSymbol', event.underlyingSymbol);
      break;
    }
    default: {
      normalized.raw = event;
    }
  }

  return normalized as NormalizedDxFeedRow;
}

function inferEventType(
  channel: number,
): 'Candle' | 'Trade' | 'TradeETH' | 'Quote' | 'Greeks' | 'SeriesSummary' | 'Raw' {
  switch (channel) {
    case 1:
      return 'Candle';
    case 3:
      return 'Trade';
    case 5:
      return 'TradeETH';
    case 7:
      return 'Quote';
    case 9:
      return 'Quote';
    case 11:
      return 'Greeks';
    case 13:
      return 'SeriesSummary';
    default:
      return 'Raw';
  }
}

export const CANDLE_INVALID_FLAG = 18;

export function isValidCandle(event: BaseEvent): boolean {
  if (event.eventFlags === CANDLE_INVALID_FLAG) {
    return false;
  }

  const open = event.open;
  const high = event.high;
  const low = event.low;
  const close = event.close;
  const volume = event.volume;

  const priceValues = [open, high, low, close];
  if (!priceValues.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return false;
  }

  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
    return false;
  }

  const numericHigh = high as number;
  const numericLow = low as number;

  if (numericHigh < numericLow) {
    return false;
  }

  const numericOpen = open as number;
  const numericClose = close as number;

  if (numericOpen < numericLow || numericOpen > numericHigh) {
    return false;
  }

  if (numericClose < numericLow || numericClose > numericHigh) {
    return false;
  }

  return true;
}

export type StatsCounts = {
  ch1: number;
  ch3: number;
  ch5: number;
  ch7: number;
  ch9: number;
  ch11: number;
  ch13: number;
  legendOptions: number;
  legendNews: number;
  other: number;
  total: number;
};

export type StatsCsvRow = CsvRow<StatsHeader>;

export type StatsSnapshotInput = {
  readonly ts: number;
  readonly counts: StatsCounts;
  readonly rss?: number;
  readonly uptimeSec?: number;
};

export function buildStatsCsvRow(input: StatsSnapshotInput): StatsCsvRow {
  const { ts, counts, rss, uptimeSec } = input;
  return {
    ts,
    total: counts.total,
    ch1: counts.ch1,
    ch3: counts.ch3,
    ch5: counts.ch5,
    ch7: counts.ch7,
    ch9: counts.ch9,
    ch11: counts.ch11,
    ch13: counts.ch13,
    legendOptions: counts.legendOptions,
    legendNews: counts.legendNews,
    other: counts.other,
    rss,
    uptimeSec,
  };
}

export type CandleCsvRow = CsvRow<CandleHeader>;

export function buildCandleCsvRow(event: BaseEvent): CandleCsvRow | null {
  const timestamp = toMsUtc(event.time ?? event.eventTime ?? null);
  if (timestamp === null) {
    return null;
  }
  if (!isValidCandle(event)) {
    return null;
  }

  return {
    t: timestamp,
    open: event.open,
    high: event.high,
    low: event.low,
    close: event.close,
    volume: event.volume,
    symbol: symbolFromEvent(event),
  };
}

export type QuoteCsvRow = CsvRow<QuoteHeader>;

export function buildQuoteCsvRow(event: BaseEvent): QuoteCsvRow | null {
  const timestamp =
    toMsUtc(event.bidTime ?? null) ?? toMsUtc(event.askTime ?? null) ?? toMsUtc(event.time ?? event.eventTime ?? null);
  if (timestamp === null) {
    return null;
  }

  return {
    t: timestamp,
    bidPrice: event.bidPrice,
    bidSize: event.bidSize,
    askPrice: event.askPrice,
    askSize: event.askSize,
    symbol: symbolFromEvent(event),
  };
}

const CANDLE_TIMEFRAME_ALIASES: Record<string, string> = {
  m: '1min',
  min: '1min',
  minute: '1min',
  minutes: '1min',
  '1m': '1min',
  '1min': '1min',
  '1minute': '1min',
  '1minutes': '1min',
  s: '1sec',
  sec: '1sec',
  second: '1sec',
  seconds: '1sec',
  '1s': '1sec',
  '1sec': '1sec',
  '1second': '1sec',
  '1seconds': '1sec',
  '5m': '5min',
  '5min': '5min',
  '5minute': '5min',
  '5minutes': '5min',
  '15m': '15min',
  '15min': '15min',
  '15minute': '15min',
  '15minutes': '15min',
  '1h': '1h',
  hour: '1h',
  hours: '1h',
  '1hour': '1h',
  '1hours': '1h',
  '1d': '1d',
  day: '1d',
  days: '1d',
  '1day': '1d',
  '1days': '1d',
};

const resolveTimeframeAlias = (token: string): string | undefined =>
  CANDLE_TIMEFRAME_ALIASES[token] ?? CANDLE_TIMEFRAME_ALIASES[token.replace(/[^0-9a-z]+/g, '')];

export function resolveCandleTimeframe(eventSymbol: string | undefined): string {
  if (!eventSymbol) {
    return 'general';
  }
  const match = eventSymbol.match(/\{=([^,}]+)/);
  if (!match) {
    return 'general';
  }
  const raw = match[1]?.trim().toLowerCase();
  if (!raw) {
    return 'general';
  }

  const alias = resolveTimeframeAlias(raw);
  if (alias) {
    return alias;
  }

  const sanitized = raw.replace(/[^0-9a-z]+/g, '');
  if (!sanitized) {
    return 'general';
  }

  const sanitizedAlias = resolveTimeframeAlias(sanitized);
  if (sanitizedAlias) {
    return sanitizedAlias;
  }

  if (/^\d+min$/.test(sanitized)) {
    return sanitized;
  }

  if (/^\d+m$/.test(sanitized)) {
    return `${sanitized.slice(0, -1)}min`;
  }

  if (/^\d+h$/.test(sanitized) || /^\d+d$/.test(sanitized)) {
    return sanitized;
  }

  return sanitized || 'general';
}

export type TradeAggregationRow = {
  readonly ts: number;
  readonly price: number;
  readonly dayVolume?: number;
  readonly session?: string;
  readonly symbol?: string;
};

const REGULAR_SESSION = 'REG';

const normalizeSession = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
};

export function buildTradeAggregationRow(event: BaseEvent, resolvedType?: string): TradeAggregationRow | undefined {
  const ts = toMsUtc(event.time ?? event.eventTime ?? null);
  const price = typeof event.price === 'number' && Number.isFinite(event.price) ? event.price : undefined;
  if (ts === null || price === undefined) {
    return undefined;
  }
  const explicitSession = normalizeSession((event as Record<string, unknown>).session);
  const typeHint = typeof resolvedType === 'string' ? resolvedType : event.eventType;
  let session = explicitSession;
  if (!session && typeof typeHint === 'string') {
    const lowered = typeHint.toLowerCase();
    if (lowered === 'tradeeth') {
      session = 'ETH';
    } else if (lowered === 'trade') {
      session = REGULAR_SESSION;
    }
  }
  const symbol = symbolFromEvent(event);
  const trade: TradeAggregationRow = {
    ts,
    price,
    ...(typeof event.dayVolume === 'number' && Number.isFinite(event.dayVolume)
      ? { dayVolume: event.dayVolume }
      : {}),
    ...(session ? { session } : {}),
    ...(symbol ? { symbol } : {}),
  };
  return trade;
}

export type QuoteAggregationRow = {
  readonly ts: number;
  readonly bidPrice?: number;
  readonly askPrice?: number;
  readonly symbol?: string;
};

export function buildQuoteAggregationRow(event: BaseEvent): QuoteAggregationRow | undefined {
  const ts =
    toMsUtc(event.bidTime ?? null) ?? toMsUtc(event.askTime ?? null) ?? toMsUtc(event.time ?? event.eventTime ?? null);
  if (ts === null) {
    return undefined;
  }
  const bid = typeof event.bidPrice === 'number' && Number.isFinite(event.bidPrice) ? event.bidPrice : undefined;
  const ask = typeof event.askPrice === 'number' && Number.isFinite(event.askPrice) ? event.askPrice : undefined;
  if (bid === undefined && ask === undefined) {
    return undefined;
  }
  const symbol = symbolFromEvent(event);
  return { ts, bidPrice: bid, askPrice: ask, ...(symbol ? { symbol } : {}) };
}

export function buildBarCsvRow(bar: Bar): CsvRow<BarsHeader> {
  return {
    t: bar.t,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

export type CandleAggregationRow = {
  readonly ts: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly symbol?: string;
};

export function buildCandleAggregationRow(event: BaseEvent): CandleAggregationRow | null {
  if (!isValidCandle(event)) {
    return null;
  }
  const ts = toMsUtc(event.time ?? event.eventTime ?? null);
  if (ts === null) {
    return null;
  }
  const open = typeof event.open === 'number' && Number.isFinite(event.open) ? event.open : null;
  const high = typeof event.high === 'number' && Number.isFinite(event.high) ? event.high : null;
  const low = typeof event.low === 'number' && Number.isFinite(event.low) ? event.low : null;
  const close = typeof event.close === 'number' && Number.isFinite(event.close) ? event.close : null;
  if (open === null || high === null || low === null || close === null) {
    return null;
  }
  const volume = typeof event.volume === 'number' && Number.isFinite(event.volume) ? event.volume : undefined;
  const symbol = symbolFromEvent(event);
  return {
    ts,
    open,
    high,
    low,
    close,
    volume,
    ...(symbol ? { symbol } : {}),
  };
}
