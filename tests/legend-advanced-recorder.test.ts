import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  onLegendFrame,
  onLegendOpen,
  shouldProcessLegendWS,
} from '../src/modulos/legend-advanced-recorder.js';

const LEGEND_URL = 'wss://api.robinhood.com/marketdata/streaming/legend/';

const withTempCwd = async (fn: (cwd: string) => Promise<void>) => {
  const previousCwd = process.cwd();
  const workingDir = await mkdtemp(path.join(tmpdir(), 'legend-recorder-'));
  process.chdir(workingDir);
  try {
    await fn(workingDir);
  } finally {
    process.chdir(previousCwd);
    await rm(workingDir, { recursive: true, force: true });
  }
};

test('shouldProcessLegendWS enforces the legend streaming url', () => {
  assert.ok(shouldProcessLegendWS('wss://api.robinhood.com/marketdata/streaming/legend/'));
  assert.ok(shouldProcessLegendWS('wss://api.robinhood.com/marketdata/streaming/legend'));
  assert.ok(!shouldProcessLegendWS('wss://api.robinhood.com/marketdata/streaming/phoenix/'));
});

test('legend recorder persists handshake, keepalive and trade frames', async () => {
  await withTempCwd(async (cwd) => {
    const handshakeTs = Date.UTC(2024, 0, 2, 12, 30, 0);
    await onLegendOpen({
      url: LEGEND_URL,
      timestampMs: handshakeTs,
      symbols: ['SPY'],
      request: {
        method: 'GET',
        headers: [
          { name: 'Authorization', value: 'Bearer secret' },
          { name: 'User-Agent', value: 'Playwright' },
        ],
      },
      response: {
        status: 101,
        statusText: 'Switching Protocols',
        headers: [{ name: 'Server', value: 'robinhood' }],
      },
    });

    onLegendFrame({
      url: LEGEND_URL,
      timestampMs: handshakeTs,
      symbols: ['SPY'],
      payload: { type: 'KEEPALIVE', channel: 0 },
    });

    const tradeTs = Date.UTC(2024, 0, 3, 10, 0, 0);
    onLegendFrame({
      url: LEGEND_URL,
      timestampMs: tradeTs,
      symbols: ['SPY'],
      payload: {
        type: 'FEED_DATA',
        channel: 1,
        data: [
          {
            channel: 1,
            eventSymbol: 'SPY',
            eventType: 'Trade',
            price: 480.12,
            dayVolume: 2500,
            time: tradeTs,
          },
          {
            channel: 3,
            eventSymbol: 'SPY',
            eventType: 'TradeETH',
            price: 480.35,
            dayVolume: 2500,
            time: tradeTs,
          },
          {
            channel: 9,
            eventSymbol: 'SPY',
            eventType: 'Quote',
            price: 10,
            dayVolume: 0,
            time: tradeTs,
          },
        ],
      },
    });

    const handshakePath = path.join(
      cwd,
      'data',
      'stocks',
      'SPY',
      '2024-01-02',
      'legend',
      'raw',
      `ws_connect_${handshakeTs}.txt`,
    );
    const handshake = await readFile(handshakePath, 'utf8');
    assert.ok(handshake.includes('REQUEST GET'));
    assert.ok(!handshake.includes('Authorization:'));
    assert.ok(handshake.includes('RESPONSE 101 Switching Protocols'));

    const keepalivePath = path.join(cwd, 'data', 'stocks', 'SPY', '2024-01-02', 'legend', 'keepalive.csv');
    const keepalive = await readFile(keepalivePath, 'utf8');
    assert.ok(
      keepalive
        .trim()
        .endsWith(`${handshakeTs},2024-01-02,${LEGEND_URL},0,KEEPALIVE`),
    );

    const tradesPath = path.join(cwd, 'data', 'stocks', 'SPY', '2024-01-03', 'legend', 'trades.jsonl');
    const trades = await readFile(tradesPath, 'utf8');
    assert.deepEqual(
      trades
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      [
        {
          channel: 1,
          eventSymbol: 'SPY',
          eventType: 'Trade',
          price: 480.12,
          dayVolume: 2500,
          time: tradeTs,
        },
      ],
    );

    const tradesEthPath = path.join(cwd, 'data', 'stocks', 'SPY', '2024-01-03', 'legend', 'trades_eth.jsonl');
    const tradesEth = await readFile(tradesEthPath, 'utf8');
    assert.deepEqual(
      tradesEth
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      [
        {
          channel: 3,
          eventSymbol: 'SPY',
          eventType: 'TradeETH',
          price: 480.35,
          dayVolume: 2500,
          time: tradeTs,
        },
      ],
    );
  });
});
