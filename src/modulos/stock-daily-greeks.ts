import { createStockDailyRunner } from './stock-daily-shared.js';

export const runStockDailyGreeksModule = createStockDailyRunner({
  moduleName: 'daily-greeks',
  features: { greeks: true },
  buildResult: (state) => {
    if (!state.greeks) {
      throw new Error('[daily-greeks] No se pudo inicializar la salida de greeks.');
    }
    return state.greeks;
  },
});
