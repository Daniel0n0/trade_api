import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FUTURES_BARS_HEADER,
  FUTURES_CONTRACTS_HEADER,
  FUTURES_FUNDAMENTALS_HEADER,
  FUTURES_MARKET_HOURS_HEADER,
  FUTURES_SNAPSHOT_HEADER,
  FUTURES_TRADING_SESSIONS_HEADER,
  normalizeFuturesBars,
  normalizeFuturesContracts,
  normalizeFuturesFundamentals,
  normalizeFuturesMarketHours,
  normalizeFuturesSnapshots,
  normalizeFuturesTradingSessions,
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

  it('normalizes snapshot payloads with nested data wrappers', () => {
    const payload = {
      data: {
        data: [
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
      },
    };

    const rows = normalizeFuturesSnapshots(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/quotes/abcd/',
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
  it('normalizes futures fundamentals data', () => {
    const payload = {
      data: {
        status: {
          data: [
            {
              symbol: 'ES',
              instrument_id: 'c0ffee',
              product_id: 'prod-es',
              root_symbol: 'ES',
              contract_type: 'future',
              tradeable: true,
              state: 'active',
              multiplier: '50',
              tick_size: '0.25',
              initial_margin: '13200',
              maintenance_margin: '12000',
              overnight_maintenance_margin: '15000',
              listing_date: '2023-12-01',
              expiration_date: '2024-03-15',
              settlement_date: '2024-03-16',
              last_trade_date: '2024-03-15T13:00:00Z',
              created_at: '2023-12-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      },
    };

    const rows = normalizeFuturesFundamentals(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/fundamentals/ES/',
      fallbackSymbol: 'es',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'ES');
    assert.equal(row.instrumentId, 'C0FFEE');
    assert.equal(row.productId, 'prod-es');
    assert.equal(row.expirationDate, '2024-03-15T00:00:00.000Z');
    assert.equal(row.lastTradeDate, '2024-03-15T13:00:00.000Z');
    const csvLine = FUTURES_FUNDAMENTALS_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('13200'));
  });

  it('normalizes futures contracts data', () => {
    const payload = {
      data: {
        status: {
          data: [
            {
              contract_code: 'ESH24',
              instrument_id: 'abc123',
              product_id: 'prod-es',
              root_symbol: 'ES',
              contract_type: 'future',
              description: 'E-mini S&P 500 Mar 24',
              tradeable: true,
              state: 'active',
              multiplier: '50',
              tick_size: '0.25',
              listing_date: '2023-12-01',
              expiration_date: '2024-03-15',
              settlement_date: '2024-03-16',
              last_trade_time: '2024-03-15T13:00:00Z',
              created_at: '2023-12-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      },
    };

    const rows = normalizeFuturesContracts(payload, {
      url: 'https://phoenix.robinhood.com/arsenal/v1/futures/contracts/symbol/ESH24/',
      fallbackSymbol: 'esh24',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'ESH24');
    assert.equal(row.instrumentId, 'ABC123');
    assert.equal(row.productId, 'prod-es');
    assert.equal(row.description, 'E-mini S&P 500 Mar 24');
    assert.equal(row.expirationDate, '2024-03-15T00:00:00.000Z');
    assert.equal(row.lastTradeDate, '2024-03-15T13:00:00.000Z');
    const csvLine = FUTURES_CONTRACTS_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('0.25'));
  });

  it('normalizes futures trading sessions data', () => {
    const payload = {
      data: {
        status: {
          data: [
            {
              symbol: 'NQ',
              instrument_id: 'inst-nq',
              product_id: 'prod-nq',
              session_type: 'regular',
              starts_at: '2024-01-02T14:30:00Z',
              ends_at: '2024-01-02T21:00:00Z',
              timezone: 'UTC',
              market: 'CME',
              created_at: '2023-12-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      },
    };

    const rows = normalizeFuturesTradingSessions(payload, {
      url: 'https://phoenix.robinhood.com/arsenal/v1/futures/trading_sessions/',
      fallbackSymbol: 'nq',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'NQ');
    assert.equal(row.sessionType, 'regular');
    assert.equal(row.startsAt, '2024-01-02T14:30:00.000Z');
    assert.equal(row.endsAt, '2024-01-02T21:00:00.000Z');
    const csvLine = FUTURES_TRADING_SESSIONS_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('CME'));
  });

  it('normalizes futures market hours data', () => {
    const payload = {
      data: {
        status: {
          data: [
            {
              symbol: 'CL',
              instrument_id: 'inst-cl',
              product_id: 'prod-cl',
              exchange: 'NYMEX',
              date: '2024-01-02',
              opens_at: '2024-01-02T11:00:00Z',
              closes_at: '2024-01-02T22:00:00Z',
              extended_opens_at: '2024-01-02T10:00:00Z',
              extended_closes_at: '2024-01-02T23:00:00Z',
              next_open_at: '2024-01-03T11:00:00Z',
              previous_close_at: '2024-01-01T22:00:00Z',
              is_open: true,
              created_at: '2023-12-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      },
    };

    const rows = normalizeFuturesMarketHours(payload, {
      url: 'https://api.robinhood.com/markets/cme/hours/',
      fallbackSymbol: 'cl',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'CL');
    assert.equal(row.exchange, 'NYMEX');
    assert.equal(row.opensAt, '2024-01-02T11:00:00.000Z');
    assert.equal(row.extendedClosesAt, '2024-01-02T23:00:00.000Z');
    const csvLine = FUTURES_MARKET_HOURS_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('true'));
  });
});
