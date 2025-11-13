import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DateTime } from 'luxon';

import {
  collectOptionRecords,
  computeDte,
  deriveChainSymbol,
  buildOptionsFilename,
  formatExpirationForFilename,
  normalizeExpiration,
  normaliseOptionType,
  optionRowFromRecord,
  isValidOptionRow,
  readLastTimestamp,
} from '../src/modules/options/interceptor.js';
import { dataPath } from '../src/io/paths.js';

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

test('isValidOptionRow rechaza strikes no positivos y valores negativos', () => {
  const [record] = collectOptionRecords(samplePayload);
  const now = DateTime.fromISO('2024-01-10T15:00:00Z');
  const baseRow = optionRowFromRecord(record, {
    url: 'https://api.robinhood.com/options/',
    now,
    allowedSymbols: new Set(['SPY']),
    horizonDays: 30,
    primarySymbol: 'SPY',
    primaryExpiration: undefined,
  });

  assert.ok(baseRow);
  assert.ok(isValidOptionRow(baseRow!));

  const zeroStrike = { ...baseRow!, strike: 0 };
  assert.strictEqual(isValidOptionRow(zeroStrike), false);

  const negativeBid = { ...baseRow!, bid: -1 };
  assert.strictEqual(isValidOptionRow(negativeBid), false);
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

test('formatExpirationForFilename limpia caracteres no permitidos', () => {
  assert.strictEqual(formatExpirationForFilename(undefined), 'undated');
  assert.strictEqual(formatExpirationForFilename('2024-01-19'), '2024-01-19');
  assert.strictEqual(formatExpirationForFilename('2024/01/19 Weekly'), '2024-01-19-Weekly');
  assert.strictEqual(formatExpirationForFilename('2024-01-19T09:30:00Z'), '2024-01-19T09-30-00Z');
});

test('buildOptionsFilename consolida por expiración y sanea prefijo', () => {
  assert.strictEqual(buildOptionsFilename('spy', '2024-01-19'), 'spy-options-2024-01-19.csv');
  assert.strictEqual(
    buildOptionsFilename('spy chain', '2024/01/19 Weekly'),
    'spy-chain-options-2024-01-19-Weekly.csv',
  );
  assert.strictEqual(buildOptionsFilename('custom', undefined), 'custom-options-undated.csv');
  assert.strictEqual(buildOptionsFilename('  ', undefined), 'options-options-undated.csv');
});

test('resolveWriter consolida strikes/tipos y respeta horizonte futuro', async (t) => {
  const headerLine = [
    't',
    'chainSymbol',
    'occSymbol',
    'instrumentId',
    'expiration',
    'dte',
    'strike',
    'type',
    'bid',
    'ask',
    'mark',
    'last',
    'volume',
    'openInterest',
    'impliedVolatility',
    'delta',
    'gamma',
    'theta',
    'vega',
    'rho',
    'underlyingPrice',
    'source',
  ].join(',');

  const dataRoot = path.join(process.cwd(), 'data');
  t.after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const expiration = '2024-05-20';
  const normalizedExpiration = formatExpirationForFilename(expiration);
  const nearFileName = buildOptionsFilename('spy', expiration);
  const nearPath = dataPath(
    { assetClass: 'stock', symbol: 'SPY', date: '2024-05-10' },
    'options',
    nearFileName,
  );

  assert.ok(
    nearPath.startsWith(
      path.join(process.cwd(), 'data', 'stocks', 'SPY', '2024-05-10'),
    ),
    `unexpected base path ${nearPath}`,
  );

  assert.ok(
    nearPath.endsWith(path.join('options', nearFileName)),
    `unexpected path ${nearPath}`,
  );

  fs.writeFileSync(
    nearPath,
    `${headerLine}\n1710000000000,SPY,\n1710000005000,SPY,\n`,
    'utf8',
  );

  assert.strictEqual(readLastTimestamp(nearPath, headerLine), 1710000005000);

  const farFileName = buildOptionsFilename('spy', expiration);
  const farPath = dataPath(
    { assetClass: 'stock', symbol: 'SPY', date: '2024-05-10' },
    'options',
    'in_the_future',
    normalizedExpiration,
    farFileName,
  );

  assert.ok(
    farPath.endsWith(path.join('options', 'in_the_future', normalizedExpiration, farFileName)),
    `unexpected path ${farPath}`,
  );

  const callFileName = buildOptionsFilename('spy', expiration);
  const putFileName = buildOptionsFilename('spy', expiration);
  assert.strictEqual(callFileName, putFileName);
  assert.ok(!/CALL|PUT|strike/i.test(callFileName));
});
