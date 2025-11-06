import type { Page } from 'playwright';

import { runSpy5m1mModule } from './spy-5m-1m.js';

export type ModuleRunner = (page: Page) => Promise<void>;

export const MODULE_RUNNERS: Record<string, ModuleRunner> = {
  'spy-5m-1m': runSpy5m1mModule,
};
