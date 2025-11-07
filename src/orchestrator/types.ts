import type { BrowserContext, Page } from 'playwright';

export type ModuleAction = string;

export type SubBrowserArgs = {
  readonly moduleName: string;
  readonly action: ModuleAction;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly persistCookies?: boolean;
  readonly persistIndexedDb?: boolean;
  readonly storageStatePath?: string;
  readonly indexedDbSeed?: string;
  readonly indexedDbProfile?: string;
};

export type SubBrowserRuntime = {
  readonly context: BrowserContext;
  readonly page: Page;
};

export type ModuleRunner = (args: SubBrowserArgs, runtime: SubBrowserRuntime) => Promise<unknown>;

export type OrchestratorModule = {
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly runner: ModuleRunner;
};
