import type { Page } from 'playwright';

import { runSpyDailyHourly15mModule } from './spy-daily-hourly-15m.js';

export type ModuleRunner = (page: Page) => Promise<void>;

export const MODULE_RUNNERS: Record<string, ModuleRunner> = {
  'spy-daily-hourly-15m': runSpyDailyHourly15mModule,
};
