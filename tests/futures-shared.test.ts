import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { BrowserContext, Page, Response } from 'playwright';

const originalCwd = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'futures-shared-tests-'));
process.chdir(tempDir);

const futuresSharedModule = await import('../src/modulos/futures-shared.js');
const {
  installFuturesContractTracker,
  createContractUpdater,
  getFuturesContractCachePath,
  loadFuturesContractCache,
  resetFuturesContractCacheForTesting,
} = futuresSharedModule;

type ResponseListener = (response: Response) => void | Promise<void>;

type WaitForResponsePredicate = Parameters<Page['waitForResponse']>[0];
type WaitForResponseOptions = Parameters<Page['waitForResponse']>[1];

type ResponseWaiter = {
  readonly predicate: (response: Response) => Promise<boolean>;
  readonly resolve: (response: Response) => void;
  readonly reject: (error: Error) => void;
  readonly timer?: NodeJS.Timeout;
};

class FakePage implements Pick<Page, 'on' | 'off' | 'waitForResponse'> {
  private readonly listeners = new Set<ResponseListener>();
  private readonly waiters: ResponseWaiter[] = [];

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

  waitForResponse(
    predicate: WaitForResponsePredicate,
    options?: WaitForResponseOptions,
  ): Promise<Response> {
    const predicateFn = this.normalizePredicate(predicate);

    return new Promise<Response>((resolve, reject) => {
      const waiter: ResponseWaiter = {
        predicate: predicateFn,
        resolve,
        reject: (error) => {
          reject(error);
        },
        timer: options?.timeout
          ? setTimeout(() => {
              this.removeWaiter(waiter);
              reject(new Error('Timeout while waiting for response.'));
            }, options.timeout)
          : undefined,
      };

      this.waiters.push(waiter);
    });
  }

  private normalizePredicate(
    predicate: WaitForResponsePredicate,
  ): ResponseWaiter['predicate'] {
    if (typeof predicate === 'string') {
      return async (response) => response.url() === predicate;
    }
    if (predicate instanceof RegExp) {
      return async (response) => predicate.test(response.url());
    }
    return async (response) => Boolean(await predicate(response));
  }

  private removeWaiter(waiter: ResponseWaiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }
  }

  private async settleWaiters(response: Response): Promise<void> {
    const pending = [...this.waiters];
    for (const waiter of pending) {
      let matched = false;
      try {
        matched = await waiter.predicate(response);
      } catch (error) {
        this.removeWaiter(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (matched) {
        this.removeWaiter(waiter);
        waiter.resolve(response);
      }
    }
  }

  async emit(response: Response): Promise<void> {
    await this.settleWaiters(response);
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

const waitForCacheFile = async (filePath: string, retries = 20, delayMs = 10): Promise<string> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

describe('futures shared helpers', () => {
  beforeEach(async () => {
    await resetFuturesContractCacheForTesting();
  });

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

  it('detecta discovery/lists en la raíz del endpoint', async () => {
    const page = new FakePage();
    const recorded: string[][] = [];
    const handle = installFuturesContractTracker(page as unknown as Page, {
      onSymbols: (symbols) => {
        recorded.push([...symbols]);
      },
    });

    await page.emit(
      createJsonResponse('https://api.robinhood.com/discovery/lists/?cursor=abc123', {
        results: [{ contract_code: 'GCZ4' }],
      }),
    );

    assert.deepEqual(recorded, [['GCZ4']]);

    handle.close();
  });

  it('detecta discovery/lists con parámetros de consulta', async () => {
    const page = new FakePage();
    const recorded: string[][] = [];
    const handle = installFuturesContractTracker(page as unknown as Page, {
      onSymbols: (symbols) => {
        recorded.push([...symbols]);
      },
    });

    await page.emit(
      createJsonResponse('https://api.robinhood.com/discovery/lists/top-contracts?cursor=abc123', {
        results: [{ contract_code: 'CLF5' }],
      }),
    );

    assert.deepEqual(recorded, [['CLF5']]);

    handle.close();
  });

  it('detecta discovery/lists con rutas anidadas', async () => {
    const page = new FakePage();
    const recorded: string[][] = [];
    const handle = installFuturesContractTracker(page as unknown as Page, {
      onSymbols: (symbols) => {
        recorded.push([...symbols]);
      },
    });

    await page.emit(
      createJsonResponse('https://api.robinhood.com/discovery/lists/contracts/futures/top?limit=20', {
        results: [{ contract_code: 'ESZ4' }],
        extra: { nested: [{ future_symbol: 'NQZ4' }] },
      }),
    );

    assert.deepEqual(recorded.map((symbols) => symbols.sort()), [['ESZ4', 'NQZ4']]);

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

  it('omite discovery/lists para historiales y snapshots', async () => {
    const page = new FakePage();
    let calls = 0;
    const handle = installFuturesContractTracker(page as unknown as Page, {
      onSymbols: () => {
        calls += 1;
      },
    });

    const candidates = [
      'https://api.robinhood.com/discovery/lists/historicals/mesu4',
      'https://api.robinhood.com/discovery/lists/snapshots/mesu4',
    ];

    for (const url of candidates) {
      await page.emit(
        createJsonResponse(url, {
          results: [{ contract_code: 'MESU4' }],
        }),
      );
    }

    assert.equal(calls, 0);

    handle.close();
  });

  it('runFuturesOverviewModule actualiza la caché con discovery/lists', async () => {
    const { runFuturesOverviewModule } = await import('../src/modulos/futures-overview.js');

    const page = new FakePage();
    const runtime = {
      page: page as unknown as Page,
      context: {} as unknown as BrowserContext,
    };

    const runPromise = runFuturesOverviewModule(
      { module: 'futures-overview', action: 'preview' },
      runtime,
    );

    await page.emit(
      createJsonResponse('https://api.robinhood.com/discovery/lists/top-contracts/', {
        results: [
          { contract_code: 'mesu4' },
          { contract_code: 'mnqz4' },
        ],
      }),
    );

    const cachePath = await runPromise;
    const resolvedPath = typeof cachePath === 'string' ? cachePath : String(cachePath);
    const raw = await waitForCacheFile(resolvedPath);
    const parsed = JSON.parse(raw) as { symbols?: string[] };
    assert.deepEqual(parsed.symbols, ['MESU4', 'MNQZ4']);
  });

  it('persiste símbolos nuevos sin duplicados en la caché', async () => {
    const updater = createContractUpdater('test-suite');

    await updater([' mesu4 ', 'MESU4', 'invalid']);

    const cachePath = getFuturesContractCachePath();
    const raw = await waitForCacheFile(cachePath);
    const parsed = JSON.parse(raw) as { symbols?: string[] };
    assert.deepEqual(parsed.symbols, ['MESU4']);

    await updater(['mnqz4', 'MESU4', 'MNQZ4']);
    const cache = await loadFuturesContractCache();
    assert.deepEqual(cache.symbols, ['MESU4', 'MNQZ4']);
  });

});

