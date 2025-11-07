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
import { extractFeed, MAX_WS_ENTRY_TEXT_LENGTH, normaliseFramePayload } from '../utils/payload.js';

type Serializable = Record<string, unknown>;

const DEFAULT_PREFIX = 'socket';
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEALTH_INTERVAL_MS = 30_000;
const HOOK_GUARD_FLAG = '__socketSnifferHooked__';

const ROTATE_POLICY: RotatePolicy = {
  maxBytes: 50_000_000,
  maxMinutes: 60,
  gzipOnRotate: true,
};

export type SocketSnifferOptions = {
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
  readonly startAt?: string;
  readonly endAt?: string;
};

export type SocketSnifferHandle = {
  readonly close: () => void;
  readonly logPattern: string;
};

// type PlaywrightWebSocketFrame = {
//   readonly payload: string;
// };

type WsMessageEntry = {
  readonly kind: 'ws-message';
  readonly url: string;
  readonly text: string;
  readonly parsed?: unknown;
};

type SnifferBindingEntry = WsMessageEntry | Serializable;

type PageWithSnifferBinding = Page & {
  socketSnifferLog?: (entry: SnifferBindingEntry) => void;
};

type LogEntry = Serializable & {
  readonly ts: number;
};

function normaliseSymbols(input: readonly string[]): readonly string[] {
  return input.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
}

