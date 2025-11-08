import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FUTURES_BARS_HEADER,
  FUTURES_SNAPSHOT_HEADER,
  normalizeFuturesBars,
  normalizeFuturesSnapshots,
} from '../src/modules/futures/interceptor.js';

describe('futures interceptor normalizers', () => {
  it('normalizes bar payloads', () => {
    const payload = {
      interval: '5minute',
      span: 'day',
      results: [
        {
          begins_at: '2024-01-02T15:30:00Z',
          open_price: '4750.5',
          high_price: '4752',
          low_price: '4748.25',
          close_price: '4749.75',
          volume: '123',
          session: 'regular',
          symbol: 'MES',
        },
      ],
    };

    const rows = normalizeFuturesBars(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/historicals/1234/?interval=5minute&span=day',
      fallbackSymbol: 'mes',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.beginsAt, '2024-01-02T15:30:00.000Z');
    assert.equal(row.symbol, 'MES');
    assert.equal(row.interval, '5minute');
    assert.equal(row.span, 'day');
    assert.equal(row.instrumentId, '1234');
    assert.equal(row.bounds, undefined);
    assert.equal(row.session, 'REGULAR');
    const csvLine = FUTURES_BARS_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('4750.5'));
  });

  it('normalizes snapshot payloads', () => {
    const payload = {
      results: [
        {
          symbol: 'MNQ',
          mark_price: '17000.25',
          bid_price: '16999.75',
          bid_size: 4,
          ask_price: '17000.5',
          ask_size: 3,
          last_trade_price: '17000.25',
          last_trade_size: 2,
          previous_close_price: '16800',
          open_interest: '1500',
          mark_price_timestamp: '2024-01-02T15:45:00Z',
          instrument_id: 'abcd',
        },
      ],
    };

    const rows = normalizeFuturesSnapshots(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/prices/abcd/',
      fallbackSymbol: 'mnq',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'MNQ');
    assert.equal(row.instrumentId, 'ABCD');
    assert.equal(row.asOf, '2024-01-02T15:45:00.000Z');
    const csvLine = FUTURES_SNAPSHOT_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('17000.25'));
  });

  it('falls back to provided symbol when missing in payload', () => {
    const payload = {
      data: [
        {
          begins_at: '2024-01-02T15:30:00Z',
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 10,
        },
      ],
    };

    const rows = normalizeFuturesBars(payload, { url: undefined, fallbackSymbol: 'm2k' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, 'M2K');
  });
});
