import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveOptionsSymbols,
  resolveOptionsUrl,
} from '../src/modules/options/runner.js';
import type { ModuleArgs } from '../src/orchestrator/messages.js';
import type { RunnerStartPayload } from '../src/modules/messages.js';

const baseArgs: ModuleArgs = {
  module: 'spy-options-chain',
  action: 'now',
};

const spxArgs: ModuleArgs = {
  module: 'spx-options-chain',
  action: 'now',
};

test('resolveOptionsSymbols usa default de módulo para SPY y SPX', () => {
  assert.deepStrictEqual(resolveOptionsSymbols(baseArgs), ['SPY']);
  assert.deepStrictEqual(resolveOptionsSymbols(spxArgs), ['SPX']);
});

test('resolveOptionsSymbols respeta símbolos personalizados', () => {
  const customArgs: ModuleArgs = { module: 'options', action: 'now', symbols: ['QQQ'] };
  const payload: RunnerStartPayload = { symbols: ['IWM'] };

  assert.deepStrictEqual(resolveOptionsSymbols(customArgs), ['QQQ']);
  assert.deepStrictEqual(resolveOptionsSymbols(customArgs, payload), ['IWM']);
});

test('resolveOptionsUrl usa mapeos de módulo para SPY y SPX', () => {
  const spySymbols = resolveOptionsSymbols(baseArgs);
  const spxSymbols = resolveOptionsSymbols(spxArgs);

  assert.strictEqual(
    resolveOptionsUrl(baseArgs, undefined, spySymbols),
    'https://robinhood.com/options/chains/SPY',
  );
  assert.strictEqual(
    resolveOptionsUrl(spxArgs, undefined, spxSymbols),
    'https://robinhood.com/options/chains/SPX',
  );
});

test('resolveOptionsUrl prioriza payload.url y urlMode', () => {
  const args: ModuleArgs = { module: 'options', action: 'now', urlMode: 'symbol' };
  const symbols = resolveOptionsSymbols(args);
  const overrideUrlPayload: RunnerStartPayload = { url: 'https://robinhood.com/options/chains/QQQ' };
  const overrideSymbolsPayload: RunnerStartPayload = { symbols: ['AAPL'] };

  assert.strictEqual(
    resolveOptionsUrl(args, overrideUrlPayload, symbols),
    'https://robinhood.com/options/chains/QQQ',
  );

  const symbolBasedUrl = resolveOptionsUrl(args, overrideSymbolsPayload, ['AAPL']);
  assert.strictEqual(symbolBasedUrl, 'https://robinhood.com/options/chains/AAPL');

  const moduleArgs: ModuleArgs = { module: 'spy-options-chain', action: 'now', urlMode: 'module' };
  const moduleSymbols = resolveOptionsSymbols(moduleArgs);
  assert.strictEqual(
    resolveOptionsUrl(moduleArgs, undefined, moduleSymbols),
    'https://robinhood.com/options/chains/SPY',
  );
});
