import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCandleCsvRow,
  buildQuoteAggregationRow,
  buildQuoteCsvRow,
  buildTradeAggregationRow,
  CSV_HEADERS,
  normalizeDxFeedRow,
  toCsvLine,
  toMsUtc,
} from '../src/io/row.js';
import { BarAggregator } from '../src/modulos/timebar.js';
import { BaseEvent } from '../src/io/schemas.js';

test('toMsUtc converts seconds to milliseconds', () => {
  assert.strictEqual(toMsUtc(1_700_000_000), 1_700_000_000_000);
  assert.strictEqual(toMsUtc('1700000000'), 1_700_000_000_000);
});

test('toMsUtc converts microseconds and nanoseconds correctly', () => {
  assert.strictEqual(toMsUtc(1_700_000_000_123), 1_700_000_000_123);
  assert.strictEqual(toMsUtc(1_700_000_000_123_456), 1_700_000_000_123);
  assert.strictEqual(toMsUtc(1_700_000_000_123_456_789n), 1_700_000_000_123);
});

test('toCsvLine escapes commas, quotes, and new lines', () => {
  const header = ['value'] as const;
  const line = toCsvLine(header, { value: 'Hello, "world"\nNext line' });
  assert.strictEqual(line, '"Hello, ""world""\\nNext line"');
});

test('normalizeDxFeedRow normalizes event times to milliseconds', () => {
  const event = BaseEvent.parse({ eventType: 'Trade', time: 1_700_000_000, price: 12.34 });
  const normalized = normalizeDxFeedRow(3, event);
  assert.strictEqual((normalized as { eventTime?: number }).eventTime, 1_700_000_000_000);
});

test('buildCandleCsvRow honours headers order', () => {
  const event = BaseEvent.parse({
    eventType: 'Candle',
    eventSymbol: 'AAPL{=1m}',
    time: 1_700_000_000,
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    volume: 1_000,
  });
  const row = buildCandleCsvRow(event);
  assert.ok(row);
  assert.strictEqual(row?.t, 1_700_000_000_000);
  const line = toCsvLine(CSV_HEADERS.candle, row ?? {});
  assert.strictEqual(line, '1700000000000,100,110,95,105,1000,AAPL{=1m}');
});

test('buildQuoteCsvRow uses quote timestamps in milliseconds', () => {
  const event = BaseEvent.parse({
    eventType: 'Quote',
    eventSymbol: 'AAPL',
    bidTime: 1_700_000_000_000_000_000n,
    bidPrice: 1.23,
    askPrice: 1.25,
  });
  const row = buildQuoteCsvRow(event);
  assert.ok(row);
  assert.strictEqual(row?.t, 1_700_000_000_000);
  const line = toCsvLine(CSV_HEADERS.quote, row ?? {});
  assert.strictEqual(line, '1700000000000,1.23,,1.25,,AAPL');
});

test('aggregation helpers convert timestamps consistently', () => {
  const tradeEvent = BaseEvent.parse({ eventType: 'Trade', time: 1_700_000_000, price: 10 });
  const trade = buildTradeAggregationRow(tradeEvent);
  assert.deepEqual(trade, { ts: 1_700_000_000_000, price: 10, session: 'REG' });

  const quoteEvent = BaseEvent.parse({
    eventType: 'Quote',
    bidTime: 1_700_000_000,
    bidPrice: 9.5,
    askPrice: 10.5,
  });
  const quote = buildQuoteAggregationRow(quoteEvent);
  assert.deepEqual(quote, { ts: 1_700_000_000_000, bidPrice: 9.5, askPrice: 10.5 });
});

test('buildTradeAggregationRow infers sessions for extended hours trades', () => {
  const event = BaseEvent.parse({ eventType: 'TradeETH', time: 1_700_000_500, price: 11.5, dayVolume: 25 });
  const trade = buildTradeAggregationRow(event, 'TradeETH');
  assert.deepEqual(trade, { ts: 1_700_000_500_000, price: 11.5, dayVolume: 25, session: 'ETH' });
});

test('BarAggregator uses dayVolume deltas per session', () => {
  const agg = new BarAggregator(1);
  const baseTs = Date.UTC(2024, 0, 1, 14, 30);
  agg.addTrade({ ts: baseTs, price: 100, dayVolume: 100, size: 100, session: 'REG' });
  agg.addTrade({ ts: baseTs + 10_000, price: 101, dayVolume: 120, session: 'REG' });
  agg.addTrade({ ts: baseTs + 20_000, price: 102, dayVolume: 5, size: 5, session: 'ETH' });
  agg.addTrade({ ts: baseTs + 30_000, price: 103, dayVolume: 8, session: 'ETH' });

  const bars = agg.drainAll();
  assert.strictEqual(bars.length, 1);
  assert.strictEqual(bars[0]?.volume, 128);
});
