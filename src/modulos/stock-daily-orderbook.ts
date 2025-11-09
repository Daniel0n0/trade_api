import { createStockDailyRunner } from './stock-daily-shared.js';

export const runStockDailyOrderbookModule = createStockDailyRunner({
  moduleName: 'stock-daily-orderbook',
  features: { orderbook: true },
  buildResult: (state) => {
    if (!state.orderbook) {
      throw new Error('[stock-daily-orderbook] No se pudo inicializar la salida del libro.');
    }
    return state.orderbook.csvPath;
  },
});

