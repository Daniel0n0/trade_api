import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

import { RotatingWriter, type RotatePolicy } from './rotating-writer.js';
import { BarAggregator } from './timebar.js';

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

type LogEntry = Serializable & {
  readonly ts: number;
};

type DxFeedRow = {
  readonly eventType?: string;
  readonly eventSymbol?: string;
  readonly symbol?: string;
  readonly eventFlags?: number | string;
  readonly time?: number;
  readonly eventTime?: number;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly volume?: number;
  readonly vwap?: number;
  readonly count?: number;
  readonly sequence?: number;
  readonly impliedVolatility?: number;
  readonly openInterest?: number;
  readonly price?: number;
  readonly dayVolume?: number;
  readonly bidPrice?: number;
  readonly bidSize?: number;
  readonly bidTime?: number;
  readonly askPrice?: number;
  readonly askSize?: number;
  readonly askTime?: number;
  readonly [key: string]: unknown;
};

function safeDirName(input: string | undefined): string {
  if (!input) {
    return 'GENERAL';
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return 'GENERAL';
  }
  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function currentDateFolder(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureDataDir(asset?: string): string {
  const dir = path.join(process.cwd(), 'data', safeDirName(asset), currentDateFolder());
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createLogPath(prefix: string, asset?: string): string {
  return path.join(ensureDataDir(asset), `${prefix}.jsonl`);
}

function normaliseSymbols(input: readonly string[]): readonly string[] {
  return input.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
}

// Convierte el payload de dxFeed a una fila más plana según canal/eventType
function normalizeDxFeedRow(channel: number, row: DxFeedRow | undefined): Record<string, unknown> {
  const sym = row?.eventSymbol ?? row?.symbol ?? undefined;
  const base = {
    ts: Date.now(),
    symbol: sym,
    channel,
    eventType: row?.eventType,
    eventTime: row?.time ?? row?.eventTime,
  };

  if (row?.eventType === 'Candle' || channel === 1) {
    return {
      ...base,
      open: row?.open,
      high: row?.high,
      low: row?.low,
      close: row?.close,
      volume: row?.volume,
      vwap: row?.vwap,
      count: row?.count,
      sequence: row?.sequence,
      impliedVolatility: row?.impliedVolatility,
      openInterest: row?.openInterest,
    };
  }

  if (row?.eventType === 'Trade' || channel === 3) {
    return {
      ...base,
      price: row?.price,
      dayVolume: row?.dayVolume,
    };
  }

  if (row?.eventType === 'TradeETH' || channel === 5) {
    return {
      ...base,
      price: row?.price,
      dayVolume: row?.dayVolume,
      session: 'ETH',
    };
  }

  if (row?.eventType === 'Quote' || channel === 7) {
    return {
      ...base,
      bidPrice: row?.bidPrice,
      bidSize: row?.bidSize,
      bidTime: row?.bidTime,
      askPrice: row?.askPrice,
      askSize: row?.askSize,
      askTime: row?.askTime,
    };
  }

  return { ...base, raw: row };
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
  const VERBOSE = true; // DEBUG: habilita log detallado temporalmente

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

  const candleCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-candle.csv`),
    ROTATE_POLICY,
    't,open,high,low,close,volume,symbol',
  );

  const quoteCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-quote.csv`),
    ROTATE_POLICY,
    't,bidPrice,bidSize,askPrice,askSize,symbol',
  );

  const agg1m = new BarAggregator(1);
  const agg5m = new BarAggregator(5);
  const agg15m = new BarAggregator(15);

  const bars1mCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-bars-1m.csv`),
    ROTATE_POLICY,
    't,open,high,low,close,volume',
  );
  const bars5mCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-bars-5m.csv`),
    ROTATE_POLICY,
    't,open,high,low,close,volume',
  );
  const bars15mCsv = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-bars-15m.csv`),
    ROTATE_POLICY,
    't,open,high,low,close,volume',
  );

  const writeGeneral = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    generalWriter.write(JSON.stringify(payload));
  };

  writeGeneral({ kind: 'boot', msg: 'socket-sniffer up' });

  const flushBars = (now: number) => {
    const closed1 = agg1m.drainClosed(now);
    for (const bar of closed1) {
      bars1mCsv.write(`${bar.t},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`);
    }
    const closed5 = agg5m.drainClosed(now);
    for (const bar of closed5) {
      bars5mCsv.write(`${bar.t},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`);
    }
    const closed15 = agg15m.drainClosed(now);
    for (const bar of closed15) {
      bars15mCsv.write(`${bar.t},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`);
    }
  };

  const parseFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      if (trimmed.toLowerCase() === 'nan') {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const hasInvalidNumeric = (value: unknown): boolean => {
    if (value === undefined || value === null) {
      return false;
    }
    return parseFiniteNumber(value) === null;
  };

  const writeChannelRows = (channel: number, rows: readonly DxFeedRow[]) => {
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
      const isCandle = channel === 1 || row?.eventType === 'Candle';
      if (isCandle) {
        const flagsValue = parseFiniteNumber(row?.eventFlags);
        const invalidFlags = flagsValue === 18;
        const invalidValue =
          hasInvalidNumeric(row?.open) ||
          hasInvalidNumeric(row?.high) ||
          hasInvalidNumeric(row?.low) ||
          hasInvalidNumeric(row?.close) ||
          hasInvalidNumeric(row?.volume);

        if (invalidFlags || invalidValue) {
          continue;
        }
      }

      const flat = normalizeDxFeedRow(channel, row);
      writer.write(JSON.stringify(flat));

      if (channel === 1 || row?.eventType === 'Candle') {
        const t = Number(row?.time ?? row?.eventTime ?? currentNow);
        const line = `${t},${row?.open ?? ''},${row?.high ?? ''},${row?.low ?? ''},${row?.close ?? ''},${row?.volume ?? ''},${row?.eventSymbol ?? ''}`;
        candleCsv.write(line);
      }

      if (channel === 7 || row?.eventType === 'Quote') {
        const t = Number(row?.bidTime ?? row?.askTime ?? currentNow);
        const line = `${t},${row?.bidPrice ?? ''},${row?.bidSize ?? ''},${row?.askPrice ?? ''},${row?.askSize ?? ''},${row?.eventSymbol ?? ''}`;
        quoteCsv.write(line);
      }

      if (channel === 3 || row?.eventType === 'Trade') {
        const tsCandidate = row?.time ?? row?.eventTime;
        const ts = parseFiniteNumber(tsCandidate);
        const price = parseFiniteNumber(row?.price);
        if (ts !== null && price !== null) {
          const dayVolume = parseFiniteNumber(row?.dayVolume) ?? undefined;
          const trade = { price, dayVolume, ts };
          agg1m.addTrade(trade);
          agg5m.addTrade(trade);
          agg15m.addTrade(trade);
        }
      } else if (channel === 5 || row?.eventType === 'TradeETH') {
        const tsCandidate = row?.time ?? row?.eventTime;
        const ts = parseFiniteNumber(tsCandidate);
        const price = parseFiniteNumber(row?.price);
        if (ts !== null && price !== null) {
          const dayVolume = parseFiniteNumber(row?.dayVolume) ?? undefined;
          const trade = { price, dayVolume, ts };
          agg1m.addTrade(trade);
          agg5m.addTrade(trade);
          agg15m.addTrade(trade);
        }
      } else if (channel === 7 || row?.eventType === 'Quote') {
        const tsCandidate = row?.bidTime ?? row?.askTime;
        const ts = parseFiniteNumber(tsCandidate);
        if (ts !== null) {
          const quote = {
            bidPrice: parseFiniteNumber(row?.bidPrice) ?? undefined,
            askPrice: parseFiniteNumber(row?.askPrice) ?? undefined,
            ts,
          };
          agg1m.addQuote(quote);
          agg5m.addQuote(quote);
          agg15m.addQuote(quote);
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
          writeChannelRows(feed.channel, feed.data as DxFeedRow[]);
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
        bars1mCsv.write(`${bar.t},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`);
      }
      const remaining5 = agg5m.drainAll();
      for (const bar of remaining5) {
        bars5mCsv.write(`${bar.t},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`);
      }
      const remaining15 = agg15m.drainAll();
      for (const bar of remaining15) {
        bars15mCsv.write(`${bar.t},${bar.open},${bar.high},${bar.low},${bar.close},${bar.volume}`);
      }
      flushBars(now);
    } catch (error) {
      void error;
    }

    generalWriter.close();
    candleCsv.close();
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
      } catch {}

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

        const shouldKeepByUrl = (_url: string): boolean => true;

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
  const logPath = createLogPath(prefix, primarySymbol ?? prefix);
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

  const ctx = page.context();

// Handler común
  const onWs = (ws: any) => {
    const url: string = ws.url?.() ?? ws.url?.() ?? ws.url ?? '';
    console.log('[socket-sniffer] WS detectado:', url);

    // Acepta cualquier wss de robinhood; filtramos por contenido más adelante
    if (!/^wss:\/\/.*robinhood\.com/i.test(url)) return;

    ws.on('framereceived', (frame: any) => {
      try {
        const text = frame.payload;
        let parsed: unknown;
        if (typeof text === 'string' && text.startsWith('{')) {
          parsed = JSON.parse(text);
        }
        void page.evaluate((e) => (window as any).socketSnifferLog?.(e), {
  kind: 'ws-message',
  url,
  text,
  parsed,
});
      } catch (err) {
        console.error('[socket-sniffer] frame rx error:', err);
      }
    });

    ws.on('framesent', (frame: any) => {
      try {
        const text = frame.payload;
        let parsed: unknown;
        if (typeof text === 'string' && text.startsWith('{')) {
          parsed = JSON.parse(text);
        }
        (page as any).socketSnifferLog?.({ kind: 'ws-send', url, text, parsed });
      } catch (err) {
        console.error('[socket-sniffer] frame tx error:', err);
      }
    });
  };

  // Escucha en page Y en context (hay sockets que no emite `page`)
  page.on('websocket', onWs as any);
  ctx.on('page', (p: Page) => {
    p.on('websocket', onWs as any);
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
    (flag) => Boolean(((window as unknown) as { [key: string]: unknown })[flag]),
    HOOK_GUARD_FLAG,
  );

  // Verifica también los frames secundarios
  for (const frame of page.frames()) {
    try {
      const active = await frame.evaluate(() => !!(window as any).__socketHookInstalled);
      console.log('[socket-sniffer] Hook activo (frame):', frame.url(), active);
    } catch {}
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
