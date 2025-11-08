import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DateTime } from 'luxon';

import {
  collectOptionRecords,
  computeDte,
  deriveChainSymbol,
  normalizeExpiration,
  normaliseOptionType,
  optionRowFromRecord,
} from '../src/modules/options/interceptor.js';

const samplePayload = {
  data: {
    results: [
      {
        chain_symbol: 'SPY',
        expiration_date: '2024-01-19T00:00:00Z',
        strike_price: '450',
        option_type: 'call',
        symbol: 'O:SPY240119C00450000',
        bid_price: '1.23',
        ask_price: '1.45',
        mark_price: '1.34',
        last_trade_price: '1.30',
        implied_volatility: '0.25',
        volume: 100,
        open_interest: 200,
        greeks: {
          delta: '0.55',
          gamma: '0.12',
          theta: '-0.03',
          vega: '0.18',
          rho: '0.01',
        },
      },
    ],
  },
};

test('normalizeExpiration produce formato ISO simple', () => {
  assert.strictEqual(normalizeExpiration('2024-05-17T12:30:00Z'), '2024-05-17');
  assert.strictEqual(normalizeExpiration('invalid-date'), undefined);
});

test('deriveChainSymbol detecta desde OCC symbol', () => {
  const record = { symbol: 'O:QQQ240621P00400000' };
  assert.strictEqual(deriveChainSymbol(record), 'QQQ');
});

test('collectOptionRecords identifica objetos anidados', () => {
  const records = collectOptionRecords(samplePayload);
  assert.strictEqual(records.length, 1);
  const [record] = records;
  assert.strictEqual(record.chain_symbol, 'SPY');
  assert.strictEqual(record.option_type, 'call');
});

test('optionRowFromRecord crea filas con greeks', () => {
  const [record] = collectOptionRecords(samplePayload);
  const now = DateTime.fromISO('2024-01-10T15:00:00Z');
  const row = optionRowFromRecord(record, {
    url: 'https://api.robinhood.com/options/',
    now,
    allowedSymbols: new Set(['SPY']),
    horizonDays: 30,
    primarySymbol: 'SPY',
    primaryExpiration: undefined,
  });

  assert.ok(row);
  assert.strictEqual(row?.chainSymbol, 'SPY');
  assert.strictEqual(row?.type, 'CALL');
  assert.strictEqual(row?.strike, 450);
  assert.strictEqual(row?.bid, 1.23);
  assert.strictEqual(row?.ask, 1.45);
  assert.strictEqual(row?.impliedVolatility, 0.25);
  assert.strictEqual(row?.delta, 0.55);
  assert.strictEqual(row?.theta, -0.03);
});

test('optionRowFromRecord respeta horizonDays y símbolos', () => {
  const [record] = collectOptionRecords(samplePayload);
  const now = DateTime.fromISO('2024-01-10T15:00:00Z');
  const rejectedByHorizon = optionRowFromRecord(record, {
    url: 'https://api.robinhood.com/options/',
    now,
    allowedSymbols: new Set(['SPY']),
    horizonDays: 1,
    primarySymbol: 'SPY',
    primaryExpiration: undefined,
  });
  assert.strictEqual(rejectedByHorizon, null);

  const rejectedBySymbol = optionRowFromRecord(record, {
    url: 'https://api.robinhood.com/options/',
    now,
    allowedSymbols: new Set(['QQQ']),
    horizonDays: 30,
    primarySymbol: 'SPY',
    primaryExpiration: undefined,
  });
  assert.strictEqual(rejectedBySymbol, null);
});

test('computeDte devuelve días decimales', () => {
  const now = DateTime.fromISO('2024-01-10T00:00:00Z');
  const dte = computeDte('2024-01-19', now);
  assert.ok(dte && dte > 8 && dte < 11);
});

test('normaliseOptionType normaliza variantes', () => {
  assert.strictEqual(normaliseOptionType('CALL'), 'CALL');
  assert.strictEqual(normaliseOptionType('p'), 'PUT');
  assert.strictEqual(normaliseOptionType('unknown'), undefined);
});
