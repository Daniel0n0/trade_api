import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveEventTimestamp, isOrderUpdateWs } from '../src/modulos/socket-sniffer.js';
import { BaseEvent } from '../src/io/schemas.js';
import { shouldProcessLegendWS } from '../src/utils/payload.js';

test('resolveEventTimestamp converts seconds-based timestamps to milliseconds', () => {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const event = BaseEvent.parse({ eventType: 'Trade', eventTime: seconds });

  const resolved = resolveEventTimestamp(event);

  assert.ok(typeof resolved === 'number');
  assert.strictEqual(resolved, seconds * 1000);
  assert.ok(now - resolved < 1500);
});

test('resolveEventTimestamp prefers event time fields in milliseconds when present', () => {
  const millis = Date.now();
  const event = BaseEvent.parse({ eventType: 'Trade', time: millis });

  const resolved = resolveEventTimestamp(event);

  assert.ok(typeof resolved === 'number');
  assert.strictEqual(resolved, millis);
});

test('resolveEventTimestamp normalises microsecond timestamps from auxiliary fields', () => {
  const millis = Date.now();
  const micros = millis * 1000;
  const event = BaseEvent.parse({ eventType: 'Quote', timestamp: micros });

  const resolved = resolveEventTimestamp(event);

  assert.ok(typeof resolved === 'number');
  assert.strictEqual(resolved, millis);
  assert.ok(Date.now() - resolved < 1500);
});

test('resolveEventTimestamp returns undefined when no timestamp is present', () => {
  const event = BaseEvent.parse({ eventType: 'Trade' });

  const resolved = resolveEventTimestamp(event);

  assert.strictEqual(resolved, undefined);
});

test('isOrderUpdateWs validates only the global order websocket', () => {
  const validUrl =
    'wss://api-streaming.robinhood.com/wss/connect?topic=equity_order_update&topic=option_order_update&topic=crypto_order_update&topic=futures_order_update';
  const invalidUrl =
    'wss://api-streaming.robinhood.com/wss/connect?topic=equity_order_update&topic=option_order_update&topic=futures_order_update';

  assert.ok(isOrderUpdateWs(validUrl));
  assert.ok(!isOrderUpdateWs(invalidUrl));
});

test('shouldProcessLegendWS allows only the canonical Legend websocket URL', () => {
  const url = 'wss://api.robinhood.com/marketdata/streaming/legend/';

  assert.ok(shouldProcessLegendWS(url));
  assert.ok(shouldProcessLegendWS('  ' + url.toUpperCase() + '   '));
});

test('shouldProcessLegendWS rejects Legend websocket URLs with query parameters or extra paths', () => {
  assert.ok(!shouldProcessLegendWS('wss://api.robinhood.com/marketdata/streaming/legend/?foo=bar'));
  assert.ok(!shouldProcessLegendWS('wss://api.robinhood.com/marketdata/streaming/legend/extra'));
  assert.ok(!shouldProcessLegendWS('wss://api.robinhood.com/marketdata/streaming/legend'));
});
