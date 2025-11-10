import { createStockDailyRunner } from './stock-daily-shared.js';

export const runStockDailyStatsModule = createStockDailyRunner({
  moduleName: 'daily-stats',
  features: { stats: true },
  buildResult: (state) => {
    if (!state.stats) {
      throw new Error('[daily-stats] No se pudo inicializar la salida de estadísticas.');
    }
    return state.stats.statsPath;
  },
});

