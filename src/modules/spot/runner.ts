import process from 'node:process';
import type { Page } from 'playwright';

import { launchPersistentBrowser, type BrowserResources } from '../../browser.js';
import type { ModuleArgs } from '../../orchestrator/messages.js';
import {
  runSocketSniffer,
  type SocketSnifferHandle,
} from '../../modulos/socket-sniffer.js';
import { ROBINHOOD_HOME_URL } from '../../config.js';
import {
  assertParentMessage,
  sendToParent,
  type EndReason,
  type ParentMessage,
  type RunnerInfo,
  type RunnerModule,
  type RunnerStartPayload,
  type RunnerStatus,
} from '../messages.js';

const MODULE_NAME: RunnerModule = 'spot';
const DEFAULT_URL = ROBINHOOD_HOME_URL;
const DEFAULT_SYMBOLS: readonly string[] = [];

const URL_BY_MODULE: Record<string, string> = {
  'spy-5m-1m':
    'https://robinhood.com/legend/layout/9a624e15-84c5-4a0e-8391-69f32b32d8d5?default_web_client=WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT',
};

const SYMBOLS_BY_MODULE: Record<string, readonly string[]> = {
  'spy-5m-1m': ['SPY'],
};

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}

export async function runSpotRunner(initialArgs: ModuleArgs): Promise<void> {
  let status: RunnerStatus = 'idle';
  let browser: BrowserResources | null = null;
  let page: Page | null = null;
  let sniffer: SocketSnifferHandle | null = null;
  let shuttingDown = false;
  let exitResolver: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let currentInfo: RunnerInfo = {
    moduleName: initialArgs.moduleName,
    action: initialArgs.action,
    pid: process.pid,
  };

  const exitPromise = new Promise<void>((resolve) => {
    exitResolver = resolve;
  });

  const updateInfo = (info?: RunnerInfo): RunnerInfo => {
    if (!info) {
      return { ...currentInfo };
    }

    currentInfo = { ...currentInfo, ...info };
    return { ...currentInfo };
  };

  const sendStatus = (nextStatus: RunnerStatus, info?: RunnerInfo, requestId?: string) => {
    status = nextStatus;
    sendToParent({
      type: 'status',
      module: MODULE_NAME,
      status,
      info: updateInfo(info),
      requestId,
    });
  };

  const sendReady = (info?: RunnerInfo) => {
    sendToParent({
      type: 'ready',
      module: MODULE_NAME,
      status,
      info: updateInfo(info),
    });
  };

  const sendEnded = (reason: EndReason, info?: RunnerInfo, error?: Error) => {
    const payload: ReturnType<typeof updateInfo> = updateInfo(info);
    sendToParent({
      type: 'ended',
      module: MODULE_NAME,
      status,
      reason,
      info: payload,
      error: error?.message,
      stack: error?.stack,
    });
  };

  const closeSniffer = () => {
    if (!sniffer) {
      return;
    }

    try {
      sniffer.close();
    } catch (error) {
      console.warn('[spot-runner] Error al cerrar el sniffer:', error);
    }

    sniffer = null;
  };

  const closeBrowser = async () => {
    if (!browser) {
      return;
    }

    try {
      await browser.close();
    } catch (error) {
      console.warn('[spot-runner] Error al cerrar el navegador:', error);
    }

    browser = null;
  };

  const resolveUrl = (args: ModuleArgs, payload?: RunnerStartPayload): string => {
    if (payload?.url) {
      return payload.url;
    }

    const mapped = URL_BY_MODULE[args.moduleName];
    if (mapped) {
      return mapped;
    }

    return DEFAULT_URL;
  };

  const resolveSymbols = (args: ModuleArgs, payload?: RunnerStartPayload): readonly string[] => {
    if (payload?.symbols && payload.symbols.length > 0) {
      return payload.symbols;
    }

    const mapped = SYMBOLS_BY_MODULE[args.moduleName];
    if (mapped) {
      return mapped;
    }

    return DEFAULT_SYMBOLS;
  };

  const start = async (messageArgs: ModuleArgs, payload?: RunnerStartPayload) => {
    if (startPromise) {
      await startPromise;
      return;
    }

    if (browser || sniffer) {
      sendStatus(status, { note: 'start-ignored' });
      return;
    }

    const startedAt = new Date().toISOString();

    const launch = async () => {
      const url = resolveUrl(messageArgs, payload);
      const symbols = resolveSymbols(messageArgs, payload);
      const logPrefix = payload?.logPrefix ?? messageArgs.moduleName;
      const startAt = payload?.startAt ?? messageArgs.startAt;
      const endAt = payload?.endAt ?? messageArgs.endAt;

      sendStatus('launching-browser', { startedAt, url, symbols, logPrefix });

      try {
        browser = await launchPersistentBrowser({ mode: 'reuse' });
      } catch (error) {
        const err = toError(error);
        sendStatus('error', { phase: 'launch' });
        await shutdown('error', err);
        return;
      }

      let localPage: Page;

      try {
        localPage = await browser.context.newPage();
      } catch (error) {
        const err = toError(error);
        sendStatus('error', { phase: 'context' });
        await shutdown('error', err);
        return;
      }

      page = localPage;

      sendStatus('navigating');

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => page?.waitForTimeout(2_000));
      } catch (error) {
        const err = toError(error);
        sendStatus('error', { phase: 'navigation', url });
        await shutdown('error', err);
        return;
      }

      try {
        sniffer = await runSocketSniffer(page, {
          symbols,
          logPrefix,
          startAt,
          endAt,
        });
      } catch (error) {
        const err = toError(error);
        sendStatus('error', { phase: 'sniffer' });
        await shutdown('error', err);
        return;
      }

      sendStatus('sniffing', { logPattern: sniffer.logPattern });
      sendReady();
    };

    startPromise = launch().finally(() => {
      startPromise = null;
    });

    await startPromise;
  };

  const flush = async () => {
    if (!page) {
      sendStatus(status);
      return;
    }

    sendStatus('flushing');

    try {
      await page.waitForTimeout(50);
    } catch (error) {
      console.warn('[spot-runner] Error durante flush:', error);
    }

    sendStatus(sniffer ? 'sniffing' : 'idle');
  };

  const shutdown = async (reason: EndReason, error?: Error) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    sendStatus('stopping', { finishedAt: new Date().toISOString(), reason });

    closeSniffer();

    if (page) {
      try {
        await page.close({ runBeforeUnload: true });
      } catch (closeError) {
        console.warn('[spot-runner] Error al cerrar la página:', closeError);
      }

      page = null;
    }

    await closeBrowser();

    const finalStatus: RunnerStatus = reason === 'error' ? 'error' : 'stopped';
    sendStatus(finalStatus);
    sendEnded(reason, undefined, error);

    if (exitResolver) {
      exitResolver();
      exitResolver = null;
    }

    if (reason === 'error') {
      process.exitCode = 1;
    }
  };

  const handleMessage = async (message: ParentMessage) => {
    switch (message.type) {
      case 'start':
        await start(message.args, message.payload);
        break;
      case 'flush':
        await flush();
        break;
      case 'graceful-exit':
        await shutdown('graceful-exit');
        break;
      case 'status-request':
        sendStatus(status, undefined, message.requestId);
        break;
      default:
        break;
    }
  };

  const onMessage = (raw: unknown) => {
    try {
      assertParentMessage(raw);
    } catch (error) {
      console.error('[spot-runner] Mensaje inválido desde el padre:', error);
      return;
    }

    void handleMessage(raw);
  };

  process.on('message', onMessage);

  process.once('SIGINT', () => {
    void shutdown('shutdown');
  });
  process.once('SIGTERM', () => {
    void shutdown('shutdown');
  });
  process.once('disconnect', () => {
    void shutdown('shutdown');
  });

  const handleUncaughtException = (error: unknown) => {
    const err = toError(error);
    console.error('[spot-runner] Excepción no controlada:', err);
    void shutdown('error', err);
  };

  const handleUnhandledRejection = (reason: unknown) => {
    const err = toError(reason);
    console.error('[spot-runner] Rechazo no controlado:', err);
    void shutdown('error', err);
  };

  process.on('uncaughtException', handleUncaughtException);
  process.on('unhandledRejection', handleUnhandledRejection);

  await exitPromise;

  process.off('message', onMessage);
  process.off('uncaughtException', handleUncaughtException);
  process.off('unhandledRejection', handleUnhandledRejection);
}
