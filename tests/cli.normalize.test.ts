import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  coerceBool,
  coerceISO,
  deriveOutPrefix,
  mapEnvFallbacks,
  mergeArgChain,
  normalizeModuleArgs,
  parseSymbols,
} from '../src/cli/normalize.js';
import type { ModuleArgsInput } from '../src/cli/schema.js';

test('parseSymbols normalizes separators and removes duplicados', () => {
  assert.deepEqual(parseSymbols('AAPL, msft TSLA'), ['AAPL', 'MSFT', 'TSLA']);
  assert.deepEqual(parseSymbols(['aapl', ' aapl ', ' MSFT ']), ['AAPL', 'MSFT']);
  assert.strictEqual(parseSymbols('   '), undefined);
});

test('coerceBool admite distintos literales', () => {
  assert.strictEqual(coerceBool(true), true);
  assert.strictEqual(coerceBool('YES'), true);
  assert.strictEqual(coerceBool('0'), false);
  assert.strictEqual(coerceBool(undefined), undefined);
});

test('coerceISO acepta cadenas y números', () => {
  assert.strictEqual(coerceISO('2024-01-01T00:00:00Z'), '2024-01-01T00:00:00Z');
  assert.strictEqual(coerceISO(1_700_000_000_000, { label: 'timestamp' }), '2023-11-14T22:13:20Z');
  assert.throws(() => coerceISO('fecha no válida'), /formato ISO 8601/);
});

test('deriveOutPrefix compone un nombre legible', () => {
  const prefix = deriveOutPrefix({
    module: 'quotes-stream',
    action: 'now',
    symbols: ['AAPL', 'MSFT'],
    timestamp: '2024-05-01T12:34:56Z',
  });
  assert.match(prefix, /^quotes-stream-now-20240501-123456-AAPL\+MSFT$/);
});

test('mapEnvFallbacks usa variables de entorno cuando faltan valores', () => {
  const env = {
    TRADE_API_MODULE: 'alpha',
    TRADE_API_ACTION: 'stream',
  } as NodeJS.ProcessEnv;
  const base: Partial<ModuleArgsInput> = {};
  const mapped = mapEnvFallbacks(base, { module: 'TRADE_API_MODULE', action: 'TRADE_API_ACTION' }, env);
  assert.deepEqual(mapped, { action: 'stream', module: 'alpha' });
});

test('normalizeModuleArgs convierte banderas y fechas', () => {
  const normalized = normalizeModuleArgs({
    module: 'quotes',
    action: 'stream',
    start: '2024-01-01T00:00:00Z',
    persistCookies: false,
  });
  assert.strictEqual(normalized.module, 'quotes');
  assert.strictEqual(normalized.action, 'stream');
  assert.strictEqual(normalized.start, '2024-01-01T00:00:00Z');
  assert.strictEqual(normalized.persistCookies, false);
});

test('normalizeModuleArgs acepta urlMode válidos', () => {
  const normalized = normalizeModuleArgs({ module: 'options', action: 'now', urlMode: 'symbol' });
  assert.strictEqual(normalized.urlMode, 'symbol');
  assert.throws(() => normalizeModuleArgs({ module: 'options', action: 'now', urlMode: 'invalid' }), /urlMode/);
});

test('mergeArgChain aplica precedencia de derecha a izquierda', () => {
  const defaults = { action: 'now' } satisfies Partial<ModuleArgsInput>;
  const env = { action: 'bars' } satisfies Partial<ModuleArgsInput>;
  const config = { action: 'stream', module: 'alpha' } satisfies Partial<ModuleArgsInput>;
  const cli = { module: 'beta' } satisfies Partial<ModuleArgsInput>;
  const merged = mergeArgChain(defaults, env, config, cli);
  assert.deepEqual(merged, { action: 'stream', module: 'beta' });
});
