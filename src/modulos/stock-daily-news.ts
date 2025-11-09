import { createStockDailyRunner } from './stock-daily-shared.js';

export const runStockDailyNewsModule = createStockDailyRunner({
  moduleName: 'stock-daily-news',
  features: { news: true },
  buildResult: (state) => {
    if (!state.news) {
      throw new Error('[stock-daily-news] No se pudieron inicializar los archivos de noticias.');
    }
    return state.news;
  },
});

