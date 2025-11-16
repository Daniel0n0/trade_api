import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import type { BrowserContext, Page, Response, WebSocket } from 'playwright';

import { createStockDailyRunner } from '../src/modulos/stock-daily-shared.js';

class FakePage {
  private readonly listeners = new Map<string, Set<(...args: any[]) => unknown>>();

  on(event: string, listener: (...args: any[]) => unknown): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => unknown): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  async emit(event: string, ...args: any[]): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of Array.from(handlers)) {
      await handler(...args);
    }
  }
}

class FakeResponse {
  constructor(private readonly urlValue: string, private readonly body: string) {}

  url(): string {
    return this.urlValue;
  }

  status(): number {
    return 200;
  }

  headers(): Record<string, string> {
    return { 'content-type': 'application/json' };
  }

  async text(): Promise<string> {
    return this.body;
  }
}

class FakeWebSocket {
  private readonly listeners = new Map<string, Set<(...args: any[]) => unknown>>();

  constructor(private readonly urlValue: string) {}

  url(): string {
    return this.urlValue;
  }

  on(event: string, listener: (...args: any[]) => unknown): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => unknown): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  async emit(event: string, ...args: any[]): Promise<void> {
    const handlers = this.listeners.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of Array.from(handlers)) {
      await handler(...args);
    }
  }
}

test('stock daily greeks runner writes HTTP and WS events to disk', { concurrency: false }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-runner-greeks-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const runner = createStockDailyRunner({
      moduleName: 'daily-greeks',
      features: { greeks: true },
      buildResult: (state) => {
        if (!state.greeks) {
          throw new Error('No se inicializó el resultado de greeks');
        }
        return state.greeks;
      },
    });

    const page = new FakePage();
    const runtime = {
      page: page as unknown as Page,
      context: {} as BrowserContext,
    };

    const args = { module: 'daily-greeks', action: 'test', symbols: ['SPY'] } as const;
    const result = (await runner(args, runtime)) as { csvPath: string; jsonlPath: string };

    const payloadPath = new URL('./fixtures/legend-greeks.json', import.meta.url);
    const payloadText = readFileSync(payloadPath, 'utf-8');
    const response = new FakeResponse('https://legend.robinhood.com/options/greeks', payloadText);

    await page.emit('response', response as unknown as Response);

    const socket = new FakeWebSocket('wss://legend.robinhood.com/stream/greeks');
    await page.emit('websocket', socket as unknown as WebSocket);

    const wsPayload = [
      {
        chain_symbol: 'SPY',
        occ_symbol: 'SPY240621P00340000',
        option_type: 'put',
        expiration_date: '2024-06-21',
        strike_price: '340',
        greeks: {
          delta: -0.5,
          gamma: 0.13,
          theta: -0.05,
          vega: 0.21,
        },
      },
    ];

    await socket.emit('framereceived', { payload: JSON.stringify(wsPayload) });
    await delay(10);

    const csvLines = readFileSync(result.csvPath, 'utf-8').trim().split('\n');
    assert.equal(csvLines.length, 4, 'CSV should contain header plus three greeks rows');

    const jsonDir = path.dirname(result.jsonlPath);
    const jsonFiles = readdirSync(jsonDir).filter((name) => name.startsWith('greeks-') && name.endsWith('.jsonl'));
    assert.equal(jsonFiles.length, 1, 'Runner should persist greeks into a single rotating file');
    const jsonLines = readFileSync(path.join(jsonDir, jsonFiles[0]), 'utf-8')
      .trim()
      .split('\n');
    assert.equal(jsonLines.length, 3, 'HTTP and WS greeks payloads must reach jsonl');
    const parsedOccSymbols = jsonLines.map((line) => JSON.parse(line).occSymbol).sort();
    assert.deepEqual(
      parsedOccSymbols,
      ['SPY240621C00350000', 'SPY240621P00340000', 'SPY240621P00350000'],
    );
  } finally {
    process.chdir(previousCwd);
  }
});
