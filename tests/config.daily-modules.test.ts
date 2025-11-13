import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MODULES,
  MODULE_ALIASES,
  canonicalizeModuleName,
  getModuleDefaultArgs,
  resolveModuleUrl,
} from '../src/config.js';

type DailyModuleName = 'daily-stats' | 'daily-news' | 'daily-order-book' | 'daily-greeks';

const EXPECTED_URL = 'https://robinhood.com/stocks/SPY';

const findModule = (name: DailyModuleName) => {
  const definition = MODULES.find((module) => module.name === name);
  assert.ok(definition, `Se esperaba la definición del módulo "${name}" en MODULES.`);
  return definition;
};

const assertModuleAlignment = (name: DailyModuleName) => {
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
};

test('daily modules keep default args and urls aligned', () => {
  const moduleNames: DailyModuleName[] = ['daily-stats', 'daily-news', 'daily-order-book', 'daily-greeks'];

  for (const name of moduleNames) {
    assertModuleAlignment(name);
  }
});

test('stock daily module aliases map to the canonical definitions', () => {
  for (const [alias, canonical] of Object.entries(MODULE_ALIASES)) {
    assert.equal(
      canonicalizeModuleName(alias),
      canonical,
      `El alias ${alias} debe normalizarse a ${canonical}.`,
    );

    const definition = findModule(canonical as DailyModuleName);
    const defaults = getModuleDefaultArgs(definition);
    const url = resolveModuleUrl(definition, defaults);

    assert.deepEqual(
      defaults,
      { symbols: ['SPY'] },
      `Los argumentos predeterminados para el alias ${alias} deben apuntar a SPY.`,
    );

    assert.equal(
      url,
      EXPECTED_URL,
      `La URL resuelta para el alias ${alias} debe apuntar a la página de acciones con símbolo SPY.`,
    );

    assert.ok(
      !MODULES.some((module) => module.name === alias),
      `El alias ${alias} no debe publicarse como módulo independiente en MODULES.`,
    );
  }
});
