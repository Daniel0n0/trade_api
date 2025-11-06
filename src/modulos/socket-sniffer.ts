import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

type Serializable = Record<string, unknown>;

const DEFAULT_SYMBOLS = ['SPY'];
const DEFAULT_PREFIX = 'socket';
const MAX_ENTRY_TEXT_LENGTH = 200_000;
const HOOK_GUARD_FLAG = '__socketSnifferHooked__';

type SocketSnifferOptions = {
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
};

type LogEntry = Serializable & {
  readonly ts: number;
};

type ChannelWriters = {
  ch1?: string;
  ch3?: string;
  ch5?: string;
  ch7?: string;
};

type DxFeedRow = {
  readonly eventType?: string;
  readonly eventSymbol?: string;
  readonly symbol?: string;
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

function timestampString(): string {
  const date = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}-` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())}`
  );
}

function ensureArtifactsDir(): string {
  const dir = path.join(process.cwd(), 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function createLogPath(prefix: string): string {
  return path.join(ensureArtifactsDir(), `${prefix}-${timestampString()}.jsonl`);
}

function channelLogPath(basePrefix: string, channel: number, label?: string): string {
  const name = label ? `${basePrefix}-ch${channel}-${label}.jsonl` : `${basePrefix}-ch${channel}.jsonl`;
  return path.join(ensureArtifactsDir(), name);
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

function isFeedDataPayload(value: unknown): value is { type: 'FEED_DATA'; channel?: number | string; data?: unknown } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return (value as { type?: unknown }).type === 'FEED_DATA';
}

async function exposeLogger(page: Page, logPath: string, perChannelPrefix: string): Promise<void> {
  const writers: ChannelWriters = {};

  const writeLine = (filePath: string, obj: Record<string, unknown>) => {
    fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
  };

  const writeEntry = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    writeLine(logPath, payload);
  };

  const writeChannelRows = (channel: number, rows: readonly DxFeedRow[], label?: string) => {
    if (!rows?.length) {
      return;
    }

    let targetPath: string;
    if (channel === 1) {
      targetPath = writers.ch1 ?? (writers.ch1 = channelLogPath(perChannelPrefix, 1, 'candle'));
    } else if (channel === 3) {
      targetPath = writers.ch3 ?? (writers.ch3 = channelLogPath(perChannelPrefix, 3, 'trade'));
    } else if (channel === 7) {
      targetPath = writers.ch7 ?? (writers.ch7 = channelLogPath(perChannelPrefix, 7, 'quote'));
    } else if (channel === 5) {
      targetPath = writers.ch5 ?? (writers.ch5 = channelLogPath(perChannelPrefix, 5));
    } else {
      targetPath = channelLogPath(perChannelPrefix, channel, label);
    }

    for (const row of rows) {
      const flat = normalizeDxFeedRow(channel, row);
      writeLine(targetPath, flat);
    }
  };

  await page.exposeFunction('socketSnifferLog', (entry: Serializable) => {
    try {
      writeEntry(entry);

      const parsed = (entry as { parsed?: unknown } | undefined)?.parsed;
      if (entry?.['kind'] === 'ws-message' && isFeedDataPayload(parsed)) {
        const channel = Number(parsed.channel);
        const dataRows = Array.isArray(parsed.data) ? (parsed.data as DxFeedRow[]) : [];
        if (!Number.isNaN(channel) && dataRows.length) {
          writeChannelRows(channel, dataRows);
        }
      }
    } catch (error) {
      /* eslint-disable no-console */
      console.error('[socket-sniffer] Error al escribir log:', error);
      /* eslint-enable no-console */
    }
  });
}

function buildHookScript() {
  return (
    (wantedSymbols: readonly string[], maxTextLength: number, hookGuardFlag: string) => {
      const globalObject = window as typeof window & {
        socketSnifferLog?: (entry: Serializable) => void;
        [key: string]: unknown;
      };

      const guardKey = hookGuardFlag || '__socketSnifferHooked__';
      if (globalObject[guardKey]) {
        return;
      }

      globalObject[guardKey] = true;

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

          wrapMessage((this as { url?: string }).url ?? '', text, parsed, 'ws-send');
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
        };
      })();
    }
  );
}

export async function runSocketSniffer(
  page: Page,
  options: SocketSnifferOptions = {},
): Promise<string> {
  const symbols = normaliseSymbols(options.symbols ?? DEFAULT_SYMBOLS);
  const prefix = options.logPrefix?.trim() || DEFAULT_PREFIX;
  const logPath = createLogPath(prefix);

  /* eslint-disable no-console */
  console.log(`[socket-sniffer] Registrando en: ${logPath}`);
  console.log(
    symbols.length > 0
      ? `[socket-sniffer] Símbolos filtrados: ${symbols.join(', ')}`
      : '[socket-sniffer] Capturando todos los símbolos.',
  );
  /* eslint-enable no-console */

  await exposeLogger(page, logPath, prefix);

  const hookScript = buildHookScript();
  await page.addInitScript(hookScript, symbols, MAX_ENTRY_TEXT_LENGTH, HOOK_GUARD_FLAG);
  await page.evaluate(hookScript, symbols, MAX_ENTRY_TEXT_LENGTH, HOOK_GUARD_FLAG);

  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } catch (error) {
    /* eslint-disable no-console */
    console.warn('[socket-sniffer] No se pudo recargar la página automáticamente:', error);
    /* eslint-enable no-console */
  }

  page.once('close', () => {
    /* eslint-disable no-console */
    console.log(`[socket-sniffer] Página cerrada. Log disponible en: ${logPath}`);
    /* eslint-enable no-console */
  });

  return logPath;
}
