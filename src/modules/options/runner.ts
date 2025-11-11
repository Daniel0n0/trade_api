import process from 'node:process';
import type { Page } from 'playwright';

import {
  launchPersistentBrowser,
  type BrowserResources,
  type PersistentLaunchOverrides,
} from '../../browser.js';
import type { ModuleArgs } from '../../orchestrator/messages.js';
import {
  runSocketSniffer,
  type SocketSnifferHandle,
} from '../../modulos/socket-sniffer.js';
import { safeGoto } from '../../utils/navigation.js';
import { installOptionsResponseRecorder, type OptionsRecorderHandle } from './interceptor.js';
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

const MODULE_NAME: RunnerModule = 'options';

export const DEFAULT_OPTIONS_URL = 'https://robinhood.com/options/chains';
export const DEFAULT_OPTIONS_SYMBOLS: readonly string[] = [];

export const OPTIONS_URL_BY_MODULE: Record<string, string> = {
  'spy-options-chain': 'https://robinhood.com/options/chains/SPY',
  'spx-options-chain': 'https://robinhood.com/options/chains/SPX',
};

export const OPTIONS_SYMBOLS_BY_MODULE: Record<string, readonly string[]> = {
  'spy-options-chain': ['SPY'],
  'spx-options-chain': ['SPX'],
};

export const resolveOptionsSymbols = (
  args: ModuleArgs,
  payload?: RunnerStartPayload,
): readonly string[] => {
  if (payload?.symbols && payload.symbols.length > 0) {
    return payload.symbols;
  }

  if (args.symbols && args.symbols.length > 0) {
    return args.symbols;
  }

  const mapped = OPTIONS_SYMBOLS_BY_MODULE[args.module];
  if (mapped) {
    return mapped;
  }

  return DEFAULT_OPTIONS_SYMBOLS;
};

export const resolveOptionsUrl = (
  args: ModuleArgs,
  payload: RunnerStartPayload | undefined,
  symbols: readonly string[],
): string => {
  if (payload?.url) {
    return payload.url;
  }

  const mode = args.urlMode ?? 'auto';
  const primarySymbol = symbols[0];
  const mapped = OPTIONS_URL_BY_MODULE[args.module];

  if (mode === 'module') {
    return mapped ?? DEFAULT_OPTIONS_URL;
  }

  if (mode === 'symbol') {
    if (primarySymbol) {
      return `https://robinhood.com/options/chains/${primarySymbol}`;
    }
    return DEFAULT_OPTIONS_URL;
  }

  if (mapped) {
    return mapped;
  }

  if (primarySymbol) {
    return `https://robinhood.com/options/chains/${primarySymbol}`;
  }

  return DEFAULT_OPTIONS_URL;
};

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
}

export async function runOptionsRunner(initialArgs: ModuleArgs): Promise<void> {
  let status: RunnerStatus = 'idle';
  let browser: BrowserResources | null = null;
  let page: Page | null = null;
  let sniffer: SocketSnifferHandle | null = null;
  let optionsRecorder: OptionsRecorderHandle | null = null;
  let shuttingDown = false;
  let exitResolver: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let currentInfo: RunnerInfo = {
    module: initialArgs.module,
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
      console.warn('[options-runner] Error al cerrar el sniffer:', error);
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
      console.warn('[options-runner] Error al cerrar el navegador:', error);
    }

    browser = null;
  };

  const resolveLaunchOverrides = (args: ModuleArgs): PersistentLaunchOverrides => {
    return {
      mode: 'reuse',
      ...(typeof args.headless === 'boolean' ? { headless: args.headless } : {}),
      ...(args.storageStatePath ? { storageStatePath: args.storageStatePath } : {}),
    };
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
      const symbols = resolveOptionsSymbols(messageArgs, payload);
      const url = resolveOptionsUrl(messageArgs, payload, symbols);
      const logPrefix = payload?.logPrefix ?? messageArgs.outPrefix ?? messageArgs.module;
      const startAt = payload?.start ?? messageArgs.start;
      const endAt = payload?.end ?? messageArgs.end;

      sendStatus('launching-browser', { startedAt, url, symbols, logPrefix });

      try {
        browser = await launchPersistentBrowser(resolveLaunchOverrides(messageArgs));
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

      try {
        optionsRecorder = installOptionsResponseRecorder({
          page: localPage,
          logPrefix,
          symbols,
          optionsDate: messageArgs.optionsDate,
          horizonDays: messageArgs.optionsHorizon,
          urlMode: messageArgs.urlMode,
          onPrimaryExpirationChange: (expiration) => {
            sendStatus(status, { optionsPrimaryExpiration: expiration });
          },
          updateInfo: (info) => {
            updateInfo(info);
          },
        });
      } catch (error) {
        const err = toError(error);
        console.warn('[options-runner] No se pudo instalar el interceptor de opciones:', err);
      }

      sendStatus('navigating');

      try {
        await safeGoto(page, url);
        await page
          .waitForLoadState('networkidle', { timeout: 15_000 })
          .catch(() => page?.waitForTimeout(2_000));
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
          start: startAt,
          end: endAt,
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
      console.warn('[options-runner] Error durante flush:', error);
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

    try {
      await optionsRecorder?.close();
    } catch (error) {
      console.warn('[options-runner] Error al cerrar el interceptor de opciones:', error);
    }
    optionsRecorder = null;

    if (page) {
      try {
        await page.close({ runBeforeUnload: true });
      } catch (closeError) {
        console.warn('[options-runner] Error al cerrar la página:', closeError);
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
      console.error('[options-runner] Mensaje inválido desde el padre:', error);
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
    console.error('[options-runner] Excepción no controlada:', err);
    void shutdown('error', err);
  };

  const handleUnhandledRejection = (reason: unknown) => {
    const err = toError(reason);
    console.error('[options-runner] Rechazo no controlado:', err);
    void shutdown('error', err);
  };

  process.on('uncaughtException', handleUncaughtException);
  process.on('unhandledRejection', handleUnhandledRejection);

  await exitPromise;

  process.off('message', onMessage);
  process.off('uncaughtException', handleUncaughtException);
  process.off('unhandledRejection', handleUnhandledRejection);
}
