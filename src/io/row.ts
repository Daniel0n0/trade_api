import type { Bar } from '../modulos/timebar.js';
import type { BaseEvent } from './schemas.js';

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

const CANDLE_HEADER = ['t', 'open', 'high', 'low', 'close', 'volume', 'symbol'] as const;
const QUOTE_HEADER = ['t', 'bidPrice', 'bidSize', 'askPrice', 'askSize', 'symbol'] as const;
const BARS_HEADER = ['t', 'open', 'high', 'low', 'close', 'volume'] as const;

export const CSV_HEADERS = {
  candle: CANDLE_HEADER,
  quote: QUOTE_HEADER,
  bars: BARS_HEADER,
} as const;

export const CSV_HEADER_TEXT = {
  candle: CANDLE_HEADER.join(','),
  quote: QUOTE_HEADER.join(','),
  bars: BARS_HEADER.join(','),
} as const;

type HeaderKey<T extends readonly string[]> = T[number];

type CsvRow<T extends readonly string[]> = Partial<Record<HeaderKey<T>, string | number | undefined>>;

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
      return String(value);
    })
    .join(',');
}

const assignNumber = (target: Record<string, unknown>, key: string, value: number | undefined): void => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    target[key] = value;
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
    default: {
      normalized.raw = event;
    }
  }

  return normalized as NormalizedDxFeedRow;
}

function inferEventType(channel: number): 'Candle' | 'Trade' | 'TradeETH' | 'Quote' | 'Raw' {
  switch (channel) {
    case 1:
      return 'Candle';
    case 3:
      return 'Trade';
    case 5:
      return 'TradeETH';
    case 7:
      return 'Quote';
    default:
      return 'Raw';
  }
}

export const CANDLE_INVALID_FLAG = 18;

export function isValidCandle(event: BaseEvent): boolean {
  if (event.eventFlags === CANDLE_INVALID_FLAG) {
    return false;
  }
  const values = [event.open, event.high, event.low, event.close, event.volume];
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

export type CandleCsvRow = CsvRow<typeof CANDLE_HEADER>;

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

export type QuoteCsvRow = CsvRow<typeof QUOTE_HEADER>;

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
  if (raw === 'm') {
    return '1m';
  }
  return raw.replace(/[^0-9a-z]+/g, '') || 'general';
}

export type TradeAggregationRow = {
  readonly ts: number;
  readonly price: number;
  readonly dayVolume?: number;
  readonly session?: string;
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
  const trade: TradeAggregationRow = {
    ts,
    price,
    ...(typeof event.dayVolume === 'number' && Number.isFinite(event.dayVolume)
      ? { dayVolume: event.dayVolume }
      : {}),
    ...(session ? { session } : {}),
  };
  return trade;
}

export type QuoteAggregationRow = {
  readonly ts: number;
  readonly bidPrice?: number;
  readonly askPrice?: number;
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
  return { ts, bidPrice: bid, askPrice: ask };
}

export function buildBarCsvRow(bar: Bar): CsvRow<typeof BARS_HEADER> {
  return {
    t: bar.t,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}
