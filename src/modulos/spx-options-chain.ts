import { createOptionsModuleRunner } from './options-shared.js';

const DEFAULT_SYMBOLS = ['SPX'] as const;

/**
 * Captura la cadena de opciones de SPX y persiste las respuestas relevantes
 * (CSV por expiración y eventos Legend relacionados).
 */
export const runSpxOptionsChainModule = createOptionsModuleRunner(DEFAULT_SYMBOLS);
