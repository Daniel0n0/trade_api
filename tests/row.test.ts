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
  assert.deepEqual(trade, { ts: 1_700_000_000_000, price: 10 });

  const quoteEvent = BaseEvent.parse({
    eventType: 'Quote',
    bidTime: 1_700_000_000,
    bidPrice: 9.5,
    askPrice: 10.5,
  });
  const quote = buildQuoteAggregationRow(quoteEvent);
  assert.deepEqual(quote, { ts: 1_700_000_000_000, bidPrice: 9.5, askPrice: 10.5 });
});
