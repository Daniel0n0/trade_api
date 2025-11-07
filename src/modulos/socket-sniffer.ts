import path from 'node:path';
import type { Page, WebSocket as PlaywrightWebSocket } from 'playwright';

import { RotatingWriter, type RotatePolicy } from './rotating-writer.js';
import { BarAggregator } from './timebar.js';
import {
  buildBarCsvRow,
  buildCandleCsvRow,
  buildQuoteAggregationRow,
  buildQuoteCsvRow,
  buildTradeAggregationRow,
  CSV_HEADERS,
  CSV_HEADER_TEXT,
  isValidCandle,
  normalizeDxFeedRow,
  resolveCandleTimeframe,
  toCsvLine,
} from '../io/row.js';
import { dataPath } from '../io/paths.js';
import { BaseEvent } from '../io/schemas.js';

// cerca de arriba (imports), no hace falta importar Buffer explícitamente
const toText = (p: unknown): string => {
  if (typeof p === 'string') return p;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Buffer existe en runtime Node y en types al tener node:fs
  if (typeof Buffer !== 'undefined' && p && Buffer.isBuffer?.(p)) return (p as Buffer).toString('utf8');
  // último recurso: intenta convertir a string
  return p == null ? '' : String(p);
};

type Serializable = Record<string, unknown>;

const DEFAULT_PREFIX = 'socket';
const MAX_ENTRY_TEXT_LENGTH = 200_000;
const HOOK_GUARD_FLAG = '__socketSnifferHooked__';

const ROTATE_POLICY: RotatePolicy = {
  maxBytes: 50_000_000,
  maxMinutes: 60,
  gzipOnRotate: true,
};

type SocketSnifferOptions = {
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
};

// type PlaywrightWebSocketFrame = {
//   readonly payload: string;
// };

type SnifferBindingEntry = {
  readonly kind: string;
  readonly url: string;
  readonly text: string;
  readonly parsed?: unknown;
};

type PageWithSnifferBinding = Page & {
  socketSnifferLog?: (entry: SnifferBindingEntry) => void;
};

type LogEntry = Serializable & {
  readonly ts: number;
};

function normaliseSymbols(input: readonly string[]): readonly string[] {
  return input.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
}

function extractFeed(parsed: unknown): { channel: number; data: unknown[] } | null {
  if (!parsed) {
    return null;
  }

  const payload = (parsed as { payload?: unknown })?.payload ?? parsed;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const channelRaw =
    payloadRecord.channel ?? payloadRecord.ch ?? payloadRecord.c ??
    (payloadRecord.payload && (payloadRecord.payload as Record<string, unknown>).channel);
  const dataRaw =
    payloadRecord.data ?? payloadRecord.d ??
    (payloadRecord.payload && (payloadRecord.payload as Record<string, unknown>).data);

  const channel = Number(channelRaw);
  if (!Number.isFinite(channel)) {
    return null;
  }

  const data = Array.isArray(dataRaw) ? dataRaw : null;
  if (!data) {
    return null;
  }

  return { channel, data };
}

