import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';

import { defaultLaunchOptions, type LaunchOptions } from './config.js';

export interface BrowserResources {
  readonly context: BrowserContext;
  readonly close: () => Promise<void>;
  readonly enableNetworkBlocking: () => void;
}

export type LaunchMode = 'bootstrap' | 'reuse';

export interface PersistentLaunchOverrides extends Partial<LaunchOptions> {
  readonly mode?: LaunchMode;
  readonly storageStatePath?: string;
}

export async function launchPersistentBrowser(
  overrides: PersistentLaunchOverrides = {},
): Promise<BrowserResources> {
  const { mode = 'bootstrap', storageStatePath = join(process.cwd(), 'state.json'), ...rest } = overrides;
  const options: LaunchOptions = { ...defaultLaunchOptions, ...rest };

  if (mode === 'bootstrap') {
    return launchBootstrapContext(options);
  }

  return launchReusedContext(options, storageStatePath);
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

async function launchBootstrapContext(options: LaunchOptions): Promise<BrowserResources> {
  ensureProfileDirectory(options.userDataDir);

  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: false,
    slowMo: options.slowMo,
    viewport: null,
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const enableNetworkBlocking = configureNetworkBlocking(context, options.blockTrackingDomains);

  if (options.tracingEnabled) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  return {
    context,
    enableNetworkBlocking,
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

async function launchReusedContext(options: LaunchOptions, storageStatePath: string): Promise<BrowserResources> {
  const browser = await chromium.launch({
    headless: false,
    slowMo: options.slowMo,
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: null,
  });

  const enableNetworkBlocking = configureNetworkBlocking(context, options.blockTrackingDomains);

  if (options.tracingEnabled) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  return {
    context,
    enableNetworkBlocking,
    close: async () => {
      if (options.tracingEnabled) {
        const tracePath = join(process.cwd(), 'artifacts', `trace-${Date.now()}.zip`);
        await context.tracing.stop({ path: tracePath });
      }
      await context.close();
      await browser.close();
    },
  };
}

const TRACKING_DOMAIN_PATTERNS = [
  'google-analytics',
  'googletagmanager',
  'sentry',
  'usercentrics',
];

function configureNetworkBlocking(context: BrowserContext, shouldBlock: boolean): () => void {
  if (!shouldBlock) {
    return () => undefined;
  }

  let blockingEnabled = false;

  void context.route('**/*', async (route) => {
    if (!blockingEnabled) {
      await route.continue();
      return;
    }

    const requestUrl = route.request().url();
    if (TRACKING_DOMAIN_PATTERNS.some((pattern) => requestUrl.includes(pattern))) {
      await route.abort();
      return;
    }

    await route.continue();
  });

  return () => {
    blockingEnabled = true;
  };
}
