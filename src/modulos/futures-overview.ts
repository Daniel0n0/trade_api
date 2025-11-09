import { registerCloser } from '../bootstrap/signals.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { installFuturesRecorder } from '../modules/futures/interceptor.js';
import {
  createContractUpdater,
  getFuturesContractCachePath,
  installFuturesContractTracker,
  waitForFuturesData,
} from './futures-shared.js';

const WAIT_TIMEOUT_MS = 20_000;

const normalizeSymbols = (symbols?: readonly string[]): readonly string[] | undefined => {
  if (!symbols || symbols.length === 0) {
    return undefined;
  }
  const normalized = symbols
    .map((symbol) => symbol?.trim()?.toUpperCase())
    .filter((symbol): symbol is string => Boolean(symbol));
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Activa el interceptor de futuros y actualiza la caché de contratos con los
 * símbolos detectados en la vista general.
 */
export const runFuturesOverviewModule: ModuleRunner = async (args, { page }) => {
  const normalizedSymbols = normalizeSymbols(args.symbols);
  const updateContracts = createContractUpdater('futures-overview');

  if (normalizedSymbols) {
    await updateContracts(normalizedSymbols);
  }

  const recorderHandle = installFuturesRecorder({
    page,
    symbols: normalizedSymbols,
    onDiscoveredSymbols: (symbols) => {
      void updateContracts(symbols);
    },
  });
  registerCloser(() => recorderHandle.close());

  const trackerHandle = installFuturesContractTracker(page, {
    onSymbols: (symbols) => {
      void updateContracts(symbols);
    },
  });
  registerCloser(trackerHandle.close);

  const dataDetected = await waitForFuturesData(page, WAIT_TIMEOUT_MS);
  if (!dataDetected) {
    console.warn('[futures-overview] No se detectaron respuestas de futuros durante la ventana de espera.');
  }

  return getFuturesContractCachePath();
};
