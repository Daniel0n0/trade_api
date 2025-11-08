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

export type CandleHeader = typeof CANDLE_HEADER;
export type QuoteHeader = typeof QUOTE_HEADER;
export type BarsHeader = typeof BARS_HEADER;

export { CANDLE_HEADER, QUOTE_HEADER, BARS_HEADER };
