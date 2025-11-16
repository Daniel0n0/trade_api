import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  MARKET_HOURS_DAY_HEADER,
  MARKET_HOURS_SESSION_HEADER,
  normalizeMarketHoursXase,
  syncMarketHoursXase,
} from '../src/modules/market-hours/xase.js';

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

  it('normalizes raw payloads into day and session rows', () => {
    const normalized = normalizeMarketHoursXase(samplePayload, {
      ts: 1_700_000_000_000,
      source: 'https://api.robinhood.com/markets/XASE/hours/2025-11-11/',
    });

    assert.ok(normalized);
    const { day, sessions } = normalized;
    assert.equal(day.exchange, 'XASE');
    assert.equal(day.date_local, '2025-11-11');
    assert.equal(day.open_et, '2025-11-11T09:30:00.000-05:00');
    assert.equal(day.reg_minutes, 390);
    assert.equal(day.ext_minutes, 780);
    assert.equal(day.late_opt_close_utc, '2025-11-11T21:15:00.000Z');
    assert.equal(day.fx_is_open, 0);
    assert.equal(day.source_url, 'https://api.robinhood.com/markets/XASE/hours/2025-11-11/');

    assert.equal(sessions.length, 9);
    const regular = sessions.find((session) => session.session_type === 'REG');
    assert.ok(regular);
    assert.equal(regular?.minutes, 390);
    const fx = sessions.find((session) => session.session_type === 'FX');
    assert.ok(fx);
    assert.equal(fx?.is_open_flag, 0);

    const csvDay = MARKET_HOURS_DAY_HEADER.map((key) => day[key] ?? '').join(',');
    assert.ok(csvDay.includes('XASE'));
    const csvSession = MARKET_HOURS_SESSION_HEADER.map((key) => regular?.[key] ?? '').join(',');
    assert.ok(csvSession.includes('REG'));
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

    const dayFile = path.join(tmpDir, 'data', 'calendars', 'market_hours', 'XASE', '2025', '11.csv');
    const dayContent = await readFile(dayFile, 'utf8');
    assert.match(dayContent, /date_local/);
    assert.match(dayContent, /2025-11-11/);

    const sessionsFile = path.join(
      tmpDir,
      'data',
      'calendars',
      'market_hours_sessions',
      'XASE',
      '2025',
      '11',
      '2025-11-11.csv',
    );
    const sessionsContent = await readFile(sessionsFile, 'utf8');
    assert.match(sessionsContent, /session_type/);
    assert.match(sessionsContent, /REG/);

    const rawFile = path.join(
      tmpDir,
      'data',
      '_raw',
      'market_hours',
      'XASE',
      '2025-11',
      '2025-11-11.json',
    );
    const rawContent = await readFile(rawFile, 'utf8');
    const parsed = JSON.parse(rawContent);
    assert.equal(parsed.date, '2025-11-11');
  });
});
