import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FUTURES_MODULE_NAMES,
  FUTURES_ROUTES,
  FUTURES_SYMBOLS_BY_MODULE,
  FUTURES_URL_BY_MODULE,
  createFuturesRoute,
} from '../src/modules/futures/routes.js';

describe('futures routes helpers', () => {
  it('normalizes slug and symbol', () => {
    const route = createFuturesRoute({ module: 'futures-test', symbol: 'mx1', slug: ' custom-path ' });
    assert.equal(route.slug, 'CUSTOM-PATH');
    assert.equal(route.symbol, 'MX1');
    assert.deepEqual(route.symbols, ['MX1']);
    assert.equal(route.url, 'https://robinhood.com/futures/CUSTOM-PATH');
  });

  it('exposes module level maps', () => {
    assert.ok(FUTURES_ROUTES.length > 0);
    for (const route of FUTURES_ROUTES) {
      assert.equal(FUTURES_URL_BY_MODULE[route.module], route.url);
      assert.deepEqual(FUTURES_SYMBOLS_BY_MODULE[route.module], route.symbols);
    }
  });

  it('lists module names without duplicates', () => {
    const unique = new Set(FUTURES_MODULE_NAMES);
    assert.equal(unique.size, FUTURES_MODULE_NAMES.length);
    for (const name of FUTURES_MODULE_NAMES) {
      assert.ok(FUTURES_URL_BY_MODULE[name]);
    }
  });
});
