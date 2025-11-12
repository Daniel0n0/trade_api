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

  it('preserves instrument id from payload when url omits instrument segment', () => {
    const payload = {
      results: [
        {
          begins_at: '2024-01-02T15:30:00Z',
          open_price: '4750.5',
          high_price: '4752',
          low_price: '4748.25',
          close_price: '4749.75',
          volume: '123',
          session: 'regular',
          instrument_id: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
          symbol: 'MES',
        },
      ],
    };

    const rows = normalizeFuturesBars(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/historicals/?interval=5minute&span=day',
      fallbackSymbol: 'mes',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.instrumentId, 'c4021dc3-bc5c-4252-a5b9-209572a1cb78');
    assert.equal(row.symbol, 'MES');
  });

  it('normalizes snapshot payloads with nested data wrappers', () => {
    const payload = {
      status: 'SUCCESS',
      data: [
        {
          status: 'SUCCESS',
          data: {
            ask_price: '6801.5',
            ask_size: 16,
            ask_venue_timestamp: '2025-11-10T02:25:30.608-05:00',
            bid_price: '6801.25',
            bid_size: 16,
            bid_venue_timestamp: '2025-11-10T02:25:30.607-05:00',
            last_trade_price: '6801.5',
            last_trade_size: 1,
            last_trade_venue_timestamp: '2025-11-10T02:25:29.588-05:00',
            symbol: '/MESZ25:XCME',
            instrument_id: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
            state: 'active',
            updated_at: '2025-11-10T02:25:30.608-05:00',
            out_of_band: false,
          },
        },
      ],
    };

    const rows = normalizeFuturesSnapshots(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/quotes/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78',
      fallbackSymbol: 'mesz25',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, '/MESZ25:XCME');
    assert.equal(row.instrumentId, 'C4021DC3-BC5C-4252-A5B9-209572A1CB78');
    assert.equal(row.asOf, '2025-11-10T07:25:30.608Z');
    assert.equal(row.askPrice, 6801.5);
    assert.equal(row.askVenueTimestamp, '2025-11-10T07:25:30.608Z');
    assert.equal(row.bidPrice, 6801.25);
    assert.equal(row.bidVenueTimestamp, '2025-11-10T07:25:30.607Z');
    assert.equal(row.lastTradePrice, 6801.5);
    assert.equal(row.lastTradeVenueTimestamp, '2025-11-10T07:25:29.588Z');
    assert.equal(row.state, 'active');
    assert.equal(row.outOfBand, 'false');

    const csvLine = FUTURES_SNAPSHOT_HEADER.map((key) => row[key] ?? '').join(',');
    assert.ok(csvLine.includes('2025-11-10T07:25:30.607Z'));
    assert.ok(csvLine.includes('false'));
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
      status: 'SUCCESS',
      data: [
        {
          status: 'SUCCESS',
          data: {
            instrument_id: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
            open: '6786.25',
            high: '6807.25',
            low: '6772',
            volume: '146751',
            previous_close_price: '6753.75',
            tradability: 'FUTURES_TRADABILITY_TRADABLE',
          },
        },
      ],
    };

    const rows = normalizeFuturesFundamentals(payload, {
      url: 'https://api.robinhood.com/marketdata/futures/fundamentals/v1/?ids=c4021dc3-bc5c-4252-a5b9-209572a1cb78',
      fallbackSymbol: 'mesz25',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'MESZ25');
    assert.equal(row.instrumentId, 'C4021DC3-BC5C-4252-A5B9-209572A1CB78');
    assert.equal(row.open, 6786.25);
    assert.equal(row.high, 6807.25);
    assert.equal(row.low, 6772);
    assert.equal(row.volume, 146751);
    assert.equal(row.previousClose, 6753.75);
    assert.equal(row.tradeable, 'FUTURES_TRADABILITY_TRADABLE');
  });

  it('normalizes futures contracts data from symbol lookup', () => {
    const payload = {
      result: {
        id: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
        productId: 'f5e6b1cd-3d23-4add-8c51-385dd953a850',
        symbol: '/MESZ25:XCME',
        displaySymbol: '/MESZ25',
        description: 'Micro E-mini S&P 500 Futures, Dec-25',
        multiplier: '5',
        expirationMmy: '202512',
        expiration: '2025-12-19',
        customerLastCloseDate: '2025-12-19',
        tradability: 'FUTURES_TRADABILITY_TRADABLE',
        state: 'FUTURES_STATE_ACTIVE',
        settlementStartTime: '08:30',
        firstTradeDate: '2024-05-01',
        settlementDate: '2025-12-19',
      },
    };

    const rows = normalizeFuturesContracts(payload, {
      url: 'https://api.robinhood.com/arsenal/v1/futures/contracts/symbol/MESZ25',
      fallbackSymbol: 'mesz25',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, 'c4021dc3-bc5c-4252-a5b9-209572a1cb78'.toUpperCase());
    assert.equal(row.symbol, '/MESZ25:XCME');
    assert.equal(row.displaySymbol, '/MESZ25');
    assert.equal(row.productId, 'f5e6b1cd-3d23-4add-8c51-385dd953a850');
    assert.equal(row.description, 'Micro E-mini S&P 500 Futures, Dec-25');
    assert.equal(row.expiration, '2025-12-19T00:00:00.000Z');
    assert.equal(row.expirationMmy, '202512');
    assert.equal(row.customerLastCloseDate, '2025-12-19T00:00:00.000Z');
    assert.equal(row.settlementStartTime, '08:30');
    assert.equal(row.firstTradeDate, '2024-05-01T00:00:00.000Z');
    assert.equal(row.tradeable, 'FUTURES_TRADABILITY_TRADABLE');
  });

  it('normalizes futures contracts result lists', () => {
    const payload = {
      results: [
        {
          id: 'bd2b6728-a24d-448a-a2bc-655c18d8f5e8',
          productId: 'f5e6b1cd-3d23-4add-8c51-385dd953a850',
          symbol: '/MESH26:XCME',
          displaySymbol: '/MESH26',
          description: 'Micro E-mini S&P 500 Futures, Mar-26',
          multiplier: '5',
          expirationMmy: '202603',
          expiration: '2026-03-20',
          customerLastCloseDate: '2026-03-20',
          tradability: 'FUTURES_TRADABILITY_TRADABLE',
          state: 'FUTURES_STATE_ACTIVE',
          settlementStartTime: '08:30',
          firstTradeDate: '2024-05-01',
          settlementDate: '2026-03-20',
        },
        {
          id: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
          productId: 'f5e6b1cd-3d23-4add-8c51-385dd953a850',
          symbol: '/MESZ25:XCME',
          displaySymbol: '/MESZ25',
          description: 'Micro E-mini S&P 500 Futures, Dec-25',
          multiplier: '5',
          expirationMmy: '202512',
          expiration: '2025-12-19',
          customerLastCloseDate: '2025-12-19',
          tradability: 'FUTURES_TRADABILITY_TRADABLE',
          state: 'FUTURES_STATE_ACTIVE',
          settlementStartTime: '08:30',
          firstTradeDate: '2024-05-01',
          settlementDate: '2025-12-19',
        },
      ],
    };

    const rows = normalizeFuturesContracts(payload, {
      url: 'https://api.robinhood.com/arsenal/v1/futures/contracts/',
      fallbackSymbol: 'mes',
    });

    assert.equal(rows.length, 2);
    const mesh26 = rows.find((row) => row.displaySymbol === '/MESH26');
    assert.ok(mesh26);
    assert.equal(mesh26?.expiration, '2026-03-20T00:00:00.000Z');
    assert.equal(mesh26?.id, 'BD2B6728-A24D-448A-A2BC-655C18D8F5E8');
    assert.equal(mesh26?.expirationMmy, '202603');
    assert.equal(mesh26?.customerLastCloseDate, '2026-03-20T00:00:00.000Z');
    assert.equal(mesh26?.settlementStartTime, '08:30');
    assert.equal(mesh26?.firstTradeDate, '2024-05-01T00:00:00.000Z');
    assert.equal(mesh26?.tradeable, 'FUTURES_TRADABILITY_TRADABLE');

    const mesz25 = rows.find((row) => row.displaySymbol === '/MESZ25');
    assert.ok(mesz25);
    assert.equal(mesz25?.expirationMmy, '202512');
    assert.equal(mesz25?.customerLastCloseDate, '2025-12-19T00:00:00.000Z');
    assert.equal(mesz25?.settlementStartTime, '08:30');
    assert.equal(mesz25?.firstTradeDate, '2024-05-01T00:00:00.000Z');
    assert.equal(mesz25?.tradeable, 'FUTURES_TRADABILITY_TRADABLE');
  });

  it('normalizes futures trading sessions data with multiple scopes', () => {
    const payload = {
      date: '2025-11-10',
      futuresContractId: 'c4021dc3-bc5c-4252-a5b9-209572a1cb78',
      isHoliday: false,
      startTime: '2025-11-09T21:55:00Z',
      endTime: '2025-11-10T22:40:00Z',
      sessions: [
        {
          tradingDate: '2025-11-10',
          isTrading: false,
          startTime: '2025-11-09T21:55:00Z',
          endTime: '2025-11-09T23:00:00Z',
          sessionType: 'SESSION_TYPE_NO_TRADING',
        },
        {
          tradingDate: '2025-11-10',
          isTrading: true,
          startTime: '2025-11-09T23:00:00Z',
          endTime: '2025-11-10T22:00:00Z',
          sessionType: 'SESSION_TYPE_REGULAR',
        },
        {
          tradingDate: '2025-11-10',
          isTrading: false,
          startTime: '2025-11-10T22:00:00Z',
          endTime: '2025-11-10T22:40:00Z',
          sessionType: 'SESSION_TYPE_NO_TRADING',
        },
      ],
      currentSession: {
        tradingDate: '2025-11-10',
        isTrading: true,
        startTime: '2025-11-09T23:00:00Z',
        endTime: '2025-11-10T22:00:00Z',
        sessionType: 'SESSION_TYPE_REGULAR',
      },
      previousSession: {
        tradingDate: '2025-11-07',
        isTrading: true,
        startTime: '2025-11-06T23:00:00Z',
        endTime: '2025-11-07T22:00:00Z',
        sessionType: 'SESSION_TYPE_REGULAR',
      },
      nextSession: {
        tradingDate: '2025-11-11',
        isTrading: true,
        startTime: '2025-11-10T23:00:00Z',
        endTime: '2025-11-11T22:00:00Z',
        sessionType: 'SESSION_TYPE_REGULAR',
      },
    };

    const rows = normalizeFuturesTradingSessions(payload, {
      url: 'https://api.robinhood.com/arsenal/v1/futures/trading_sessions/c4021dc3-bc5c-4252-a5b9-209572a1cb78/2025-11-10',
      fallbackSymbol: 'mesz25',
    });

    assert.equal(rows.length, 7);
    const summary = rows.find((row) => row.sessionScope === 'summary');
    assert.ok(summary);
    assert.equal(summary?.dayDate, '2025-11-10T00:00:00.000Z');
    assert.equal(summary?.dayStartsAt, '2025-11-09T21:55:00.000Z');
    assert.equal(summary?.dayEndsAt, '2025-11-10T22:40:00.000Z');
    assert.equal(summary?.dayIsHoliday, 'false');
    assert.equal(summary?.startsAt, '2025-11-09T21:55:00.000Z');
    assert.equal(summary?.endsAt, '2025-11-10T22:40:00.000Z');
    const regularSession = rows.find((row) => row.sessionScope === 'sessions' && row.isTrading === 'true');
    assert.ok(regularSession);
    assert.equal(regularSession?.startsAt, '2025-11-09T23:00:00.000Z');
    assert.equal(regularSession?.instrumentId, 'C4021DC3-BC5C-4252-A5B9-209572A1CB78');
    const previous = rows.find((row) => row.sessionScope === 'previousSession');
    assert.ok(previous);
    assert.equal(previous?.tradingDate, '2025-11-07T00:00:00.000Z');
  });

  it('normalizes futures market hours data with extended fields', () => {
    const payload = {
      date: '2025-11-11',
      is_open: true,
      opens_at: '2025-11-11T14:30:00Z',
      closes_at: '2025-11-11T21:00:00Z',
      late_option_closes_at: '2025-11-11T21:15:00Z',
      extended_opens_at: '2025-11-11T12:00:00Z',
      extended_closes_at: '2025-11-12T01:00:00Z',
      all_day_opens_at: '2025-11-11T01:00:00Z',
      all_day_closes_at: '2025-11-12T01:00:00Z',
      previous_open_hours: 'https://api.robinhood.com/markets/XASE/hours/2025-11-10/',
      next_open_hours: 'https://api.robinhood.com/markets/XASE/hours/2025-11-12/',
      index_option_0dte_closes_at: '2025-11-11T21:00:00Z',
      index_option_non_0dte_closes_at: '2025-11-11T21:15:00Z',
      index_options_extended_hours: {
        curb_opens_at: '2025-11-11T21:15:00Z',
        curb_closes_at: '2025-11-11T22:00:00Z',
      },
      fx_opens_at: null,
      fx_closes_at: null,
      fx_is_open: false,
      fx_next_open_hours: '2025-11-11T22:00:00Z',
    };

    const rows = normalizeFuturesMarketHours(payload, {
      url: 'https://api.robinhood.com/markets/XASE/hours/2025-11-11/',
      fallbackSymbol: 'xase',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'XASE');
    assert.equal(row.opensAt, '2025-11-11T14:30:00.000Z');
    assert.equal(row.extendedClosesAt, '2025-11-12T01:00:00.000Z');
    assert.equal(row.lateOptionClosesAt, '2025-11-11T21:15:00.000Z');
    assert.equal(
      row.previousOpenHoursUrl,
      'https://api.robinhood.com/markets/XASE/hours/2025-11-10/',
    );
    assert.equal(row.nextOpenHoursUrl, 'https://api.robinhood.com/markets/XASE/hours/2025-11-12/');
    assert.equal(row.indexOption0dteClosesAt, '2025-11-11T21:00:00.000Z');
    assert.equal(row.curbClosesAt, '2025-11-11T22:00:00.000Z');
    assert.equal(row.fxNextOpenAt, '2025-11-11T22:00:00.000Z');
    assert.equal(row.fxIsOpen, 'false');
    assert.equal(row.isOpen, 'true');
  });

  it('falls back to exchange symbol when instrument data is unavailable', () => {
    const payload = [
      {
        market: 'XASE',
        date: '2025-11-13',
        opens_at: '2025-11-13T14:30:00Z',
        closes_at: '2025-11-13T21:00:00Z',
      },
    ];

    const rows = normalizeFuturesMarketHours(payload, {
      url: 'https://api.robinhood.com/markets/XASE/hours/2025-11-13/',
      fallbackSymbol: 'mesz25',
    });

    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.symbol, 'XASE');
    assert.equal(row.instrumentId, undefined);
  });
});
