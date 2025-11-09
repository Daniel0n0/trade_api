import { createOptionsModuleRunner } from './options-shared.js';

const DEFAULT_SYMBOLS = ['SPY'] as const;

/**
 * Captura la cadena de opciones de SPY usando el sniffer de sockets y el
 * interceptor de respuestas HTTP para persistir CSV por expiración.
 */
export const runSpyOptionsChainModule = createOptionsModuleRunner(DEFAULT_SYMBOLS);
