import type { Page } from 'playwright';

export type ModuleRunner = (page: Page) => Promise<void>;

export const MODULE_RUNNERS: Record<string, ModuleRunner> = {};
