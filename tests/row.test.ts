import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCandleCsvRow,
  buildStatsCsvRow,
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

test('normalizeDxFeedRow infers quote payloads for advanced legend channel 9', () => {
  const event = BaseEvent.parse({ bidPrice: 100.5, askPrice: 101.25, bidTime: 1_700_000_000 });
  const normalized = normalizeDxFeedRow(9, event);
  assert.strictEqual((normalized as { bidPrice?: number }).bidPrice, 100.5);
  assert.strictEqual((normalized as { askPrice?: number }).askPrice, 101.25);
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

test('buildCandleCsvRow rechaza velas con volumen negativo o precios fuera de rango', () => {
  const negativeVolume = BaseEvent.parse({
    eventType: 'Candle',
    eventSymbol: 'AAPL{=1m}',
    time: 1_700_000_000,
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    volume: -1,
  });
  assert.strictEqual(buildCandleCsvRow(negativeVolume), null);

  const outOfRange = BaseEvent.parse({
    eventType: 'Candle',
    eventSymbol: 'AAPL{=1m}',
    time: 1_700_000_000,
    open: 120,
    high: 110,
    low: 95,
    close: 105,
    volume: 1_000,
  });
  assert.strictEqual(buildCandleCsvRow(outOfRange), null);
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

test('buildStatsCsvRow includes counters for advanced legend channels', () => {
  const counts = {
    ch1: 1,
    ch3: 2,
    ch5: 3,
    ch7: 4,
    ch9: 5,
    ch11: 6,
    ch13: 7,
    legendOptions: 8,
    legendNews: 9,
    other: 10,
    total: 11,
  } as const;
  const row = buildStatsCsvRow({ ts: 123, counts });
  assert.deepEqual(row, {
    ts: 123,
    total: 11,
    ch1: 1,
    ch3: 2,
    ch5: 3,
    ch7: 4,
    ch9: 5,
    ch11: 6,
    ch13: 7,
    legendOptions: 8,
    legendNews: 9,
    other: 10,
    rss: undefined,
    uptimeSec: undefined,
  });
});

test('normalizeDxFeedRow treats channel 9 as a quote feed for CSV output', () => {
  const event = BaseEvent.parse({
    eventType: 'Quote',
    eventSymbol: 'AAPL',
    bidPrice: 150.12,
    bidSize: 10,
    bidTime: 1_700_000_000_000,
    askPrice: 150.15,
    askSize: 12,
  });
  const normalized = normalizeDxFeedRow(9, event);
  assert.strictEqual(normalized.channel, 9);
  const quoteRow = buildQuoteCsvRow(event);
  assert.ok(quoteRow);
  assert.strictEqual(quoteRow?.t, 1_700_000_000_000);
  const csvLine = toCsvLine(CSV_HEADERS.quote, quoteRow ?? {});
  assert.match(csvLine, /^1700000000000,150\.12,10,150\.15,12,AAPL$/);
});

test('normalizeDxFeedRow extracts key option greek metrics from channel 11', () => {
  const event = BaseEvent.parse({
    eventType: 'Greeks',
    eventSymbol: 'AAPL240119C00150000',
    time: 1_700_000_000_500,
    delta: 0.45,
    gamma: 0.12,
    theta: -0.01,
    vega: 0.05,
    rho: 0.02,
    phi: -0.01,
    vanna: 0.03,
    vomma: 0.04,
    speed: 0.005,
    charm: -0.002,
    color: 0.001,
    ultima: 0.0001,
    impliedVolatility: 0.24,
    underlyingPrice: 150.2,
    markPrice: 5.35,
    theoreticalPrice: 5.33,
  });
  const normalized = normalizeDxFeedRow(11, event);
  assert.strictEqual(normalized.channel, 11);
  assert.strictEqual(normalized.delta, 0.45);
  assert.strictEqual(normalized.vega, 0.05);
  assert.strictEqual(normalized.underlyingPrice, 150.2);
  assert.strictEqual(normalized.markPrice, 5.35);
  assert.ok(!('raw' in normalized));
});

test('normalizeDxFeedRow keeps series summary statistics from channel 13', () => {
  const event = BaseEvent.parse({
    eventType: 'SeriesSummary',
    eventSymbol: 'AAPL240119',
    time: 1_700_000_000_750,
    underlyingSymbol: 'AAPL',
    openInterest: 8023,
    volume: 3579,
    callVolume: 1234,
    putVolume: 2345,
    callOpenInterest: 3456,
    putOpenInterest: 4567,
    frontVolatility: 0.22,
    backVolatility: 0.24,
    atmVolatility: 0.23,
    underlyingPrice: 150.25,
    theoreticalPrice: 5.4,
  });
  const normalized = normalizeDxFeedRow(13, event);
  assert.strictEqual(normalized.channel, 13);
  assert.strictEqual(normalized.callVolume, 1234);
  assert.strictEqual(normalized.putOpenInterest, 4567);
  assert.strictEqual(normalized.underlyingSymbol, 'AAPL');
  assert.ok(!('raw' in normalized));
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
  const agg = new BarAggregator({ timeframe: '1m', periodMs: 60_000 });
  const baseTs = Date.UTC(2024, 0, 1, 14, 30);
  agg.addTrade({ ts: baseTs, price: 100, dayVolume: 100, size: 100, session: 'REG' });
  agg.addTrade({ ts: baseTs + 10_000, price: 101, dayVolume: 120, session: 'REG' });
  agg.addTrade({ ts: baseTs + 20_000, price: 102, dayVolume: 5, size: 5, session: 'ETH' });
  agg.addTrade({ ts: baseTs + 30_000, price: 103, dayVolume: 8, session: 'ETH' });

  const bars = agg.drainAll();
  assert.strictEqual(bars.length, 1);
  assert.strictEqual(bars[0]?.bar.volume, 128);
});
