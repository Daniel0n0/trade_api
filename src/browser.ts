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

  // const context = await chromium.launchPersistentContext(options.userDataDir, {
  //   headless: false,
  //   slowMo: options.slowMo,
  //   viewport: null,
  //   channel: process.platform === 'darwin' ? 'chrome' : undefined,
  //   args: ['--disable-blink-features=AutomationControlled'],
  // });

  // Primera vez (interactiva):
  const browser = await chromium.launch({
    headless: false,
    slowMo: options.slowMo,
    channel: process.platform === 'darwin' ? 'chrome' : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');

    cdp.on('Network.webSocketCreated', (e: any) => {
      console.log('[socket-sniffer][CDP] WS creado:', e.url);
    });

    cdp.on('Network.webSocketFrameReceived', (e: any) => {
      try {
        const url = e.request?.url || '';
        const text = e.response?.payloadData ?? '';
        let parsed: unknown;
        if (typeof text === 'string' && text.startsWith('{')) {
          parsed = JSON.parse(text);
        }
        (page as any).socketSnifferLog?.({ kind: 'ws-message', url, text, parsed });
      } catch (err) {
        console.error('[socket-sniffer][CDP] rx error:', err);
      }
    });

    cdp.on('Network.webSocketFrameSent', (e: any) => {
      try {
        const url = e.request?.url || '';
        const text = e.response?.payloadData ?? '';
        let parsed: unknown;
        if (typeof text === 'string' && text.startsWith('{')) {
          parsed = JSON.parse(text);
        }
        (page as any).socketSnifferLog?.({ kind: 'ws-send', url, text, parsed });
      } catch (err) {
        console.error('[socket-sniffer][CDP] tx error:', err);
      }
    });
  } catch (err) {
    console.warn('[socket-sniffer] CDP no disponible:', err);
  }


  await page.goto('https://robinhood.com/login', { waitUntil: 'domcontentloaded' });
  // -> loguéate manualmente
  await page.waitForURL(/robinhood\.com\/(home|account|legend)/, { timeout: 120_000 });
  await context.storageState({ path: 'state/robinhood.json' });

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
    storageState: 'state/robinhood.json',
  });
  const page = await context.newPage();

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
