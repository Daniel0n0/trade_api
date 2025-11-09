import type { ModuleRunner } from '../orchestrator/types.js';
import { runFuturesDetailModule } from './futures-detail.js';
import { runFuturesOverviewModule } from './futures-overview.js';
import { runOptionsGenericModule } from './options-generic.js';
import { runSpy5m1mModule } from './spy-5m-1m.js';
import { runSpyDailyHourly15mModule } from './spy-daily-hourly-15m.js';
import { runSpyOptionsChainModule } from './spy-options-chain.js';
import { runSpxOptionsChainModule } from './spx-options-chain.js';
import { runStockDailyNewsModule } from './stock-daily-news.js';
import { runStockDailyOrderbookModule } from './stock-daily-orderbook.js';
import { runStockDailyStatsModule } from './stock-daily-stats.js';
import { runStocksGenericChartModule } from './stocks-generic-chart.js';

export const MODULE_RUNNERS: Record<string, ModuleRunner> = {
  'spy-5m-1m': runSpy5m1mModule,
  'spy-daily-hourly-15m': runSpyDailyHourly15mModule,
  'spy-options-chain': runSpyOptionsChainModule,
  'spx-options-chain': runSpxOptionsChainModule,
  'stocks-generic-chart': runStocksGenericChartModule,
  'options-generic': runOptionsGenericModule,
  'stock-daily-stats': runStockDailyStatsModule,
  'stock-daily-news': runStockDailyNewsModule,
  'stock-daily-orderbook': runStockDailyOrderbookModule,
  'futures-overview': runFuturesOverviewModule,
  'futures-detail': runFuturesDetailModule,
};
