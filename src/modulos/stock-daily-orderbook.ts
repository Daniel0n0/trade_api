import { createStockDailyRunner } from './stock-daily-shared.js';

export const runStockDailyOrderbookModule = createStockDailyRunner({
  moduleName: 'daily-order-book',
  features: { orderbook: true },
  buildResult: (state) => {
    if (!state.orderbook) {
      throw new Error('[daily-order-book] No se pudo inicializar la salida del libro.');
    }
    return state.orderbook.csvPath;
  },
});

