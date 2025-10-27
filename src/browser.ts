import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';

import { defaultLaunchOptions, type LaunchOptions } from './config.js';

export interface BrowserResources {
  readonly context: BrowserContext;
  readonly close: () => Promise<void>;
}

export async function launchPersistentBrowser(
  overrides: Partial<LaunchOptions> = {},
): Promise<BrowserResources> {
  const options: LaunchOptions = { ...defaultLaunchOptions, ...overrides };
  ensureProfileDirectory(options.userDataDir);

  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: false,
    slowMo: options.slowMo,
    viewport: null,
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  if (options.tracingEnabled) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  return {
    context,
    close: async () => {
      if (options.tracingEnabled) {
        const tracePath = join(process.cwd(), 'artifacts', `trace-${Date.now()}.zip`);
        await context.tracing.stop({ path: tracePath });
      }
      await context.close();
      if (!options.preserveUserDataDir) {
        await cleanupProfile(options.userDataDir);
      }
    },
  };
}

function ensureProfileDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

async function cleanupProfile(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    /* eslint-disable no-console */
    console.warn(`No se pudo eliminar el directorio de perfil en ${path}:`, error);
    /* eslint-enable no-console */
  }
}
