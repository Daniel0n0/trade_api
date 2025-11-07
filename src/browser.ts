import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { safeJsonParse, toText } from './utils/payload.js';

// Añade tipos oficiales si quieres máxima precisión
type WebSocketFrameEvent = {
  readonly request?: { readonly url?: string };
  readonly response?: { readonly payloadData?: unknown };
};

type WebSocketCreatedEvent = {
  readonly url?: string;
};

type SnifferLogEntry = {
  readonly kind: 'ws-message';
  readonly url: string;
  readonly text: string;
  readonly parsed?: unknown;
};

import { defaultLaunchOptions, type LaunchOptions } from './config.js';

const HEADLESS = process.env.HEADLESS === '1';
const DEBUG_NETWORK = process.env.DEBUG_NETWORK === '1';
const CHANNEL = process.platform === 'darwin' ? 'chrome' : undefined;
const BROWSER_ARGS = ['--disable-blink-features=AutomationControlled'];

export interface BrowserResources {
  readonly context: BrowserContext;
  readonly close: () => Promise<void>;
  readonly enableNetworkBlocking: () => void;
}

export type LaunchMode = 'bootstrap' | 'reuse' | 'persistent';

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

  if (mode === 'persistent') {
    return launchPersistentContext(options);
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

  // Primera vez (interactiva):
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: options.slowMo,
    channel: CHANNEL,
    args: BROWSER_ARGS,
  });
  const context = await browser.newContext({ storageState: undefined });
  setupRequestFailedLogging(context);
  const page = await context.newPage();

  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');

    cdp.on('Network.webSocketCreated', (e: WebSocketCreatedEvent) => {
      console.log('[socket-sniffer][CDP] WS creado:', e.url);
    });

    cdp.on('Network.webSocketFrameReceived', async (e: WebSocketFrameEvent) => {
      try {
        const url = e.request?.url || '';
        const { text, parsed } = parseFramePayload(e.response?.payloadData);
        if (!page.isClosed()) {
          try {
            await page.evaluate(
              (entry: SnifferLogEntry) => {
                const target = window as typeof window & {
                  socketSnifferLog?: (value: { kind: 'ws-message'; url: string; text: string; parsed?: unknown }) => void;
                };
                target.socketSnifferLog?.(entry);
              },
              // 👇 fuerza el literal
              { kind: 'ws-message' as const, url, text, parsed },
            );
          } catch (error) {
            console.warn('[socket-sniffer][CDP] page.evaluate fallo:', error);
          }
        }
      } catch (err) {
        console.error('[socket-sniffer][CDP] rx error:', err);
      }
    });

    cdp.on('Network.webSocketFrameSent', async (e: WebSocketFrameEvent) => {
      try {
        const url = e.request?.url || '';
        const { text, parsed } = parseFramePayload(e.response?.payloadData);
        if (!page.isClosed()) {
          try {
            await page.evaluate(
              (entry) => {
                const target = window as typeof window & {
                  socketSnifferLog?: (value: { kind: 'ws-message'; url: string; text: string; parsed?: unknown }) => void;
                };
                target.socketSnifferLog?.(entry);
              },
              { kind: 'ws-message' as const, url, text, parsed },
            );
          } catch (error) {
            console.warn('[socket-sniffer][CDP] page.evaluate fallo:', error);
          }
        }
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

  if (options.blockTrackingDomains) {
    enableNetworkBlocking();
  }

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
    headless: HEADLESS,
    slowMo: options.slowMo,
    channel: CHANNEL,
    args: BROWSER_ARGS,
  });

  const context = await browser.newContext({
    storageState: storageStatePath,
  });
  setupRequestFailedLogging(context);

  const enableNetworkBlocking = configureNetworkBlocking(context, options.blockTrackingDomains);

  if (options.blockTrackingDomains) {
    enableNetworkBlocking();
  }

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

async function launchPersistentContext(options: LaunchOptions): Promise<BrowserResources> {
  ensureProfileDirectory(options.userDataDir);

  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: HEADLESS,
    slowMo: options.slowMo,
    viewport: null,
    channel: CHANNEL,
    args: BROWSER_ARGS,
  });

  setupRequestFailedLogging(context);

  const enableNetworkBlocking = configureNetworkBlocking(context, options.blockTrackingDomains);

  if (options.blockTrackingDomains) {
    enableNetworkBlocking();
  }

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

const TRACKING_DOMAIN_PATTERNS = [
  'google-analytics',
  'googletagmanager',
  'sentry',
  'usercentrics',
  'usercentrics.eu',
  'crumbs.robinhood',
  'nummus.robinhood',
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
    // eslint-disable-next-line no-console
    console.log('[network-blocking] ACTIVADO (usercentrics/gtm/ga/sentry)');
  };
}

function parseFramePayload(payload: unknown): { text: string; parsed?: unknown } {
  const text = toText(payload);
  const trimmed = text.trimStart();
  if (!trimmed) {
    return { text };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = safeJsonParse(trimmed);
    return parsed === undefined ? { text } : { text, parsed };
  }

  return { text };
}

function setupRequestFailedLogging(context: BrowserContext): void {
  context.on('requestfailed', (req) => {
    const url = req.url();
    if (!DEBUG_NETWORK && TRACKING_DOMAIN_PATTERNS.some((pattern) => url.includes(pattern))) {
      return;
    }
    const failure = req.failure()?.errorText ?? 'unknown';
    // eslint-disable-next-line no-console
    console.warn('[net] fail:', failure, url);
  });
}
