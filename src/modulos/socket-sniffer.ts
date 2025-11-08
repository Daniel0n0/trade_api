import path from 'node:path';
import type { Page, WebSocket as PlaywrightWebSocket } from 'playwright';

import { RotatingWriter, type RotatePolicy } from './rotating-writer.js';
import { BarAggregator, type AggregatedBarResult } from './timebar.js';
import {
  buildBarCsvRow,
  buildCandleAggregationRow,
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
  toMsUtc,
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

const AGGREGATION_SPECS = {
  '1s': { periodMs: 1_000 },
  '1m': { periodMs: 60_000 },
  '5m': { periodMs: 5 * 60_000 },
  '15m': { periodMs: 15 * 60_000 },
  '1h': { periodMs: 60 * 60_000 },
  '1d': { periodMs: 24 * 60 * 60_000 },
} as const;

type AggregationTimeframeKey = keyof typeof AGGREGATION_SPECS;

const DEFAULT_TIMEFRAMES: readonly AggregationTimeframeKey[] = ['1s', '1m', '5m', '15m', '1h', '1d'];

const normalizeAggregationTimeframe = (value: string): AggregationTimeframeKey | null => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (trimmed in AGGREGATION_SPECS) {
    return trimmed as AggregationTimeframeKey;
  }
  if (/^\d+$/.test(trimmed)) {
    const candidate = `${trimmed}m`;
    if (candidate in AGGREGATION_SPECS) {
      return candidate as AggregationTimeframeKey;
    }
  }
  return null;
};

const uniqueTimeframes = (timeframes: readonly AggregationTimeframeKey[]): readonly AggregationTimeframeKey[] => {
  const seen = new Set<AggregationTimeframeKey>();
  const out: AggregationTimeframeKey[] = [];
  for (const timeframe of timeframes) {
    if (!seen.has(timeframe)) {
      seen.add(timeframe);
      out.push(timeframe);
    }
  }
  return out;
};

const resolveEnabledTimeframes = (raw: string | undefined): readonly AggregationTimeframeKey[] => {
  const parsed = (raw ?? '')
    .split(',')
    .map((token) => normalizeAggregationTimeframe(token))
    .filter((token): token is AggregationTimeframeKey => token !== null);
  if (parsed.length === 0) {
    return DEFAULT_TIMEFRAMES;
  }
  return uniqueTimeframes(parsed);
};

