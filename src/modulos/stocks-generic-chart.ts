import { registerCloser } from '../bootstrap/signals.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { runSocketSniffer } from './socket-sniffer.js';

const DEFAULT_SYMBOLS = ['SPY'] as const;

const resolveSymbols = (symbols?: readonly string[]): readonly string[] => {
  if (symbols && symbols.length > 0) {
    return symbols;
  }
  return DEFAULT_SYMBOLS;
};

/**
 * Runner genérico para capturar velas, *quotes* y *trades* de cualquier
 * símbolo soportado por Legend. Se apoya en `runSocketSniffer` para persistir
 * CSV agregados y los `jsonl` por canal.
 */
export const runStocksGenericChartModule: ModuleRunner = async (args, { page }) => {
  const symbols = resolveSymbols(args.symbols);
  const logPrefix = args.outPrefix ?? args.module;

  const handle = await runSocketSniffer(page, {
    symbols,
    logPrefix,
    start: args.start,
    end: args.end,
  });

  registerCloser(handle.close);
  return handle.logPattern;
};
