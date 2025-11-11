import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  createNewsFeature,
  createOrderbookFeature,
  createStatsFeature,
} from '../src/modulos/stock-daily-shared.js';

const useTempWorkspace = () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-stock-filters-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);
  return () => {
    process.chdir(previousCwd);
  };
};

test('stats shouldProcessUrl matches Robinhood fundamentals endpoints', async () => {
  const restoreCwd = useTempWorkspace();
  const feature = createStatsFeature('TSLA');

  try {
    assert.ok(
      feature.shouldProcessUrl('https://api.robinhood.com/fundamentals/TSLA/'),
      'fundamentals endpoint on api.robinhood.com should be accepted',
    );
    assert.ok(
      feature.shouldProcessUrl('https://midlands.robinhood.com/marketdata/stocks/fundamentals/?symbols=TSLA'),
      'fundamentals endpoint on midlands must be accepted',
    );
    assert.ok(
      feature.shouldProcessUrl(
        'https://legend.robinhood.com/api/midlands/marketdata/stocks/fundamentals?symbols=TSLA,SPY',
      ),
      'Legend proxy fundamentals endpoint should be accepted even with multiple symbols',
    );
    assert.ok(
      !feature.shouldProcessUrl(
        'https://midlands.robinhood.com/marketdata/stocks/fundamentals/?symbols=AAPL',
      ),
      'requests for other symbols must not be accepted',
    );
    assert.ok(
      !feature.shouldProcessUrl('https://example.com/fundamentals/TSLA'),
      'non-Robinhood hosts must be ignored',
    );
  } finally {
    await feature.close();
    restoreCwd();
  }
});

test('orderbook shouldProcessUrl matches Robinhood orderbook endpoints', async () => {
  const restoreCwd = useTempWorkspace();
  const feature = createOrderbookFeature('TSLA');

  try {
    assert.ok(
      feature.shouldProcessUrl('https://api.robinhood.com/marketdata/level2/TSLA/'),
      'Level 2 endpoint on api.robinhood.com should be accepted',
    );
    assert.ok(
      feature.shouldProcessUrl('https://midlands.robinhood.com/marketdata/stocks/orderbook/?symbol=TSLA'),
      'Midlands orderbook endpoint should be accepted',
    );
    assert.ok(
      feature.shouldProcessUrl(
        'https://legend.robinhood.com/api/midlands/marketdata/stocks/orderbook?symbols=TSLA%2CQQQ',
      ),
      'Legend orderbook proxy should be accepted when the symbol list includes the module symbol',
    );
    assert.ok(
      !feature.shouldProcessUrl('https://midlands.robinhood.com/marketdata/stocks/orderbook/?symbol=AAPL'),
      'orderbook endpoints for other symbols must be rejected',
    );
  } finally {
    await feature.close();
    restoreCwd();
  }
});

test('news shouldProcessUrl matches Legend and Midlands symbol endpoints', async () => {
  const restoreCwd = useTempWorkspace();
  const feature = createNewsFeature('TSLA');

  try {
    assert.ok(
      feature.shouldProcessUrl('https://legend.robinhood.com/midlands/news/article/?symbols=TSLA'),
      'Legend news endpoint with symbol query must be accepted',
    );
    assert.ok(
      feature.shouldProcessUrl(
        'https://midlands.robinhood.com/midlands/news/stories?symbols=TSLA,SPY',
      ),
      'Midlands news endpoint should be accepted when the query contains the module symbol',
    );
    assert.ok(
      !feature.shouldProcessUrl('https://legend.robinhood.com/midlands/news/article/?symbols=AAPL'),
      'News endpoints for unrelated symbols must be rejected',
    );
  } finally {
    await feature.close();
    restoreCwd();
  }
});
