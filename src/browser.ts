import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';
import { ENV } from './utils/env.js';
import { normaliseFramePayload } from './utils/payload.js';

// Añade tipos oficiales si quieres máxima precisión
type WSFramePayload = { readonly payloadData?: unknown };

type WebSocketFrameEvent = {
  readonly requestId?: string;
  readonly request?: { readonly url?: string };
  readonly response?: WSFramePayload;
};

type WebSocketCreatedEvent = {
  readonly requestId?: string;
  readonly url?: string;
};

type WebSocketHandshakeEvent = {
  readonly requestId?: string;
  readonly request?: { readonly url?: string };
};

type SnifferLogEntry = {
  readonly kind: 'ws-message';
  readonly url: string;
  readonly text: string;
  readonly parsed?: unknown;
};

import { defaultLaunchOptions, type LaunchOptions } from './config.js';

const { HEADLESS, DEBUG_NETWORK } = ENV;
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
  const { mode = 'bootstrap', storageStatePath = defaultStorageStatePath(), ...rest } = overrides;
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

function ensureDirectoryForFile(filePath: string): void {
  const directory = dirname(filePath);
  if (directory && directory !== '.') {
    ensureProfileDirectory(directory);
  }
}

function defaultStorageStatePath(): string {
  return join(process.cwd(), 'state', 'robinhood.json');
}

function defaultTracePath(): string {
  return join(process.cwd(), 'artifacts', `trace-${Date.now()}.zip`);
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

  if (HEADLESS) {
    console.warn('[login] HEADLESS=1 puede requerir verificación manual adicional.');
  }

  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');

    const socketUrlByRequestId = new Map<string, string>();

    const resolveUrl = (event: WebSocketFrameEvent): string => {
      const directUrl = event.request?.url;
      if (directUrl) {
        return directUrl;
      }
      if (event.requestId) {
        const mapped = socketUrlByRequestId.get(event.requestId);
        if (mapped) {
          return mapped;
        }
      }
      return 'unknown-websocket';
    };

    cdp.on('Network.webSocketCreated', (e: WebSocketCreatedEvent) => {
      if (e.requestId && e.url) {
        socketUrlByRequestId.set(e.requestId, e.url);
      }
      console.log('[socket-sniffer][CDP] WS creado:', e.url);
    });

    cdp.on('Network.webSocketWillSendHandshakeRequest', (e: WebSocketHandshakeEvent) => {
      if (e.requestId && e.request?.url) {
        socketUrlByRequestId.set(e.requestId, e.request.url);
      }
    });

    cdp.on('Network.webSocketFrameReceived', async (e: WebSocketFrameEvent) => {
      try {
        const url = resolveUrl(e);
        const { text, parsed } = normaliseFramePayload(e.response?.payloadData);
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
        const url = resolveUrl(e);
        const { text, parsed } = normaliseFramePayload(e.response?.payloadData);
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
  const storageStatePath = defaultStorageStatePath();
  ensureDirectoryForFile(storageStatePath);
  await context.storageState({ path: storageStatePath });

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
        const tracePath = defaultTracePath();
        ensureDirectoryForFile(tracePath);
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
        const tracePath = defaultTracePath();
        ensureDirectoryForFile(tracePath);
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
        const tracePath = defaultTracePath();
        ensureDirectoryForFile(tracePath);
        await context.tracing.stop({ path: tracePath });
      }
      await context.close();
      if (!options.preserveUserDataDir) {
        await cleanupProfile(options.userDataDir);
      }
    },
  };
}

const TRACKING_HOST_PATTERNS = [
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)sentry\.io$/i,
  /(^|\.)usercentrics\.eu$/i,
  /(^|\.)crumbs\.robinhood\.com$/i,
  /(^|\.)nummus\.robinhood\.com$/i,
];

const NOISY_REQUEST_PREFIXES = [
  'https://www.google.com/ccm/collect',
  'https://www.googletagmanager.com/',
];

function matchesTrackingHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return TRACKING_HOST_PATTERNS.some((pattern) => pattern.test(url));
  }
}

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
    if (matchesTrackingHost(requestUrl)) {
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

function setupRequestFailedLogging(context: BrowserContext): void {
  context.on('requestfailed', (req) => {
    const url = req.url();
    if (
      !DEBUG_NETWORK &&
      (matchesTrackingHost(url) || NOISY_REQUEST_PREFIXES.some((prefix) => url.startsWith(prefix)))
    ) {
      return;
    }
    const failure = req.failure()?.errorText ?? 'unknown';
    const method = req.method();
    // eslint-disable-next-line no-console
    console.warn('[net] fail:', method, failure, url);
  });
}
