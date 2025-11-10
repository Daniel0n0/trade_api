import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Page, Response } from 'playwright';

const originalCwd = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'futures-shared-tests-'));
process.chdir(tempDir);

const futuresSharedModule = await import('../src/modulos/futures-shared.js');
const {
  installFuturesContractTracker,
  createContractUpdater,
  getFuturesContractCachePath,
  loadFuturesContractCache,
} = futuresSharedModule;

type ResponseListener = (response: Response) => void | Promise<void>;

class FakePage implements Pick<Page, 'on' | 'off'> {
  private readonly listeners = new Set<ResponseListener>();

  on(event: 'response', listener: ResponseListener): void {
    if (event === 'response') {
      this.listeners.add(listener);
    }
  }

  off(event: 'response', listener: ResponseListener): void {
    if (event === 'response') {
      this.listeners.delete(listener);
    }
  }

  async emit(response: Response): Promise<void> {
    const pending = Array.from(this.listeners).map((listener) =>
      Promise.resolve(listener(response)),
    );
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }
}

const createJsonResponse = (url: string, payload: unknown): Response =>
  ({
    status: () => 200,
    url: () => url,
    headers: () => ({ 'content-type': 'application/json' }),
    body: async () => Buffer.from(JSON.stringify(payload), 'utf8'),
  }) as unknown as Response;

describe('futures shared helpers', () => {
  after(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('extrae símbolos de discovery/lists y evita duplicados', async () => {
    const page = new FakePage();
    const recorded: string[][] = [];
    const handle = installFuturesContractTracker(page as unknown as Page, {
      onSymbols: (symbols) => {
        recorded.push([...symbols]);
      },
    });

    const response = createJsonResponse('https://api.robinhood.com/discovery/lists/top-contracts/', {
      results: [
        { contract_code: 'mesu4' },
        { contractCode: 'mnqz4' },
      ],
      data: {
        contracts: [
          { future_symbol: 'ZBZ4' },
          'unused',
        ],
      },
    });

    await page.emit(response);

    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0]?.sort(), ['MESU4', 'MNQZ4', 'ZBZ4']);

    await page.emit(response);
    assert.equal(recorded.length, 1, 'el tracker no debe reenviar duplicados');

    handle.close();
  });

  it('omite endpoints cubiertos por el interceptor principal', async () => {
    const page = new FakePage();
    let calls = 0;
    const handle = installFuturesContractTracker(page as unknown as Page, {
      onSymbols: () => {
        calls += 1;
      },
    });

    await page.emit(
      createJsonResponse('https://api.robinhood.com/marketdata/futures/historicals/1234/?span=day', {
        results: [{ contract_code: 'mesu4' }],
      }),
    );

    await page.emit(
      createJsonResponse('https://api.robinhood.com/marketdata/futures/snapshots/MESU4/', {
        results: [{ symbol: 'MESU4' }],
      }),
    );

    assert.equal(calls, 0);

    handle.close();
  });

  it('persiste símbolos nuevos sin duplicados en la caché', async () => {
    const updater = createContractUpdater('test-suite');

    await updater([' mesu4 ', 'MESU4', 'invalid']);

    const cachePath = getFuturesContractCachePath();
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as { symbols?: string[] };
    assert.deepEqual(parsed.symbols, ['MESU4']);

    await updater(['mnqz4', 'MESU4', 'MNQZ4']);
    const cache = await loadFuturesContractCache();
    assert.deepEqual(cache.symbols, ['MESU4', 'MNQZ4']);
  });
});

