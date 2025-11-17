import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FUTURES_QUOTES_HEADER, normalizeFuturesQuotes } from '../src/modules/futures/interceptor.js';

describe('futures quotes normalizer', () => {
  it('normalizes quotes and derives mid/spread values', () => {
    const payload = {
      data: [
        {
          status: 'SUCCESS',
          data: {
            instrument_id: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
            symbol: '/GCZ25:XCEC',
            bid_price: '4115.9',
            bid_size: '12',
            bid_venue_timestamp: '2024-11-17T06:24:40Z',
            ask_price: '4116.1',
            ask_size: '9',
            ask_venue_timestamp: '2024-11-17T06:24:40Z',
            last_trade_price: '4116.05',
            last_trade_size: '3',
            last_trade_venue_timestamp: '2024-11-17T06:24:38Z',
            state: 'active',
            updated_at: '2024-11-17T06:24:40Z',
          },
        },
      ],
    };

    const rows = normalizeFuturesQuotes(payload, {
      ts: 1_730_000_000_000,
      url: 'https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78',
      sourceUrl: 'https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.instrument_id, 'C4021DC3-BC5C-4252-A5B9-209572A1CB78');
    assert.equal(row.symbol, '/GCZ25:XCEC');
    assert.equal(row.root, '/GC');
    assert.equal(row.expiry_code, 'Z25');
    assert.equal(row.venue, 'XCEC');
    assert.equal(row.bid_px, '4115.9');
    assert.equal(row.ask_px, '4116.1');
    assert.equal(row.mid_px, '4116');
    assert.equal(row.spread_px, '0.2');
    assert.equal(row.spread_bps?.startsWith('0.48'), true);
    assert.equal(row.state, 'active');
    assert.equal(row.updated_at_iso, '2024-11-17T06:24:40.000Z');

    const serialized = FUTURES_QUOTES_HEADER.map((key) => row[key] ?? '').join(',');
    assert.equal(serialized.includes('4116'), true);
  });

  it('skips invalid quotes when bid exceeds ask', () => {
    const payload = {
      data: [
        {
          status: 'SUCCESS',
          data: {
            symbol: 'MESZ4',
            instrument_id: 'abcd',
            bid_price: '10',
            ask_price: '9',
          },
        },
      ],
    };

    const rows = normalizeFuturesQuotes(payload, { ts: 123, url: 'https://api.robinhood.com/marketdata/futures/quotes/v1/' });

    assert.equal(rows.length, 0);
  });
});