export type SocketSnifferOptions = {
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
  readonly start?: string;
  readonly end?: string;
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

const LEGEND_WS_PATTERN = /marketdata\/streaming\/legend\//i;

type LegendMessageKind = 'marketdata' | 'options' | 'news' | 'ignore' | 'unknown';

type LegendClassificationResult =
  | { readonly matched: false }
  | {
      readonly matched: true;
      readonly kind: LegendMessageKind;
      readonly payload?: Record<string, unknown>;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const collectLegendTypeTokens = (root: Record<string, unknown>): readonly string[] => {
  const tokens: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = root;

  while (isRecord(current) && !visited.has(current)) {
    visited.add(current);
    const record = current as Record<string, unknown>;
    const typeValue = record.type;
    if (typeof typeValue === 'string') {
      const normalized = typeValue.trim();
      if (normalized) {
        tokens.push(normalized);
      }
    }
    current = record.payload;
  }

  return tokens;
};

const resolveDeepestLegendPayload = (root: Record<string, unknown>): Record<string, unknown> => {
  const visited = new Set<unknown>();
  let current: unknown = root;
  let deepest: Record<string, unknown> = root;

  while (isRecord(current) && !visited.has(current)) {
    visited.add(current);
    deepest = current as Record<string, unknown>;
    const next = (current as Record<string, unknown>).payload;
    if (!isRecord(next)) {
      break;
    }
    current = next;
  }

  return deepest;
};

const classifyLegendWsMessage = (entry: WsMessageEntry): LegendClassificationResult => {
  if (!LEGEND_WS_PATTERN.test(entry.url)) {
    return { matched: false };
  }

  if (!isRecord(entry.parsed)) {
    return { matched: true, kind: 'unknown' };
  }

  const tokens = collectLegendTypeTokens(entry.parsed);
  const normalizedTokens = tokens.map((token) => token.trim().toUpperCase()).filter(Boolean);
  const reversed = [...normalizedTokens].reverse();
  const payload = resolveDeepestLegendPayload(entry.parsed);

  const includesToken = (needles: readonly string[]): boolean =>
    reversed.some((token) => needles.some((needle) => token.includes(needle)));

  if (includesToken(['KEEPALIVE', 'HEARTBEAT', 'PING', 'PONG'])) {
    return { matched: true, kind: 'ignore', payload };
  }

  if (includesToken(['SUBSCRIBED', 'SUBSCRIPTION', 'ACK', 'CONNECTED', 'CONNECT'])) {
    return { matched: true, kind: 'ignore', payload };
  }

  if (includesToken(['OPTION'])) {
    return { matched: true, kind: 'options', payload };
  }

  if (includesToken(['NEWS'])) {
    return { matched: true, kind: 'news', payload };
  }

  if (includesToken(['MARKETDATA'])) {
    return { matched: true, kind: 'marketdata', payload };
  }

  return { matched: true, kind: 'unknown', payload };
};

export const resolveEventTimestamp = (event: BaseEvent): number | undefined => {
  const record = event as Record<string, unknown>;
  const candidates: readonly unknown[] = [
    event.eventTime,
    event.time,
    record.eventTimestamp,
    record.timestamp,
    record.ts,
    record.t,
  ];

  for (const candidate of candidates) {
    const resolved = toMsUtc(candidate);
    if (resolved !== null) {
      return resolved;
    }
  }

  return undefined;
};

function normaliseSymbols(input: readonly string[]): readonly string[] {
  return input.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
}

async function exposeLogger(
  page: Page,
  logPath: string,
  perChannelPrefix: string,
  meta: { start?: string; end?: string } = {},
): Promise<() => void> {
  const baseDir = path.dirname(logPath);
  const baseName = path.basename(logPath, '.jsonl');

  const generalWriter = new RotatingWriter(path.join(baseDir, `${baseName}.jsonl`), ROTATE_POLICY);
  const VERBOSE = false; // Cambiado a false para reducir ruido por defecto

  const counts = {
    ch1: 0,
    ch3: 0,
    ch5: 0,
    ch7: 0,
    legendOptions: 0,
    legendNews: 0,
    other: 0,
    total: 0,
  };
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
  const legendOptionsWriter = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-legend-options.jsonl`),
    ROTATE_POLICY,
  );
  const legendNewsWriter = new RotatingWriter(
    path.join(baseDir, `${perChannelPrefix}-legend-news.jsonl`),
    ROTATE_POLICY,
  );
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

  const bumpLegend = (key: 'legendOptions' | 'legendNews', n: number) => {
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }

    counts.total += n;
    counts[key] += n;
    lastWriteTs[key] = Date.now();
  };

  const writeLegendSink = (
    writer: RotatingWriter,
    key: 'legendOptions' | 'legendNews',
    payload: Record<string, unknown> | undefined,
  ) => {
    if (!payload) {
      return;
    }

    const now = Date.now();
    const base = {
      ts: now,
      channel: (payload as { channel?: unknown }).channel,
      type: (payload as { type?: unknown }).type,
      topic: (payload as { topic?: unknown }).topic,
    };

    const rawData = (payload as { data?: unknown }).data;
    if (Array.isArray(rawData) && rawData.length > 0) {
      bumpLegend(key, rawData.length);
      for (const item of rawData) {
        writer.write(
          JSON.stringify({
            ...base,
            data: item,
          }),
        );
      }
      return;
    }

    bumpLegend(key, 1);
    writer.write(
      JSON.stringify({
        ...base,
        payload,
      }),
    );
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

  const enabledTimeframes = resolveEnabledTimeframes(process.env.BARS_TIMEFRAMES);
  type AggregationEntry = { readonly timeframe: AggregationTimeframeKey; readonly aggregator: BarAggregator };
  const aggregations = enabledTimeframes.map<AggregationEntry>((timeframe) => ({
    timeframe,
    aggregator: new BarAggregator({ timeframe, periodMs: AGGREGATION_SPECS[timeframe].periodMs }),
  }));
  const aggregationMap = new Map<AggregationTimeframeKey, AggregationEntry>();
  for (const entry of aggregations) {
    aggregationMap.set(entry.timeframe, entry);
  }

  const barWriters = new Map<string, RotatingWriter>();
  const getBarWriter = (symbol: string, timeframe: string) => {
    const key = `${symbol}__${timeframe}`;
    let writer = barWriters.get(key);
    if (!writer) {
      const baseFile = dataPath(symbol, `${perChannelPrefix}-bars-${timeframe}.csv`);
      writer = new RotatingWriter(baseFile, ROTATE_POLICY, CSV_HEADER_TEXT.bars);
      barWriters.set(key, writer);
    }
    return writer;
  };

  const writeAggregatedBars = (bars: readonly AggregatedBarResult[]) => {
    for (const result of bars) {
      const writer = getBarWriter(result.symbol, result.timeframe);
      writer.write(toCsvLine(CSV_HEADERS.bars, buildBarCsvRow(result.bar)));
    }
  };

  const writeGeneral = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    generalWriter.write(JSON.stringify(payload));
  };

  writeGeneral({ kind: 'boot', msg: 'socket-sniffer up', start: meta.start, end: meta.end });

  const flushBars = (now: number) => {
    for (const { aggregator } of aggregations) {
      const closed = aggregator.drainClosed(now);
      if (closed.length > 0) {
        writeAggregatedBars(closed);
      }
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
        const candleAgg = buildCandleAggregationRow(event);
        if (candleAgg) {
          const timeframeKey = normalizeAggregationTimeframe(resolveCandleTimeframe(event.eventSymbol));
          if (timeframeKey) {
            aggregationMap.get(timeframeKey)?.aggregator.addCandle(candleAgg);
          }
        }
      }

      if (resolvedType === 'Quote') {
        const quoteRow = buildQuoteCsvRow(event);
        if (quoteRow) {
          quoteCsv.write(toCsvLine(CSV_HEADERS.quote, quoteRow));
        }
        const quoteAgg = buildQuoteAggregationRow(event);
        if (quoteAgg) {
          for (const { aggregator } of aggregations) {
            aggregator.addQuote(quoteAgg);
          }
        }
      } else if (resolvedType === 'Trade' || resolvedType === 'TradeETH') {
        const trade = buildTradeAggregationRow(event, resolvedType);
        if (trade) {
          for (const { aggregator } of aggregations) {
            aggregator.addTrade(trade);
          }
        }
      }
    }

    flushBars(lastNow);
  };

  const isWsMessageEntry = (entry: Serializable): entry is WsMessageEntry =>
    entry.kind === 'ws-message' && typeof entry.url === 'string' && typeof entry.text === 'string';

  const shouldIgnoreWsMessage = (
    entry: WsMessageEntry,
    classification?: LegendClassificationResult,
  ): boolean => {
    const { parsed, url } = entry;

    if (!parsed || typeof parsed !== 'object') {
      return false;
    }

    const payload = parsed as Record<string, unknown>;

    if (/api-streaming\.robinhood\.com/i.test(url)) {
      const opCode = payload.opCode ?? (payload as { opcode?: unknown }).opcode;
      const opCodeValue =
        typeof opCode === 'string' ? Number.parseInt(opCode, 10) : (opCode as number | undefined);
      if (opCodeValue === 10) {
        return true;
      }
    }

    const legendClassification = classification ?? classifyLegendWsMessage(entry);
    if (legendClassification.matched) {
      if (legendClassification.kind === 'ignore') {
        return true;
      }

      const channelCandidate = (legendClassification.payload as { channel?: unknown } | undefined)?.channel;
      const channelValue =
        typeof channelCandidate === 'string'
          ? Number.parseInt(channelCandidate, 10)
          : (channelCandidate as number | undefined);
      if (channelValue === 0) {
        return true;
      }
    }

    return false;
  };

  await page.exposeFunction('socketSnifferLog', (entry: SnifferBindingEntry) => {
    try {
      if (VERBOSE) {
        /* eslint-disable no-console */
        console.log('[socket-sniffer] entry:', JSON.stringify(entry));
        /* eslint-enable no-console */
      }

      let legendClassification: LegendClassificationResult | undefined;
      if (isWsMessageEntry(entry)) {
        legendClassification = classifyLegendWsMessage(entry);
        if (shouldIgnoreWsMessage(entry, legendClassification)) {
          return;
        }
      }

      writeGeneral(entry);

      if (isWsMessageEntry(entry)) {
        const classification = legendClassification ?? classifyLegendWsMessage(entry);
        if (classification.matched) {
          switch (classification.kind) {
            case 'marketdata': {
              const feed = extractFeed(entry.parsed);
              if (feed && feed.data.length) {
                writeChannelRows(feed.channel, feed.data);
              }
              break;
            }
            case 'options':
              writeLegendSink(legendOptionsWriter, 'legendOptions', classification.payload);
              break;
            case 'news':
              writeLegendSink(legendNewsWriter, 'legendNews', classification.payload);
              break;
            case 'unknown': {
              const feed = extractFeed(entry.parsed);
              if (feed && feed.data.length) {
                writeChannelRows(feed.channel, feed.data);
              }
              break;
            }
            case 'ignore':
              break;
          }
        } else {
          const feed = extractFeed(entry.parsed);
          if (feed && feed.data.length) {
            writeChannelRows(feed.channel, feed.data);
          }
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
      flushBars(now);
      for (const { aggregator } of aggregations) {
        const remaining = aggregator.drainAll();
        if (remaining.length > 0) {
          writeAggregatedBars(remaining);
        }
      }
    } catch (error) {
      void error;
    }

    generalWriter.close();
    legendOptionsWriter.close();
    legendNewsWriter.close();
    for (const writer of candleCsvByTimeframe.values()) {
      writer.close();
    }
    quoteCsv.close();
    for (const writer of barWriters.values()) {
      writer.close();
    }
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
    start: options.start,
    end: options.end,
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
