import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { MARKET_HOURS_HEADER, normalizeMarketHoursXase, syncMarketHoursXase } from '../src/modules/market-hours/xase.js';

describe('market hours XASE module', () => {
  const samplePayload = {
    date: '2025-11-11',
    is_open: true,
    opens_at: '2025-11-11T14:30:00Z',
    closes_at: '2025-11-11T21:00:00Z',
    extended_opens_at: '2025-11-11T12:00:00Z',
    extended_closes_at: '2025-11-12T01:00:00Z',
    late_option_closes_at: '2025-11-11T21:15:00Z',
    index_option_0dte_closes_at: '2025-11-11T21:00:00Z',
    index_option_non_0dte_closes_at: '2025-11-11T21:15:00Z',
    index_options_extended_hours: {
      curb_opens_at: '2025-11-11T21:15:00Z',
      curb_closes_at: '2025-11-11T22:00:00Z',
    },
    all_day_opens_at: '2025-11-11T01:00:00Z',
    all_day_closes_at: '2025-11-12T01:00:00Z',
    fx_opens_at: '2025-11-10T22:00:00Z',
    fx_closes_at: '2025-11-11T22:00:00Z',
    fx_next_open_hours: '2025-11-12T22:00:00Z',
    fx_is_open: false,
  } as const;

  it('normalizes raw payloads into a single market hours row', () => {
    const normalized = normalizeMarketHoursXase(samplePayload, {
      ts: 1_700_000_000_000,
      source: 'https://api.robinhood.com/markets/XASE/hours/2025-11-11/',
    });

    assert.ok(normalized);
    assert.equal(normalized.market, 'XASE');
    assert.equal(normalized.date, '2025-11-11');
    assert.equal(normalized.opens_at, Date.parse('2025-11-11T14:30:00Z'));
    assert.equal(normalized.extended_closes_at, Date.parse('2025-11-12T01:00:00Z'));
    assert.equal(normalized.fx_is_open, false);
    assert.equal(normalized.source_url, 'https://api.robinhood.com/markets/XASE/hours/2025-11-11/');

    const csvRow = MARKET_HOURS_HEADER.map((key) => normalized[key] ?? '').join(',');
    assert.ok(csvRow.includes('XASE'));
  });

  it('persists CSV and raw outputs via syncMarketHoursXase', async (t) => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'market-hours-xase-'));
    t.after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    const fetchStub: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => samplePayload,
      } as unknown as Response);

    await syncMarketHoursXase({
      date: '2025-11-11',
      fetchImpl: fetchStub,
      baseDir: tmpDir,
    });

    const dayFile = path.join(tmpDir, 'data', 'system', 'market_hours', 'XASE', '2025.csv');
    const dayContent = await readFile(dayFile, 'utf8');
    assert.match(dayContent, /date/);
    assert.match(dayContent, /2025-11-11/);

    const rawFile = path.join(tmpDir, 'data', 'system', 'market_hours', '_raw', 'XASE', '2025-11-11.json');
    const rawContent = await readFile(rawFile, 'utf8');
    const parsed = JSON.parse(rawContent);
    assert.equal(parsed.date, '2025-11-11');
  });
});
