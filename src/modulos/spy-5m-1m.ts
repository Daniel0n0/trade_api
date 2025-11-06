import type { Page } from 'playwright';

import { runSocketSniffer } from './socket-sniffer.js';

const MODULE_SYMBOLS = ['SPY'] as const;

export async function runSpy5m1mModule(page: Page): Promise<void> {
  await runSocketSniffer(page, { symbols: MODULE_SYMBOLS, logPrefix: 'spy-5m-1m' });
}
