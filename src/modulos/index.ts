import type { ModuleRunner } from '../orchestrator/types.js';
import { runSpy5m1mModule } from './spy-5m-1m.js';
import { runSpyDailyHourly15mModule } from './spy-daily-hourly-15m.js';
import { runSpyOptionsChainModule } from './spy-options-chain.js';
import { runSpxOptionsChainModule } from './spx-options-chain.js';

export const MODULE_RUNNERS: Record<string, ModuleRunner> = {
  'spy-5m-1m': runSpy5m1mModule,
  'spy-daily-hourly-15m': runSpyDailyHourly15mModule,
  'spy-options-chain': runSpyOptionsChainModule,
  'spx-options-chain': runSpxOptionsChainModule,
};
