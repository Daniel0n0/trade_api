import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import type { BrowserContext, Page, Response } from 'playwright';

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

test('stock daily news runner escribe artículos de Dora sin duplicados', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-runner-news-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const runner = createStockDailyRunner({
      moduleName: 'stock-daily-news',
      features: { news: true },
      buildResult: (state) => {
        if (!state.news) {
          throw new Error('No se inicializó el resultado de noticias');
        }
        return state.news;
      },
    });

    const page = new FakePage();
    const runtime = {
      page: page as unknown as Page,
      context: {} as BrowserContext,
    };

    const args = { module: 'stock-daily-news', action: 'test', symbols: ['SPY'] } as const;
    const result = (await runner(args, runtime)) as { csvPath: string; jsonlPath: string };

    const payloadPath = new URL('./fixtures/dora-feed.json', import.meta.url);
    const payload = readFileSync(payloadPath, 'utf-8');
    const response = new FakeResponse('https://dora.robinhood.com/feed/instrument/', payload);

    await page.emit('response', response as unknown as Response);
    await delay(10);

    const csvLines = readFileSync(result.csvPath, 'utf-8').trim().split('\n');
    assert.equal(csvLines.length, 3);
    const csvIds = csvLines.slice(1).map((line) => line.split(',')[2]);
    assert.deepEqual(csvIds.sort(), ['spy-001', 'spy-002']);

    const jsonDir = path.dirname(result.jsonlPath);
    const jsonFiles = readdirSync(jsonDir).filter((name) => name.startsWith('news-') && name.endsWith('.jsonl'));
    assert.equal(jsonFiles.length, 1);
    const jsonLines = readFileSync(path.join(jsonDir, jsonFiles[0]), 'utf-8').trim().split('\n');
    assert.equal(jsonLines.length, 2);
    const parsedIds = jsonLines.map((line) => JSON.parse(line).id).sort();
    assert.deepEqual(parsedIds, ['spy-001', 'spy-002']);
  } finally {
    process.chdir(previousCwd);
  }
});