async function exposeLogger(page: Page, logPath: string, perChannelPrefix: string): Promise<void> {
  const baseDir = path.dirname(logPath);
  const baseName = path.basename(logPath, '.jsonl');

  const generalWriter = new RotatingWriter(path.join(baseDir, `${baseName}.jsonl`), ROTATE_POLICY);
  const VERBOSE = false; // Cambiado a false para reducir ruido por defecto

  const channelWriters = new Map<string, RotatingWriter>();
  let closed = false;
  let removeProcessListeners: (() => void) | null = null;
  const getChannelWriter = (channel: number, label: string) => {
    const key = `ch${channel}-${label}`;
    let writer = channelWriters.get(key);
    if (!writer) {
      writer = new RotatingWriter(path.join(baseDir, `${perChannelPrefix}-${key}.jsonl`), ROTATE_POLICY);
      channelWriters.set(key, writer);
    }
    return writer;
  };

  const createCsvWriter = (suffix: string, headerKey: keyof typeof CSV_HEADER_TEXT) =>
    new RotatingWriter(
      path.join(baseDir, `${perChannelPrefix}-${suffix}.csv`),
      ROTATE_POLICY,
      CSV_HEADER_TEXT[headerKey],
    );

  const candleCsvByTimeframe = new Map<string, RotatingWriter>();
  const getCandleCsv = (timeframe: string) => {
    const key = timeframe || 'general';
    let writer = candleCsvByTimeframe.get(key);
    if (!writer) {
      const suffix = key === 'general' ? 'candle' : `candle-${key}`;
      writer = createCsvWriter(suffix, 'candle');
      candleCsvByTimeframe.set(key, writer);
    }
    return writer;
  };

  const quoteCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-quote.csv`),
    ROTATE_POLICY,
    CSV_HEADER_TEXT.quote,
  );

  const agg1m = new BarAggregator(1);
  const agg5m = new BarAggregator(5);
  const agg15m = new BarAggregator(15);

  const bars1mCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-bars-1m.csv`),
    ROTATE_POLICY,
    CSV_HEADER_TEXT.bars,
  );
  const bars5mCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-bars-5m.csv`),
    ROTATE_POLICY,
    CSV_HEADER_TEXT.bars,
  );
  const bars15mCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-bars-15m.csv`),
    ROTATE_POLICY,
    CSV_HEADER_TEXT.bars,
  );

  const writeGeneral = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    generalWriter.write(JSON.stringify(payload));
  };

  writeGeneral({ kind: 'boot', msg: 'socket-sniffer up' });

  const flushBars = (now: number) => {
    const closed1 = agg1m.drainClosed(now);
    for (const bar of closed1) {
      bars1mCsv.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
    }
    const closed5 = agg5m.drainClosed(now);
    for (const bar of closed5) {
      bars5mCsv.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
    }
    const closed15 = agg15m.drainClosed(now);
    for (const bar of closed15) {
      bars15mCsv.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
    }
  };

  const writeChannelRows = (channel: number, rows: readonly unknown[]) => {
    if (!rows?.length) {
      return;
    }

    const label =
      channel === 1
        ? 'candle'
        : channel === 3
        ? 'trade'
        : channel === 5
        ? 'tradeeth'
        : channel === 7
        ? 'quote'
        : 'raw';
    const writer = getChannelWriter(channel, label);

    let lastNow = Date.now();
    for (const row of rows) {
      const currentNow = Date.now();
      lastNow = currentNow;
      const parsed = BaseEvent.safeParse(row ?? {});
      const event = parsed.success ? parsed.data : BaseEvent.parse({});
      const resolvedType =
        event.eventType ??
        (channel === 1
          ? 'Candle'
          : channel === 3
          ? 'Trade'
          : channel === 5
          ? 'TradeETH'
          : channel === 7
          ? 'Quote'
          : undefined);

      if (resolvedType === 'Candle' && !isValidCandle(event)) {
        continue;
      }

      const normalized = normalizeDxFeedRow(channel, event);
      if (!parsed.success) {
        (normalized as Record<string, unknown>).raw = row;
      }
      writer.write(JSON.stringify(normalized));

      if (resolvedType === 'Candle') {
        const candleRow = buildCandleCsvRow(event);
        if (candleRow) {
          const timeframe = resolveCandleTimeframe(event.eventSymbol);
          getCandleCsv(timeframe).write(toCsvLine(CSV_HEADERS.candle, candleRow));
        }
      }

      if (resolvedType === 'Quote') {
        const quoteRow = buildQuoteCsvRow(event);
        if (quoteRow) {
          quoteCsv.write(toCsvLine(CSV_HEADERS.quote, quoteRow));
        }
        const quoteAgg = buildQuoteAggregationRow(event);
        if (quoteAgg) {
          agg1m.addQuote(quoteAgg);
          agg5m.addQuote(quoteAgg);
          agg15m.addQuote(quoteAgg);
        }
      } else if (resolvedType === 'Trade' || resolvedType === 'TradeETH') {
        const trade = buildTradeAggregationRow(event);
        if (trade) {
          agg1m.addTrade(trade);
          agg5m.addTrade(trade);
          agg15m.addTrade(trade);
        }
      }
    }

    flushBars(lastNow);
  };

  await page.exposeFunction('socketSnifferLog', (entry: Serializable) => {
    try {
      if (VERBOSE) {
        /* eslint-disable no-console */
        console.log('[socket-sniffer] entry:', JSON.stringify(entry));
        /* eslint-enable no-console */
      }

      writeGeneral(entry);

      const parsed = (entry as { parsed?: unknown } | undefined)?.parsed;
      if (entry?.['kind'] === 'ws-message') {
        const feed = extractFeed(parsed);
        if (feed && feed.data.length) {
          writeChannelRows(feed.channel, feed.data);
        }
      }
    } catch (error) {
      /* eslint-disable no-console */
      console.error('[socket-sniffer] Error al escribir:', error);
      /* eslint-enable no-console */
    }
  });

  const closeAll = () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      const now = Date.now();
      const remaining1 = agg1m.drainAll();
      for (const bar of remaining1) {
        bars1mCsv.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
      }
      const remaining5 = agg5m.drainAll();
      for (const bar of remaining5) {
        bars5mCsv.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
      }
      const remaining15 = agg15m.drainAll();
      for (const bar of remaining15) {
        bars15mCsv.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
      }
      flushBars(now);
    } catch (error) {
      void error;
    }

    generalWriter.close();
    for (const writer of candleCsvByTimeframe.values()) {
      writer.close();
    }
    quoteCsv.close();
    bars1mCsv.close();
    bars5mCsv.close();
    bars15mCsv.close();
    for (const writer of channelWriters.values()) {
      writer.close();
    }

    if (removeProcessListeners) {
      removeProcessListeners();
      removeProcessListeners = null;
    }
  };

  page.once('close', () => {
    closeAll();
    /* eslint-disable no-console */
    console.log('[socket-sniffer] Página cerrada. Archivos rotados y comprimidos si aplica.');
    /* eslint-enable no-console */
  });

  const onExit = () => {
    closeAll();
    removeProcessListeners?.();
    removeProcessListeners = null;
  };
  const onSigInt = () => {
    closeAll();
    removeProcessListeners?.();
    removeProcessListeners = null;
    process.exit(0);
  };
  const onSigTerm = () => {
    closeAll();
    removeProcessListeners?.();
    removeProcessListeners = null;
    process.exit(0);
  };

  process.on('exit', onExit);
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);
  removeProcessListeners = () => {
    process.off('exit', onExit);
    process.off('SIGINT', onSigInt);
    process.off('SIGTERM', onSigTerm);
  };
}

