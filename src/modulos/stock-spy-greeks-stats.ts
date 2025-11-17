import { createStockDailyRunner } from './stock-daily-shared.js';

export const runSpyGreeksStatsModule = createStockDailyRunner({
  moduleName: 'spy-greeks-stats',
  features: { stats: true, greeks: true, news: true, orderbook: true },
  buildResult: (state) => {
    if (!state.stats) {
      throw new Error('[spy-greeks-stats] No se pudo inicializar la salida de estadísticas.');
    }
    if (!state.greeks) {
      throw new Error('[spy-greeks-stats] No se pudo inicializar la salida de greeks.');
    }

    return {
      statsPath: state.stats.statsPath,
      greeks: state.greeks,
      news: state.news,
      orderbook: state.orderbook,
    };
  },
});
