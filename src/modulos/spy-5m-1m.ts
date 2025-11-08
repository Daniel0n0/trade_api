import { registerCloser } from '../bootstrap/signals.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { runSocketSniffer } from './socket-sniffer.js';

const MODULE_SYMBOLS = ['SPY'] as const;

export const runSpy5m1mModule: ModuleRunner = async (args, { page }) => {
  const handle = await runSocketSniffer(page, {
    symbols: MODULE_SYMBOLS,
    logPrefix: 'spy-5m-1m',
    start: args.start,
    end: args.end,
  });

  registerCloser(handle.close);
  return handle.logPattern;
};