function buildHookScript() {
  return (
    (params: { wantedSymbols: readonly string[]; maxTextLength: number; hookGuardFlag: string }) => {
      const { wantedSymbols, maxTextLength, hookGuardFlag } = params;
      const globalObject = window as typeof window & {
        socketSnifferLog?: (entry: Serializable) => void;
        [key: string]: unknown;
      };

      const guardKey = hookGuardFlag || '__socketSnifferHooked__';
      if (globalObject[guardKey]) {
        return;
      }

      globalObject[guardKey] = true;

      try {
        globalObject.__socketHookInstalled = true;
        console.log('[socket-sniffer][HOOK] instalado en', location.href);
        globalObject.socketSnifferLog?.({ kind: 'hook-installed', href: location.href });
      } catch (error) {
        void error;
      }

      try {
        globalObject.socketSnifferLog?.({ kind: 'hook-installed', href: window.location.href });
      } catch (error) {
        void error;
      }

      const upperSymbols = new Set(
        (wantedSymbols ?? [])
          .map((symbol) => (typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''))
          .filter((symbol) => symbol.length > 0),
      );

      const shouldKeep = (payload: unknown): boolean => {
        if (!upperSymbols.size) {
          return true;
        }

        const extractSymbol = (value: unknown): string | undefined => {
          if (!value || typeof value !== 'object') {
            return undefined;
          }
          const data = value as Record<string, unknown>;
          const candidates = [
            data?.data && (data.data as Record<string, unknown>).eventSymbol,
            data?.eventSymbol,
            data?.symbol,
            data?.result && (data.result as Record<string, unknown>).symbol,
          ];
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
              return candidate.trim().toUpperCase();
            }
          }
          return undefined;
        };

        const symbol = extractSymbol(payload);
        return !symbol || upperSymbols.has(symbol);
      };

      const safeLog = (entry: Serializable) => {
        try {
          globalObject.socketSnifferLog?.(entry);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('[socket-sniffer] Error al enviar log:', error);
        }
      };

      const truncate = (text: string | null): string | null => {
        if (typeof text !== 'string') {
          return null;
        }
        return text.length > maxTextLength ? text.slice(0, maxTextLength) : text;
      };

      // --- WebSocket hook ---
      (() => {
        const OriginalWebSocket = window.WebSocket;
        const originalSend = OriginalWebSocket.prototype.send;

        const shouldKeepByUrl = (socketUrl: string): boolean =>
          /^wss:\/\/.*robinhood\.com/i.test(socketUrl);

        const wrapMessage = (url: string, text: string | null, parsed: unknown, kind: 'ws-message' | 'ws-send') => {
          const entry: Serializable = { kind, url, text: truncate(text) };
          if (parsed !== undefined) {
            entry.parsed = parsed as Serializable;
          }
          safeLog(entry);
        };

        const normaliseUrl = (arg: unknown): string => {
          if (typeof arg === 'string') {
            return arg;
          }
          if (arg instanceof URL) {
            return arg.toString();
          }
          return '';
        };

        function PatchedWebSocket(this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
          const ws = new OriginalWebSocket(...args);
          const url = normaliseUrl(args?.[0]);

          ws.addEventListener('message', (event) => {
            let parsed: unknown;
            let text: string | null = null;

            if (typeof event.data === 'string') {
              text = event.data;
              try {
                parsed = JSON.parse(event.data);
              } catch (error) {
                void error;
              }
            }

            if (!shouldKeepByUrl(url)) {
              return;
            }

            if (parsed && !shouldKeep(parsed)) {
              return;
            }

            wrapMessage(url, text, parsed, 'ws-message');
          });

          return ws;
        }

        PatchedWebSocket.prototype = OriginalWebSocket.prototype;
        window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;

        OriginalWebSocket.prototype.send = function patchedSend(
          this: WebSocket,
          data: Parameters<WebSocket['send']>[0],
        ) {
          let text: string | null = null;
          let parsed: unknown;

          if (typeof data === 'string') {
            text = data;
            try {
              parsed = JSON.parse(data);
            } catch (error) {
              void error;
            }
            if (parsed && !shouldKeep(parsed)) {
              return originalSend.apply(this, [data]);
            }
          }

          const url = (this as { url?: string }).url ?? '';
          if (shouldKeepByUrl(url)) {
            wrapMessage(url, text, parsed, 'ws-send');
          }
          return originalSend.apply(this, [data]);
        };
      })();

      // --- fetch hook ---
      (() => {
        const originalFetch = window.fetch.bind(window);

        window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
          const request = args[0];
          let url = '';
          if (typeof request === 'string') {
            url = request;
          } else if (request instanceof Request) {
            url = request.url;
          } else if (request instanceof URL) {
            url = request.toString();
          }
          try {
            const response = await originalFetch(...args);
            try {
              if (/quotes\/historicals|instruments|options/i.test(url)) {
                const clone = response.clone();
                const text = await clone.text();
                safeLog({ kind: 'http', url, text: truncate(text) });
              }
            } catch (error) {
              void error;
            }
            return response;
          } catch (error) {
            safeLog({ kind: 'http-error', url, error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
        };
      })();
    }
  );
}

