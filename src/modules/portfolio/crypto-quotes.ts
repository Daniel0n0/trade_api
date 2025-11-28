import path from 'node:path';

import Decimal from 'decimal.js';
import type { Decimal as DecimalNamespace } from 'decimal.js';

import { marketDataPath } from '../../io/paths.js';
import type { CsvRowInput } from '../../io/upsertCsv.js';
import { upsertCsv } from '../../io/upsertCsv.js';
import type { HoldingCurrentRow } from './crypto-holdings.js';

export const CRYPTO_QUOTES_HEADER = [
  'ts',
  'source_url',
  'instrument_id',
  'symbol',
  'mark',
  'bid',
  'ask',
  'bid_size',
  'ask_size',
  'mid',
  'spread',
  'open_24h',
  'high_24h',
  'low_24h',
  'vol_24h',
  'state',
  'updated_at_iso',
] as const;

export const CRYPTO_PRICEBOOK_HEADER = [
  'ts',
  'source_url',
  'instrument_id',
  'symbol',
  'level',
  'side',
  'price',
  'size',
  'updated_at_iso',
] as const;

export type CryptoQuoteRow = CsvRowInput<typeof CRYPTO_QUOTES_HEADER>;
export type CryptoPricebookRow = CsvRowInput<typeof CRYPTO_PRICEBOOK_HEADER>;

export type CryptoQuoteRaw = Record<string, unknown> & {
  readonly instrument_id?: unknown;
  readonly symbol?: unknown;
  readonly mark_price?: unknown;
  readonly last_trade_price?: unknown;
  readonly bid_price?: unknown;
  readonly ask_price?: unknown;
  readonly bid_size?: unknown;
  readonly ask_size?: unknown;
  readonly open_24h?: unknown;
  readonly high_24h?: unknown;
  readonly low_24h?: unknown;
  readonly volume_24h?: unknown;
  readonly updated_at?: unknown;
  readonly state?: unknown;
};

export type CryptoPricebookRaw = Record<string, unknown> & {
  readonly instrument_id?: unknown;
  readonly symbol?: unknown;
  readonly bids?: ReadonlyArray<{ price?: unknown; size?: unknown }>;
  readonly asks?: ReadonlyArray<{ price?: unknown; size?: unknown }>;
  readonly updated_at?: unknown;
};

export type CryptoQuoteEnvelope = {
  readonly ts?: number;
  readonly source?: string;
  readonly payload?: unknown;
};

const UNKNOWN_SYMBOL = 'UNKNOWN-CRYPTO';

type DecimalType = DecimalNamespace;
type DecimalValue = DecimalNamespace.Value;

const DecimalCtor = Decimal as DecimalNamespace.Constructor;

const dec = (value?: DecimalValue | null): DecimalType => new DecimalCtor(value ?? '0');

const normaliseSymbol = (input: unknown): string => {
  if (typeof input === 'string' && input.trim()) {
    const trimmed = input.trim().toUpperCase();
    const cleaned = trimmed.replace(/[^A-Z0-9-]+/g, '-').replace(/-{2,}/g, '-');
    if (cleaned.includes('-')) {
      return cleaned;
    }

    if (cleaned.length >= 6 && cleaned.length % 2 === 0) {
      const midpoint = cleaned.length / 2;
      return `${cleaned.slice(0, midpoint)}-${cleaned.slice(midpoint)}`;
    }

    return cleaned;
  }

  return UNKNOWN_SYMBOL;
};

const resolveSourceUrl = (envelope: CryptoQuoteEnvelope): string => envelope.source ?? '';

const resolveTimestamp = (envelope: CryptoQuoteEnvelope): number =>
  typeof envelope.ts === 'number' && Number.isFinite(envelope.ts) ? envelope.ts : Date.now();

const resolveUpdatedAt = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return null;
};

const midFromPrices = (bid: DecimalType, ask: DecimalType, fallback: DecimalType): DecimalType => {
  const hasBoth = bid.gt(0) && ask.gt(0);
  if (hasBoth) {
    return bid.plus(ask).div(2);
  }
  return fallback;
};

const spreadFromPrices = (bid: DecimalType, ask: DecimalType): DecimalType => {
  const hasBoth = bid.gt(0) && ask.gt(0);
  if (!hasBoth) {
    return new DecimalCtor(0);
  }
  return ask.minus(bid);
};

