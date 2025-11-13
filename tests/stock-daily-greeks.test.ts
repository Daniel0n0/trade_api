import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createGreeksFeature } from '../src/modulos/stock-daily-shared.js';

test('createGreeksFeature writes csv/jsonl entries for Legend payloads', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-greeks-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const feature = createGreeksFeature('SPY');

    assert.ok(
      feature.shouldProcessUrl('https://api.robinhood.com/options/instruments/?ids=abc'),
      'Options API endpoints should be accepted as greeks sources',
    );
    assert.ok(
      feature.shouldProcessUrl('https://legend.robinhood.com/api/midlands/marketdata/options/greeks/'),
      'Legend proxies that reference options greeks must also be accepted',
    );
    assert.ok(
      !feature.shouldProcessUrl('https://example.com/options/greeks'),
      'Non Robinhood hosts must be ignored even if the path hints at greeks',
    );

    const payloadPath = new URL('./fixtures/legend-greeks.json', import.meta.url);
    const payload = JSON.parse(readFileSync(payloadPath, 'utf-8'));
    const meta = { transport: 'http', source: 'https://legend.robinhood.com/options/greeks' } as const;

    feature.processPayload(payload, meta);
    await feature.close();

    const csvLines = readFileSync(feature.result.csvPath, 'utf-8').trim().split('\n');
    assert.equal(csvLines.length, 3, 'CSV should contain header plus two greeks rows');
    assert.ok(csvLines[1].includes('SPY240621C00350000'), 'First OCC symbol should be persisted');
    assert.ok(csvLines[2].includes('SPY240621P00350000'), 'Second OCC symbol should be persisted');

    const jsonDir = path.dirname(feature.result.jsonlPath);
    const jsonFiles = readdirSync(jsonDir).filter((name) => name.startsWith('greeks-') && name.endsWith('.jsonl'));
    assert.equal(jsonFiles.length, 1, 'Only one rotated jsonl file is expected for the test payload');
    const jsonLines = readFileSync(path.join(jsonDir, jsonFiles[0]), 'utf-8')
      .trim()
      .split('\n');
    assert.equal(jsonLines.length, 2, 'Two greeks entries must be persisted in jsonl');
    const parsed = jsonLines.map((line) => JSON.parse(line));
    assert.deepEqual(
      parsed.map((entry) => entry.occSymbol).sort(),
      ['SPY240621C00350000', 'SPY240621P00350000'],
    );
    assert.ok(parsed.every((entry) => typeof entry.delta === 'number'), 'Delta values must be serialized');
  } finally {
    process.chdir(previousCwd);
  }
});
