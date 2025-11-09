import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertModuleArgs, isModuleArgs, type ModuleArgs } from '../src/orchestrator/messages.js';

test('isModuleArgs acepta objetos válidos con nuevos campos', () => {
  const args: ModuleArgs = {
    module: 'spy-5m-1m',
    action: 'stream',
    symbols: ['SPY'],
    headless: true,
    start: '2024-01-01T13:30:00Z',
    end: '2024-01-01T20:00:00Z',
    closeOnFinish: true,
    outPrefix: 'spy-run',
    dataSink: 'filesystem',
    parentId: 'parent-123',
    loginMode: 'auto',
    credSource: 'env',
    optionsDate: '2024-01-01',
    optionsHorizon: 5,
    urlMode: 'symbol',
    urlCode: 'layout-123',
  };

  assert.ok(isModuleArgs(args));
  assert.doesNotThrow(() => assertModuleArgs(args));
});

test('assertModuleArgs rechaza dataSink inválido', () => {
  const invalid = {
    module: 'spy-5m-1m',
    action: 'now',
    dataSink: 'database',
  };

  assert.ok(!isModuleArgs(invalid));
  assert.throws(() => assertModuleArgs(invalid));
});

test('isModuleArgs rechaza urlMode desconocido', () => {
  const invalid = {
    module: 'spy-options-chain',
    action: 'now',
    urlMode: 'custom',
  };

  assert.ok(!isModuleArgs(invalid));
});

test('isModuleArgs rechaza urlCode vacío', () => {
  const invalid = {
    module: 'spy-options-chain',
    action: 'now',
    urlCode: '',
  };

  assert.ok(!isModuleArgs(invalid));
});