const toQuoteRows = (envelope: CryptoQuoteEnvelope): CryptoQuoteRow[] => {
  const ts = resolveTimestamp(envelope);
  const sourceUrl = resolveSourceUrl(envelope);
  const rawPayload = envelope.payload as unknown;
  const candidates =
    Array.isArray((rawPayload as { results?: unknown }).results)
      ? ((rawPayload as { results: unknown }).results as unknown[])
      : Array.isArray(rawPayload)
        ? (rawPayload as unknown[])
        : rawPayload
          ? [rawPayload]
          : [];

  const rows: CryptoQuoteRow[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const quote = candidate as CryptoQuoteRaw;
    const bid = dec(typeof quote.bid_price === 'string' ? quote.bid_price : quote.bid_price?.toString());
    const ask = dec(typeof quote.ask_price === 'string' ? quote.ask_price : quote.ask_price?.toString());
    const mid = midFromPrices(
      bid,
      ask,
      dec(
        typeof quote.mark_price === 'string'
          ? quote.mark_price
          : quote.last_trade_price?.toString(),
      ),
    );
    const markCandidate =
      typeof quote.mark_price === 'string'
        ? quote.mark_price
        : typeof quote.last_trade_price === 'string'
          ? quote.last_trade_price
          : mid.toString();

    rows.push({
      ts,
      source_url: sourceUrl,
      instrument_id: typeof quote.instrument_id === 'string' ? quote.instrument_id : undefined,
      symbol: normaliseSymbol(quote.symbol),
      mark: markCandidate ?? '0',
      bid: typeof quote.bid_price === 'string' ? quote.bid_price : bid.toString(),
      ask: typeof quote.ask_price === 'string' ? quote.ask_price : ask.toString(),
      bid_size: typeof quote.bid_size === 'string' ? quote.bid_size : quote.bid_size?.toString(),
      ask_size: typeof quote.ask_size === 'string' ? quote.ask_size : quote.ask_size?.toString(),
      mid: mid.toString(),
      spread: spreadFromPrices(bid, ask).toString(),
      open_24h: typeof quote.open_24h === 'string' ? quote.open_24h : quote.open_24h?.toString(),
      high_24h: typeof quote.high_24h === 'string' ? quote.high_24h : quote.high_24h?.toString(),
      low_24h: typeof quote.low_24h === 'string' ? quote.low_24h : quote.low_24h?.toString(),
      vol_24h: typeof quote.volume_24h === 'string' ? quote.volume_24h : quote.volume_24h?.toString(),
      state: typeof quote.state === 'string' ? quote.state : undefined,
      updated_at_iso: resolveUpdatedAt(quote.updated_at),
    } satisfies CryptoQuoteRow);
  }

  return rows;
};

const toPricebookRows = (envelope: CryptoQuoteEnvelope): CryptoPricebookRow[] => {
  const ts = resolveTimestamp(envelope);
  const sourceUrl = resolveSourceUrl(envelope);
  const rawPayload = envelope.payload as unknown;
  const candidates =
    Array.isArray((rawPayload as { results?: unknown }).results)
      ? ((rawPayload as { results: unknown }).results as unknown[])
      : Array.isArray(rawPayload)
        ? (rawPayload as unknown[])
        : rawPayload
          ? [rawPayload]
          : [];

  const rows: CryptoPricebookRow[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const pricebook = candidate as CryptoPricebookRaw;
    const symbol = normaliseSymbol(pricebook.symbol);
    const instrumentId = typeof pricebook.instrument_id === 'string' ? pricebook.instrument_id : undefined;
    const updatedAtIso = resolveUpdatedAt(pricebook.updated_at);

    const appendLevels = (side: 'bid' | 'ask', levels?: ReadonlyArray<{ price?: unknown; size?: unknown }>) => {
      if (!levels) {
        return;
      }
      for (let index = 0; index < levels.length; index += 1) {
        const level = levels[index];
        if (!level) {
          continue;
        }
        rows.push({
          ts,
          source_url: sourceUrl,
          instrument_id: instrumentId,
          symbol,
          level: index + 1,
          side,
          price: typeof level.price === 'string' ? level.price : level.price?.toString(),
          size: typeof level.size === 'string' ? level.size : level.size?.toString(),
          updated_at_iso: updatedAtIso,
        } satisfies CryptoPricebookRow);
      }
    };

    appendLevels('bid', pricebook.bids);
    appendLevels('ask', pricebook.asks);
  }

  return rows;
};

const groupBySymbol = <T extends CryptoQuoteRow | CryptoPricebookRow>(rows: readonly T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const symbol = typeof row.symbol === 'string' && row.symbol ? row.symbol : UNKNOWN_SYMBOL;
    if (!map.has(symbol)) {
      map.set(symbol, []);
    }
    map.get(symbol)!.push(row);
  }
  return map;
};

