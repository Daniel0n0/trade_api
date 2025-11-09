import { registerCloser } from '../bootstrap/signals.js';
import { dataPath } from '../io/paths.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { installFuturesRecorder } from '../modules/futures/interceptor.js';
import {
  createContractUpdater,
  installFuturesContractTracker,
  waitForFuturesData,
} from './futures-shared.js';

const WAIT_TIMEOUT_MS = 20_000;

const resolvePrimarySymbol = (symbols?: readonly string[]): string => {
  if (!symbols || symbols.length === 0) {
    throw new Error('[futures-detail] Se requiere al menos un contrato para iniciar la captura.');
  }

  for (const candidate of symbols) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed.toUpperCase();
    }
  }

  throw new Error('[futures-detail] No se proporcionó un contrato válido.');
};

const normalizeSymbolList = (symbols?: readonly string[]): readonly string[] | undefined => {
  if (!symbols || symbols.length === 0) {
    return undefined;
  }
  const normalized = symbols
    .map((symbol) => symbol?.trim()?.toUpperCase())
    .filter((symbol): symbol is string => Boolean(symbol));
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Captura barras y *snapshots* del contrato solicitado y registra nuevos
 * símbolos detectados en la caché de contratos conocidos.
 */
export const runFuturesDetailModule: ModuleRunner = async (args, { page }) => {
  const normalizedSymbols = normalizeSymbolList(args.symbols);
  const primarySymbol = resolvePrimarySymbol(normalizedSymbols);
  const updateContracts = createContractUpdater('futures-detail');

  await updateContracts([primarySymbol]);

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
    console.warn('[futures-detail] No se recibieron respuestas de futuros en el tiempo límite configurado.');
  }

  const snapshotsPath = dataPath({ assetClass: 'futures', symbol: primarySymbol }, 'snapshots', 'futures-snapshots.csv');
  return snapshotsPath;
};
