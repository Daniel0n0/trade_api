import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  buildQuoteCsvRow,
  buildStatsCsvRow,
  CSV_HEADERS,
  normalizeDxFeedRow,
  toCsvLine,
} from '../src/io/row.js';
import { BaseEvent } from '../src/io/schemas.js';

const fixtureUrl = new URL('./fixtures/legend-advanced-session.json', import.meta.url);

test('legend advanced session fixture captures advanced legend channels', async () => {
  const raw = await readFile(fixtureUrl, 'utf8');
  const packets = JSON.parse(raw) as Array<{ channel: number; data: unknown[] }>;

  const counts = {
    ch1: 0,
    ch3: 0,
    ch5: 0,
    ch7: 0,
    ch9: 0,
    ch11: 0,
    ch13: 0,
    legendOptions: 0,
    legendNews: 0,
    other: 0,
    total: 0,
  };
  const quoteLines: string[] = [];

  for (const { channel, data } of packets) {
    for (const payload of data) {
      const event = BaseEvent.parse(payload);
      const normalized = normalizeDxFeedRow(channel, event);
      assert.strictEqual(normalized.channel, channel);

      if (channel === 9) {
        const row = buildQuoteCsvRow(event);
        assert.ok(row);
        quoteLines.push(toCsvLine(CSV_HEADERS.quote, row ?? {}));
        counts.ch9 += 1;
      } else if (channel === 11) {
        assert.ok(typeof normalized.delta === 'number');
        assert.ok(typeof normalized.markPrice === 'number');
        counts.ch11 += 1;
      } else if (channel === 13) {
        assert.strictEqual(normalized.underlyingSymbol, 'AAPL');
        assert.ok(typeof normalized.callVolume === 'number');
        counts.ch13 += 1;
      }

      counts.total += 1;
    }
  }

  assert.deepEqual(quoteLines, ['1700000000000,150.12,10,150.15,12,AAPL']);

  const statsRow = buildStatsCsvRow({ ts: 1_700_000_000_000, counts });
  assert.strictEqual(statsRow.ch9, counts.ch9);
  assert.strictEqual(statsRow.ch11, counts.ch11);
  assert.strictEqual(statsRow.ch13, counts.ch13);
  assert.strictEqual(statsRow.total, counts.total);
});