const dateFromEpochMs = (value: number): string => {
  const date = new Date(value);
  const effective = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(effective.getUTCFullYear());
  const month = String(effective.getUTCMonth() + 1).padStart(2, '0');
  const day = String(effective.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export async function persistCryptoQuotes(envelope: CryptoQuoteEnvelope): Promise<void> {
  const quoteRows = toQuoteRows(envelope);
  if (!quoteRows.length) {
    return;
  }

  const grouped = groupBySymbol(quoteRows);
  const ts = resolveTimestamp(envelope);

  await Promise.all(
    Array.from(grouped.entries()).map(async ([symbol, rows]) => {
      const dateFolder = dateFromEpochMs(ts);
      const dailyPath = marketDataPath({ assetClass: 'crypto', symbol, date: dateFolder }, 'quotes.csv');
      await upsertCsv(dailyPath, CRYPTO_QUOTES_HEADER, rows, (row) => {
        const tsBucket = Math.floor(Number(row.ts ?? ts) / 1000);
        const instrument = typeof row.instrument_id === 'string' ? row.instrument_id : symbol;
        return `${tsBucket}-${instrument}`;
      });

      const rollingPath = path.join(marketDataPath({ assetClass: 'crypto', symbol, date: dateFolder }), 'last_quote.csv');
      await upsertCsv(rollingPath, CRYPTO_QUOTES_HEADER, rows.slice(-1), (row) => {
        return typeof row.instrument_id === 'string' ? row.instrument_id : symbol;
      });
    }),
  );
}

export async function persistCryptoPricebooks(envelope: CryptoQuoteEnvelope): Promise<void> {
  const pricebookRows = toPricebookRows(envelope);
  if (!pricebookRows.length) {
    return;
  }

  const grouped = groupBySymbol(pricebookRows);
  const ts = resolveTimestamp(envelope);

  await Promise.all(
    Array.from(grouped.entries()).map(async ([symbol, rows]) => {
      const dateFolder = dateFromEpochMs(ts);
      const snapshotPath = marketDataPath(
        { assetClass: 'crypto', symbol, date: dateFolder },
        'pricebook.csv',
      );
      await upsertCsv(snapshotPath, CRYPTO_PRICEBOOK_HEADER, rows, (row) => {
        const level = typeof row.level === 'number' ? row.level : 0;
        const side = typeof row.side === 'string' ? row.side : 'unknown';
        const tsBucket = Math.floor(Number(row.ts ?? ts));
        const instrument = typeof row.instrument_id === 'string' ? row.instrument_id : symbol;
        return `${tsBucket}-${instrument}-${level}-${side}`;
      });
    }),
  );
}

export function valueHoldingWithQuote(
  holding: HoldingCurrentRow,
  quote: CryptoQuoteRow,
): HoldingCurrentRow & {
  readonly mark_px_usd: string;
  readonly mtm_value_usd: string;
  readonly mid?: string;
  readonly spread?: string;
  readonly state?: string;
  readonly quote_ts?: number;
} {
  const mark = dec(typeof quote.mark === 'string' ? quote.mark : quote.mark?.toString());
  const qty = dec(typeof holding.qty === 'string' ? holding.qty : holding.qty?.toString());

  return {
    ...holding,
    mark_px_usd: mark.toString(),
    mtm_value_usd: qty.mul(mark).toString(),
    ...(typeof quote.mid === 'string' ? { mid: quote.mid } : {}),
    ...(typeof quote.spread === 'string' ? { spread: quote.spread } : {}),
    ...(typeof quote.state === 'string' ? { state: quote.state } : {}),
    ...(typeof quote.ts === 'number' ? { quote_ts: quote.ts } : {}),
  };
}

export function mergeHoldingsWithQuotes(
  holdings: readonly HoldingCurrentRow[],
  quotes: readonly CryptoQuoteRow[],
): ReturnType<typeof valueHoldingWithQuote>[] {
  if (!holdings.length || !quotes.length) {
    return [];
  }

  const quotesByInstrument = new Map<string, CryptoQuoteRow>();
  for (const quote of quotes) {
    if (typeof quote.instrument_id === 'string' && quote.instrument_id) {
      quotesByInstrument.set(quote.instrument_id, quote);
    }
  }

  const valued: ReturnType<typeof valueHoldingWithQuote>[] = [];

  for (const holding of holdings) {
    const instrumentId = typeof holding.currency_pair_id === 'string' ? holding.currency_pair_id : undefined;
    const quote = instrumentId ? quotesByInstrument.get(instrumentId) : undefined;
    if (!quote) {
      continue;
    }
    valued.push(valueHoldingWithQuote(holding, quote));
  }

  return valued;
}