export async function runSocketSniffer(
  page: Page,
  options: SocketSnifferOptions = {},
): Promise<string> {
  const symbols = normaliseSymbols(options.symbols ?? []);
  const prefix = options.logPrefix?.trim() || DEFAULT_PREFIX;
  const primarySymbol = symbols[0];
  const logPath = dataPath(primarySymbol ?? prefix, `${prefix}.jsonl`);
  const logDir = path.dirname(logPath);
  const logBaseName = path.basename(logPath, '.jsonl');
  const logPattern = path.join(logDir, `${logBaseName}-*.jsonl`);

  /* eslint-disable no-console */
  console.log(`[socket-sniffer] Registrando (rotativo) en: ${logPattern}`);
  console.log(
    symbols.length > 0
      ? `[socket-sniffer] Símbolos filtrados: ${symbols.join(', ')}`
      : '[socket-sniffer] Capturando todos los símbolos.',
  );
  /* eslint-enable no-console */

  await exposeLogger(page, logPath, prefix);

  const pageWithSniffer = page as PageWithSnifferBinding;
  const ctx = page.context();

  // Handler común
  const onWs = (ws: PlaywrightWebSocket) => {
    const url = ws.url();
    console.log('[socket-sniffer] WS detectado:', url);

    // Acepta cualquier wss de robinhood; filtramos por contenido más adelante
    if (!/^wss:\/\/.*robinhood\.com/i.test(url)) return;

    ws.on('framereceived', async (frame) => {
      try {
        const text = toText(frame.payload);
        // if (typeof frame.payload === 'string') {
        //   text = frame.payload;
        // } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(frame.payload)) {
        //   text = (frame.payload as Buffer).toString('utf8');
        // } else if (frame.payload && typeof (frame.payload as any).toString === 'function') {
        //   text = (frame.payload as any).toString();
        // } else {
        //   text = String(frame.payload ?? '');
        // }
        let parsed: unknown;
        if (typeof text === 'string' && text.startsWith('{')) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
        }
        if (!page.isClosed()) {
          try {
            await page.evaluate(
              (entry: SnifferBindingEntry) => {
                const target = window as typeof window & { socketSnifferLog?: (value: SnifferBindingEntry) => void };
                target.socketSnifferLog?.(entry);
              },
              { kind: 'ws-message' as const, url, text, parsed },
            );
          } catch (error) {
            console.warn('[socket-sniffer] page.evaluate fallo:', error);
          }
        }
      } catch (err) {
        console.error('[socket-sniffer] frame rx error:', err);
      }
    });

    ws.on('framesent', (frame) => {
      try {
        const text = toText(frame.payload);
        let parsed: unknown;
        if (typeof text === 'string' && text.startsWith('{')) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
        }
        // (page as unknown as { socketSnifferLog?: (e: any) => void }).socketSnifferLog?.({
        //   kind: 'ws-message',
        //   url,
        //   text,            // <-- ahora siempre string
        //   parsed,
        // } as const);
        // preferible llamar al binding local directamente (no evaluar en la página)
        pageWithSniffer.socketSnifferLog?.({
          kind: 'ws-message' as const,
          url,
          text,
          parsed,
        });
      } catch (err) {
        console.error('[socket-sniffer] frame tx error:', err);
      }
    });
  };

  // Escucha en page Y en context (hay sockets que no emite `page`)
  page.on('websocket', onWs);
  ctx.on('page', (p: Page) => {
    p.on('websocket', onWs);
  });


  const hookScriptString = `(${buildHookScript.toString()})({
    wantedSymbols: ${JSON.stringify(symbols)},
    maxTextLength: ${MAX_ENTRY_TEXT_LENGTH},
    hookGuardFlag: ${JSON.stringify(HOOK_GUARD_FLAG)}
  })`;

  await page.context().addInitScript(hookScriptString);
  await page.evaluate(hookScriptString);

  page.context().on('page', async (p) => {
    try {
      await p.evaluate(hookScriptString);
      p.on('framenavigated', async (f) => {
        try {
          await f.evaluate(hookScriptString);
        } catch (error) {
          void error;
        }
      });
    } catch (error) {
      void error;
    }
  });

  page.on('framenavigated', async (f) => {
    try {
      await f.evaluate(hookScriptString);
    } catch (error) {
      void error;
    }
  });

  await page.reload({ waitUntil: 'domcontentloaded' });

  // --- Fuerza la inyección en todos los frames activos ---
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(hookScriptString);
      console.log('[socket-sniffer] Hook forzado en frame:', frame.url());
    } catch (err) {
      console.warn('[socket-sniffer] No se pudo inyectar en frame:', frame.url());
    }
  }

  const hookActive = await page.evaluate(
    (flag) => {
      const target = window as typeof window & { [key: string]: unknown };
      return Boolean(target[flag]);
    },
    HOOK_GUARD_FLAG,
  );

  // Verifica también los frames secundarios
    for (const frame of page.frames()) {
      try {
        const active = await frame.evaluate(() => {
          const target = window as typeof window & { __socketHookInstalled?: boolean };
          return Boolean(target.__socketHookInstalled);
        });
        console.log('[socket-sniffer] Hook activo (frame):', frame.url(), active);
      } catch (error) {
        void error;
      }
    }

  /* eslint-disable no-console */
  console.log('[socket-sniffer] Hook activo:', hookActive);
  /* eslint-enable no-console */

  page.once('close', () => {
    /* eslint-disable no-console */
    console.log(`[socket-sniffer] Página cerrada. Archivos disponibles bajo: ${logPattern}`);
    /* eslint-enable no-console */
  });

  return logPattern;
}
