import type { BrowserContext, Page } from 'playwright';

import type { ModuleAction, ModuleArgs } from './messages.js';

export type { ModuleAction, ModuleArgs } from './messages.js';

export type SubBrowserRuntime = {
  readonly context: BrowserContext;
  readonly page: Page;
};

export type ModuleRunner = (args: ModuleArgs, runtime: SubBrowserRuntime) => Promise<unknown>;

export type OrchestratorModule = {
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly runner: ModuleRunner;
};
