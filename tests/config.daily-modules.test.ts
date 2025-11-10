import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODULES, getModuleDefaultArgs, resolveModuleUrl } from '../src/config.js';

type DailyModuleName = 'daily-stats' | 'daily-news' | 'daily-order-book';

const EXPECTED_URL = 'https://robinhood.com/stocks/SPY';

const findModule = (name: DailyModuleName) => {
  const definition = MODULES.find((module) => module.name === name);
  assert.ok(definition, `Se esperaba la definición del módulo "${name}" en MODULES.`);
  return definition;
};

test('daily modules keep default args and urls aligned', () => {
  const moduleNames: DailyModuleName[] = ['daily-stats', 'daily-news', 'daily-order-book'];

  for (const name of moduleNames) {
    const definition = findModule(name);
    const defaults = getModuleDefaultArgs(definition);
    assert.deepEqual(
      defaults,
      { symbols: ['SPY'] },
      `Los argumentos predeterminados de ${name} deben apuntar a SPY.`,
    );

    const url = resolveModuleUrl(definition, defaults);
    assert.equal(
      url,
      EXPECTED_URL,
      `La URL resuelta para ${name} debe apuntar a la página de acciones con símbolo SPY.`,
    );
  }
});