async function exposeLogger(
  page: Page,
  logPath: string,
  perChannelPrefix: string,
  meta: { startAt?: string; endAt?: string } = {},
): Promise<() => void> {
  const baseDir = path.dirname(logPath);
  const baseName = path.basename(logPath, '.jsonl');

  const generalWriter = new RotatingWriter(path.join(baseDir, `${baseName}.jsonl`), ROTATE_POLICY);
  const VERBOSE = false; // Cambiado a false para reducir ruido por defecto

  const counts = { ch1: 0, ch3: 0, ch5: 0, ch7: 0, other: 0, total: 0 };
  const lastWriteTs: Record<string, number> = {};

  const bump = (channel: number, n: number) => {
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }

    counts.total += n;
    let key: string;
    if (channel === 1) {
      counts.ch1 += n;
      key = 'ch1';
    } else if (channel === 3) {
      counts.ch3 += n;
      key = 'ch3';
    } else if (channel === 5) {
      counts.ch5 += n;
      key = 'ch5';
    } else if (channel === 7) {
      counts.ch7 += n;
      key = 'ch7';
    } else {
      counts.other += n;
      key = `ch${channel}`;
      lastWriteTs.other = Date.now();
    }

    lastWriteTs[key] = Date.now();
  };

  const channelWriters = new Map<string, RotatingWriter>();
  let closed = false;
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

  const SUPPORTED_TIMEFRAMES = new Set([1, 5, 15]);
  const tfEnv = (process.env.BARS_TIMEFRAMES ?? '1,5,15')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && SUPPORTED_TIMEFRAMES.has(value));
  const enabledTFValues = tfEnv.length > 0 ? tfEnv : [1, 5, 15];
  const enabledTF = new Set<number>(enabledTFValues);

  const agg1m = enabledTF.has(1) ? new BarAggregator(1) : null;
  const agg5m = enabledTF.has(5) ? new BarAggregator(5) : null;
  const agg15m = enabledTF.has(15) ? new BarAggregator(15) : null;

  const bars1mCsv = enabledTF.has(1)
    ? new RotatingWriter(
        path.join(baseDir, `${perChannelPrefix}-bars-1m.csv`),
        ROTATE_POLICY,
        CSV_HEADER_TEXT.bars,
      )
    : null;
  const bars5mCsv = enabledTF.has(5)
    ? new RotatingWriter(
        path.join(baseDir, `${perChannelPrefix}-bars-5m.csv`),
        ROTATE_POLICY,
        CSV_HEADER_TEXT.bars,
      )
    : null;
  const bars15mCsv = enabledTF.has(15)
    ? new RotatingWriter(
        path.join(baseDir, `${perChannelPrefix}-bars-15m.csv`),
        ROTATE_POLICY,
        CSV_HEADER_TEXT.bars,
      )
    : null;

  const writeGeneral = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    generalWriter.write(JSON.stringify(payload));
  };

  writeGeneral({ kind: 'boot', msg: 'socket-sniffer up', startAt: meta.startAt, endAt: meta.endAt });

  const flushBars = (now: number) => {
    const closed1 = agg1m?.drainClosed(now) ?? [];
    for (const bar of closed1) {
      bars1mCsv?.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
    }
    const closed5 = agg5m?.drainClosed(now) ?? [];
    for (const bar of closed5) {
      bars5mCsv?.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
    }
    const closed15 = agg15m?.drainClosed(now) ?? [];
    for (const bar of closed15) {
      bars15mCsv?.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
    }
  };

  const heartbeat = setInterval(() => {
    flushBars(Date.now());
  }, HEARTBEAT_INTERVAL_MS);

  const healthbeat = setInterval(() => {
    const now = Date.now();
    const rss = typeof process.memoryUsage === 'function' ? process.memoryUsage().rss : undefined;
    writeGeneral({
      kind: 'health',
      ts: now,
      counts: { ...counts },
      lastWriteTs: { ...lastWriteTs },
      rss,
      uptimeSec: Math.floor(process.uptime()),
    });
  }, HEALTH_INTERVAL_MS);

  const toFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
  };

  const resolveEventTimestamp = (event: BaseEvent): number | undefined => {
    const record = event as Record<string, unknown>;
    const candidates: unknown[] = [
      event.eventTime,
      event.time,
      record.eventTimestamp,
      record.timestamp,
      record.ts,
      record.t,
    ];

    for (const candidate of candidates) {
      const resolved = toFiniteNumber(candidate);
      if (typeof resolved === 'number') {
        return resolved;
      }
    }

    return undefined;
  };

  const resolveEventSymbol = (event: BaseEvent): string | undefined => {
    const candidates = [event.eventSymbol, event.symbol];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return undefined;
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
    bump(channel, rows.length);

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

      const eventTs = resolveEventTimestamp(event);
      if (typeof eventTs === 'number') {
        const lagMs = Date.now() - eventTs;
        if (lagMs > 2000) {
          writeGeneral({
            kind: 'lag-warn',
            channel,
            symbol: resolveEventSymbol(event),
            lagMs,
            eventTs,
          });
        }
      }

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
          agg1m?.addQuote(quoteAgg);
          agg5m?.addQuote(quoteAgg);
          agg15m?.addQuote(quoteAgg);
        }
      } else if (resolvedType === 'Trade' || resolvedType === 'TradeETH') {
        const trade = buildTradeAggregationRow(event);
        if (trade) {
          agg1m?.addTrade(trade);
          agg5m?.addTrade(trade);
          agg15m?.addTrade(trade);
        }
      }
    }

    flushBars(lastNow);
  };

  const isWsMessageEntry = (entry: Serializable): entry is WsMessageEntry =>
    entry.kind === 'ws-message' && typeof entry.url === 'string' && typeof entry.text === 'string';

  await page.exposeFunction('socketSnifferLog', (entry: SnifferBindingEntry) => {
    try {
      if (VERBOSE) {
        /* eslint-disable no-console */
        console.log('[socket-sniffer] entry:', JSON.stringify(entry));
        /* eslint-enable no-console */
      }

      writeGeneral(entry);

      if (isWsMessageEntry(entry)) {
        const feed = extractFeed(entry.parsed);
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
    clearInterval(heartbeat);
    clearInterval(healthbeat);
    try {
      const now = Date.now();
      const remaining1 = agg1m?.drainAll() ?? [];
      for (const bar of remaining1) {
        bars1mCsv?.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
      }
      const remaining5 = agg5m?.drainAll() ?? [];
      for (const bar of remaining5) {
        bars5mCsv?.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
      }
      const remaining15 = agg15m?.drainAll() ?? [];
      for (const bar of remaining15) {
        bars15mCsv?.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(bar)));
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
    bars1mCsv?.close();
    bars5mCsv?.close();
    bars15mCsv?.close();
    for (const writer of channelWriters.values()) {
      writer.close();
    }

    return undefined;
  };

  page.once('close', () => {
    closeAll();
    /* eslint-disable no-console */
    console.log('[socket-sniffer] Página cerrada. Archivos rotados y comprimidos si aplica.');
    /* eslint-enable no-console */
  });

  return closeAll;
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
): Promise<SocketSnifferHandle> {
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

  const closeLogger = await exposeLogger(page, logPath, prefix, {
    startAt: options.startAt,
    endAt: options.endAt,
  });

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
        const { text, parsed } = normaliseFramePayload(frame.payload);
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
        const { text, parsed } = normaliseFramePayload(frame.payload);
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
    maxTextLength: ${MAX_WS_ENTRY_TEXT_LENGTH},
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

  let framesWithHook = 0;
  for (const frame of page.frames()) {
    try {
      const active = await frame.evaluate(() => {
        const target = window as typeof window & { __socketHookInstalled?: boolean };
        return Boolean(target.__socketHookInstalled);
      });
      if (active) {
        framesWithHook += 1;
      }
      console.log('[socket-sniffer] Hook activo (frame):', frame.url(), active);
    } catch (error) {
      void error;
    }
  }

  if (!hookActive && framesWithHook === 0) {
    console.warn('[socket-sniffer] Hook no instalado en ningún frame; usando CDP como fuente principal.');
  } else {
    /* eslint-disable no-console */
    console.log('[socket-sniffer] Hook activo:', hookActive, 'frames con hook:', framesWithHook);
    /* eslint-enable no-console */
  }

  return {
    close: closeLogger,
    logPattern,
  };
}
