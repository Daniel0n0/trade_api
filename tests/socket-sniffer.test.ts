import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveEventTimestamp } from '../src/modulos/socket-sniffer.js';
import { BaseEvent } from '../src/io/schemas.js';

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
