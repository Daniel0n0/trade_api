import { createWriteStream, existsSync, statSync, type WriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Frame, Page, Request, WebSocket } from 'playwright';
import { DateTime } from 'luxon';

import { RotatingWriter, type RotatePolicy } from './rotating-writer.js';
import { BarAggregator, type AggregatedBarResult } from './timebar.js';
import {
  buildBarCsvRow,
  buildCandleAggregationRow,
  buildCandleCsvRow,
  buildQuoteAggregationRow,
  buildQuoteCsvRow,
  buildStatsCsvRow,
  buildTradeAggregationRow,
  CSV_HEADERS,
  CSV_HEADER_TEXT,
  isValidCandle,
  normalizeDxFeedRow,
  resolveCandleTimeframe,
  type StatsCounts,
  toCsvLine,
  toMsUtc,
} from '../io/row.js';
import { dataPath, ensureSymbolDateDir } from '../io/paths.js';
import {
  onLegendFrame,
  onLegendOpen,
  shouldProcessLegendWS,
} from './legend-advanced-recorder.js';
import { ensureDirectoryForFileSync, ensureDirectorySync } from '../io/dir.js';
import { BaseEvent } from '../io/schemas.js';
import { extractFeed, MAX_WS_ENTRY_TEXT_LENGTH } from '../utils/payload.js';
import { isHookableFrame } from '../utils/origins.js';

type Serializable = Record<string, unknown>;

const DEFAULT_PREFIX = 'socket';
const ROBINHOOD_STREAMING_WS_PREFIX = 'wss://api-streaming.robinhood.com/wss/connect';
const ORDER_HEARTBEATS_HEADER =
  'snapshot_ts_ms,snapshot_date_utc,ws_url,dir,opCode,data_base64,decoded_hint';
const ORDER_SESSION_INDEX_HEADER =
  'session_start_ts_ms,session_date_utc,ws_url,topics,server_idle_timeout_ms,client_user_agent,origin';
const HEARTBEAT_OPCODES = new Set([9, 10]);
const ORDER_FIELD_KEYS = [
  'order_id',
  'orderId',
  'orderID',
  'id',
  'state',
  'asset_class',
  'assetClass',
  'symbol',
  'side',
  'quantity',
  'qty',
  'cumulative_quantity',
  'filled_quantity',
  'average_price',
  'price',
  'trigger_price',
];

type WsFrameDirection = 'received' | 'sent';
const HEARTBEAT_INTERVAL_MS = 5_000;
const STATS_SNAPSHOT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
const HEALTH_INTERVAL_MS = 30_000;
const LAG_WARN_COOLDOWN_MS = 60_000;
const EVENT_LAG_WARN_THRESHOLD_MS = 1_500;

const MARKET_TZ = 'America/New_York';
const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 09:30
const MARKET_CLOSE_MINUTES = 16 * 60 + 15; // 16:15 to allow for late prints
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_THRESHOLD_MS = 90_000;
const WATCHDOG_KEY = 'bar:1min';
const WATCHDOG_COOLDOWN_MS = 120_000;

const LEGEND_CHANNEL_METADATA: Record<number, { label: string; resolvedType?: string }> = {
  1: { label: 'candle', resolvedType: 'Candle' },
  3: { label: 'trade', resolvedType: 'Trade' },
  5: { label: 'tradeeth', resolvedType: 'TradeETH' },
  7: { label: 'quote', resolvedType: 'Quote' },
  9: { label: 'quote-advanced', resolvedType: 'Quote' },
  11: { label: 'greeks', resolvedType: 'Greeks' },
  13: { label: 'summary', resolvedType: 'SeriesSummary' },
};

const LEGEND_CHANNELS = new Set<number>(Object.keys(LEGEND_CHANNEL_METADATA).map((key) => Number.parseInt(key, 10)));

const LEGEND_CHANNEL_LAG_THRESHOLD_MS = 10_000;

const LAG_WARN_THRESHOLDS_MS: Record<string, number> = {
  ...Object.fromEntries(
    [...LEGEND_CHANNELS].map((channel) => [`ch${channel}`, LEGEND_CHANNEL_LAG_THRESHOLD_MS]),
  ),
  other: 30_000,
  legendOptions: 180_000,
  legendNews: 180_000,
  'bar:1sec': 20_000,
  'bar:1min': WATCHDOG_THRESHOLD_MS,
  'bar:5min': 6 * 60_000,
  'bar:15min': 20 * 60_000,
  'bar:1h': 2 * 60 * 60_000,
  'bar:1d': 26 * 60 * 60_000,
};
const HOOK_GUARD_FLAG = '__socketSnifferHooked__';

const HOOK_POLYFILL = `
;window.__name = window.__name || ((fn, name) => {
  try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch {}
  return fn;
});
`;

const ROTATE_POLICY: RotatePolicy = {
  maxBytes: 50_000_000,
  maxMinutes: 60,
  gzipOnRotate: false,
};

const AGGREGATION_SPECS = {
  '1sec': { periodMs: 1_000 },
  '1min': { periodMs: 60_000 },
  '5min': { periodMs: 5 * 60_000 },
  '15min': { periodMs: 15 * 60_000 },
  '1h': { periodMs: 60 * 60_000 },
  '1d': { periodMs: 24 * 60 * 60_000 },
} as const;

type AggregationTimeframeKey = keyof typeof AGGREGATION_SPECS;

const AGGREGATION_FILE_SEGMENTS: Record<AggregationTimeframeKey, string> = {
  '1sec': '1s',
  '1min': '1m',
  '5min': '5m',
  '15min': '15m',
  '1h': '1h',
  '1d': '1d',
};

const DEFAULT_TIMEFRAMES: readonly AggregationTimeframeKey[] = ['1sec', '1min', '5min', '15min', '1h', '1d'];

type OrderSummary = {
  orderId?: string;
  state?: string;
  assetClass?: string;
  symbol?: string;
  side?: string;
  quantity?: number;
  filledQuantity?: number;
  averagePrice?: number;
  triggerPrice?: number;
};

type HeaderEntry = { name: string; value: string };
type HeaderEntries = readonly HeaderEntry[];

const ORDER_DEFAULT_ORIGIN = 'https://robinhood.com';

const normalizeTelemetryDate = (input: string | null | undefined): string => {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const parsed = DateTime.fromISO(input, { zone: 'utc' });
    if (parsed.isValid) {
      return parsed.toFormat('yyyy-MM-dd');
    }
  }
  const now = DateTime.utc();
  return now.isValid ? now.toFormat('yyyy-MM-dd') : new Date().toISOString().slice(0, 10);
};

const ensureOrderTelemetryDir = (date: string): { baseDir: string; rawDir: string } => {
  const normalized = normalizeTelemetryDate(date);
  const baseDir = path.join(process.cwd(), 'data', 'app', 'streams', 'orders', normalized);
  ensureDirectorySync(baseDir);
  const rawDir = path.join(baseDir, 'raw');
  ensureDirectorySync(rawDir);
  return { baseDir, rawDir };
};

const resolveUtcDateFromTimestamp = (timestampMs: number): string => {
  const resolved = DateTime.fromMillis(timestampMs, { zone: 'utc' });
  if (resolved.isValid) {
    return resolved.toFormat('yyyy-MM-dd');
  }
  return new Date(timestampMs).toISOString().slice(0, 10);
};

const toHeaderLookup = (entries: HeaderEntries): Map<string, string> => {
  const lookup = new Map<string, string>();
  for (const entry of entries) {
    lookup.set(entry.name.toLowerCase(), entry.value);
  }
  return lookup;
};

const formatHeadersBlock = (entries: HeaderEntries, options: { omitAuthorization?: boolean } = {}): string => {
  const lines: string[] = [];
  for (const { name, value } of entries) {
    if (options.omitAuthorization && name.toLowerCase() === 'authorization') {
      continue;
    }
    lines.push(`${name}: ${value}`);
  }
  return lines.join('\n');
};

const ORDER_UPDATE_TOPICS = [
  'equity_order_update',
  'option_order_update',
  'crypto_order_update',
  'futures_order_update',
] as const;

const normaliseTopic = (topic: string): string => topic.trim().toLowerCase();

export const isOrderUpdateWs = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    const topics = parsed
      .searchParams
      .getAll('topic')
      .map(normaliseTopic)
      .filter(Boolean);
    if (topics.length !== ORDER_UPDATE_TOPICS.length) {
      return false;
    }
    const remaining = new Set<string>(ORDER_UPDATE_TOPICS);
    for (const topic of topics) {
      if (!remaining.delete(topic)) {
        return false;
      }
    }
    return remaining.size === 0;
  } catch (error) {
    void error;
    return false;
  }
};

const collectOrderTopics = (url: string): string => {
  try {
    const parsed = new URL(url);
    const topics = parsed.searchParams.getAll('topic');
    return topics.join(',');
  } catch (error) {
    void error;
    return '';
  }
};

const parseServerIdleTimeoutMs = (headers: Map<string, string>): number | undefined => {
  const candidates = [
    headers.get('x-server-idle-timeout-ms'),
    headers.get('server-idle-timeout-ms'),
    headers.get('x-server-idle-timeout'),
    headers.get('server-idle-timeout'),
  ];
  for (const candidate of candidates) {
    const resolved = toFiniteNumber(candidate);
    if (typeof resolved === 'number') {
      return resolved;
    }
  }
  return undefined;
};

const safeJsonParse = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text);
  } catch (error) {
    void error;
    return undefined;
  }
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const decodeBase64 = (input: string): string | undefined => {
  try {
    return Buffer.from(input, 'base64').toString('utf8');
  } catch (error) {
    void error;
    return undefined;
  }
};

const resolveServerTimestamp = (value: unknown): number | undefined => {
  const direct = toFiniteNumber(value);
  if (typeof direct === 'number') {
    return direct;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const candidates: readonly unknown[] = [
    record.serverTsMs,
    record.server_ts_ms,
    record.server_ts,
    record.ts,
    record.timestamp,
  ];
  for (const candidate of candidates) {
    const resolved = toFiniteNumber(candidate);
    if (typeof resolved === 'number') {
      return resolved;
    }
  }
  return undefined;
};

const resolveHeartbeatPayload = (
  payload: unknown,
): { opCode: number; dataBase64: string } | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const opCandidate = record.opCode ?? record.opcode;
  const opCode = toFiniteNumber(opCandidate);
  if (typeof opCode !== 'number' || !HEARTBEAT_OPCODES.has(opCode)) {
    return null;
  }
  const dataText = typeof record.data === 'string' ? record.data : undefined;
  if (!dataText) {
    return null;
  }
  return { opCode, dataBase64: dataText };
};

const resolveHeartbeatServerTimestamp = (dataBase64: string): number | undefined => {
  const decoded = decodeBase64(dataBase64);
  if (!decoded) {
    return undefined;
  }
  const decodedValue = safeJsonParse(decoded) ?? decoded;
  return resolveServerTimestamp(decodedValue);
};

const escapeCsvValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const looksLikeOrderRecord = (record: Record<string, unknown>): boolean => {
  let score = 0;
  let hasPrimaryKey = false;
  for (const key of ORDER_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      score += 1;
      if (key === 'order_id' || key === 'orderId' || key === 'orderID' || key === 'id' || key === 'symbol') {
        hasPrimaryKey = true;
      }
    }
  }
  return hasPrimaryKey && score >= 3;
};

const collectOrderRecords = (value: unknown): Record<string, unknown>[] => {
  const results: Record<string, unknown>[] = [];
  const visit = (node: unknown): void => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== 'object') {
      return;
    }
    const record = node as Record<string, unknown>;
    if (looksLikeOrderRecord(record)) {
      results.push(record);
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(value);
  return results;
};

const buildOrderSummary = (record: Record<string, unknown>): OrderSummary | null => {
  const summary: OrderSummary = {};
  const orderId =
    normalizeText(record.order_id) ||
    normalizeText(record.orderId) ||
    normalizeText(record.orderID) ||
    normalizeText(record.id);
  if (orderId) {
    summary.orderId = orderId;
  }
  const state = normalizeText(record.state);
  if (state) {
    summary.state = state;
  }
  const assetClass = normalizeText(record.asset_class) || normalizeText(record.assetClass);
  if (assetClass) {
    summary.assetClass = assetClass;
  }
  const symbol = normalizeText(record.symbol);
  if (symbol) {
    summary.symbol = symbol;
  }
  const side = normalizeText(record.side);
  if (side) {
    summary.side = side;
  }
  const quantity = toFiniteNumber(record.quantity ?? record.qty);
  if (typeof quantity === 'number') {
    summary.quantity = quantity;
  }
  const filledQuantity = toFiniteNumber(record.filled_quantity ?? record.cumulative_quantity);
  if (typeof filledQuantity === 'number') {
    summary.filledQuantity = filledQuantity;
  }
  const averagePrice = toFiniteNumber(record.average_price ?? record.price);
  if (typeof averagePrice === 'number') {
    summary.averagePrice = averagePrice;
  }
  const triggerPrice = toFiniteNumber(record.trigger_price);
  if (typeof triggerPrice === 'number') {
    summary.triggerPrice = triggerPrice;
  }
  return Object.keys(summary).length ? summary : null;
};

const AGGREGATION_TIMEFRAME_ALIASES: Record<string, AggregationTimeframeKey> = {
  '1s': '1sec',
  '1sec': '1sec',
  '1second': '1sec',
  '1seconds': '1sec',
  s: '1sec',
  sec: '1sec',
  seconds: '1sec',
  '1m': '1min',
  '1min': '1min',
  '1minute': '1min',
  '1minutes': '1min',
  m: '1min',
  min: '1min',
  minute: '1min',
  minutes: '1min',
  '5m': '5min',
  '5min': '5min',
  '5minute': '5min',
  '5minutes': '5min',
  '15m': '15min',
  '15min': '15min',
  '15minute': '15min',
  '15minutes': '15min',
  '60m': '1h',
  '60min': '1h',
  '1h': '1h',
  '1hour': '1h',
  '1hours': '1h',
  hour: '1h',
  hours: '1h',
  '24h': '1d',
  '1d': '1d',
  '1day': '1d',
  '1days': '1d',
  day: '1d',
  days: '1d',
};

const normalizeAggregationTimeframe = (value: string): AggregationTimeframeKey | null => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed in AGGREGATION_SPECS) {
    return trimmed as AggregationTimeframeKey;
  }

  const alias = AGGREGATION_TIMEFRAME_ALIASES[trimmed];
  if (alias) {
    return alias;
  }

  const sanitized = trimmed.replace(/[^0-9a-z]+/g, '');
  if (!sanitized) {
    return null;
  }

  if (sanitized in AGGREGATION_SPECS) {
    return sanitized as AggregationTimeframeKey;
  }

  const sanitizedAlias = AGGREGATION_TIMEFRAME_ALIASES[sanitized];
  if (sanitizedAlias) {
    return sanitizedAlias;
  }

  if (/^\d+$/.test(sanitized)) {
    const candidate = `${sanitized}min`;
    const minutesAlias = AGGREGATION_TIMEFRAME_ALIASES[candidate];
    if (minutesAlias) {
      return minutesAlias;
    }
    if (candidate in AGGREGATION_SPECS) {
      return candidate as AggregationTimeframeKey;
    }
  }

  if (/^\d+m$/.test(sanitized)) {
    const candidate = `${sanitized.slice(0, -1)}min`;
    if (candidate in AGGREGATION_SPECS) {
      return candidate as AggregationTimeframeKey;
    }
    const candidateAlias = AGGREGATION_TIMEFRAME_ALIASES[candidate];
    if (candidateAlias) {
      return candidateAlias;
    }
  }

  if (/^\d+h$/.test(sanitized)) {
    const candidateAlias = AGGREGATION_TIMEFRAME_ALIASES[sanitized];
    if (candidateAlias) {
      return candidateAlias;
    }
  }

  if (/^\d+d$/.test(sanitized)) {
    const candidateAlias = AGGREGATION_TIMEFRAME_ALIASES[sanitized];
    if (candidateAlias) {
      return candidateAlias;
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

const isMarketHours = (now: number): boolean => {
  const dt = DateTime.fromMillis(now, { zone: MARKET_TZ });
  if (!dt.isValid) {
    return false;
  }

  if (dt.weekday === 6 || dt.weekday === 7) {
    return false;
  }

  const minutes = dt.hour * 60 + dt.minute;
  return minutes >= MARKET_OPEN_MINUTES && minutes <= MARKET_CLOSE_MINUTES;
};

const computeLagMs = (now: number, timestamps: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [key, ts] of Object.entries(timestamps)) {
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
      out[key] = now - ts;
    }
  }
  return out;
};

export type SocketSnifferOptions = {
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
  readonly start?: string;
  readonly end?: string;
  readonly assetClassHint?: string;
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

type LogEntry = Serializable & {
  readonly ts: number;
};

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
  if (!shouldProcessLegendWSStrict(entry.url)) {
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
  normalizedSymbols: readonly string[],
  fallbackSymbol: string,
  meta: { start?: string; end?: string } = {},
  assetClassHint?: string,
): Promise<() => void> {
  const baseDir = path.dirname(logPath);
  const baseName = path.basename(logPath, '.jsonl');
  const effectiveSymbols = normalizedSymbols.length > 0 ? normalizedSymbols : ['GENERAL'];
  const defaultSymbol = fallbackSymbol || effectiveSymbols[0] || 'GENERAL';

  const generalWriter = new RotatingWriter(path.join(baseDir, `${baseName}.jsonl`), ROTATE_POLICY);
  const statsWriter = new RotatingWriter(
    path.join(baseDir, 'stats.csv'),
    ROTATE_POLICY,
    CSV_HEADER_TEXT.stats,
  );
  const VERBOSE = false; // Cambiado a false para reducir ruido por defecto

  const writeGeneral = (entry: Serializable) => {
    const payload: LogEntry = { ts: Date.now(), ...entry };
    generalWriter.write(JSON.stringify(payload));
  };

  const websocketCleanupMap = new Map<WebSocket, () => void>();
  const orderRawStreamsByDay = new Map<string, WriteStream>();
  const heartbeatStreamsByDay = new Map<string, WriteStream>();
  const sessionIndexStreamsByDay = new Map<string, WriteStream>();

  const ensureCsvStream = (filePath: string, header: string): WriteStream => {
    ensureDirectoryForFileSync(filePath);
    const needsHeader = !existsSync(filePath) || statSync(filePath).size === 0;
    const stream = createWriteStream(filePath, { flags: 'a' });
    if (needsHeader) {
      stream.write(`${header}\n`);
    }
    return stream;
  };

  const ensureOrderRawStream = (day: string): WriteStream => {
    let stream = orderRawStreamsByDay.get(day);
    if (!stream) {
      const { rawDir } = ensureOrderTelemetryDir(day);
      const filePath = path.join(rawDir, `orders_${day}.jsonl`);
      ensureDirectoryForFileSync(filePath);
      stream = createWriteStream(filePath, { flags: 'a' });
      orderRawStreamsByDay.set(day, stream);
    }
    return stream;
  };

  const ensureHeartbeatStream = (day: string): WriteStream => {
    let stream = heartbeatStreamsByDay.get(day);
    if (!stream) {
      const { baseDir } = ensureOrderTelemetryDir(day);
      const filePath = path.join(baseDir, 'heartbeats.csv');
      stream = ensureCsvStream(filePath, ORDER_HEARTBEATS_HEADER);
      heartbeatStreamsByDay.set(day, stream);
    }
    return stream;
  };

  const ensureSessionIndexStream = (day: string): WriteStream => {
    let stream = sessionIndexStreamsByDay.get(day);
    if (!stream) {
      const { baseDir } = ensureOrderTelemetryDir(day);
      const filePath = path.join(baseDir, 'session_index.csv');
      stream = ensureCsvStream(filePath, ORDER_SESSION_INDEX_HEADER);
      sessionIndexStreamsByDay.set(day, stream);
    }
    return stream;
  };

  const closeStreamMap = (map: Map<string, WriteStream>) => {
    for (const stream of map.values()) {
      stream.close();
    }
    map.clear();
  };

  const appendHeartbeatRow = (params: {
    url: string;
    direction: WsFrameDirection;
    opCode: number;
    dataBase64: string;
  }) => {
    const snapshotTsMs = Date.now();
    const day = resolveUtcDateFromTimestamp(snapshotTsMs);
    const stream = ensureHeartbeatStream(day);
    const row = [
      escapeCsvValue(snapshotTsMs),
      escapeCsvValue(day),
      escapeCsvValue(params.url),
      escapeCsvValue(params.direction),
      escapeCsvValue(params.opCode),
      escapeCsvValue(params.dataBase64),
      '',
    ].join(',');
    stream.write(`${row}\n`);
  };

  const appendSessionIndexRow = (params: {
    startTs: number;
    url: string;
    topics: string;
    userAgent?: string;
    origin?: string;
    responseHeaders: HeaderEntries;
  }) => {
    const day = resolveUtcDateFromTimestamp(params.startTs);
    const stream = ensureSessionIndexStream(day);
    const responseLookup = toHeaderLookup(params.responseHeaders);
    const idleTimeout = parseServerIdleTimeoutMs(responseLookup);
    const row = [
      escapeCsvValue(params.startTs),
      escapeCsvValue(day),
      escapeCsvValue(params.url),
      escapeCsvValue(params.topics),
      escapeCsvValue(idleTimeout ?? ''),
      escapeCsvValue(params.userAgent ?? ''),
      escapeCsvValue(params.origin ?? ORDER_DEFAULT_ORIGIN),
    ].join(',');
    stream.write(`${row}\n`);
  };

  const handleOrderWsRequest = (request: Request) => {
    if (request.resourceType() !== 'websocket') {
      return;
    }
    const url = request.url();
    if (!url.startsWith(ROBINHOOD_STREAMING_WS_PREFIX)) {
      return;
    }
    if (!isOrderUpdateWs(url)) {
      writeGeneral({ kind: 'order-ws-ignore', reason: 'unexpected-topics', url });
      return;
    }
    const startTs = Date.now();
    const day = resolveUtcDateFromTimestamp(startTs);
    const { rawDir } = ensureOrderTelemetryDir(day);
    const rawFilePath = path.join(rawDir, `wss_connect_${startTs}.txt`);
    const requestHeaders = request.headersArray();
    const requestLookup = toHeaderLookup(requestHeaders);
    const requestBlock = [
      `REQUEST ${request.method()} ${url}`,
      formatHeadersBlock(requestHeaders, { omitAuthorization: true }),
    ]
      .filter(Boolean)
      .join('\n');
    const topics = collectOrderTopics(url);
    const userAgent = requestLookup.get('user-agent');
    const origin = requestLookup.get('origin') ?? ORDER_DEFAULT_ORIGIN;

    void (async () => {
      try {
        const response = await request.response().catch(() => null);
        const responseHeaders = response ? response.headersArray() : [];
        const responseLine = response
          ? `RESPONSE ${response.status()} ${response.statusText()}`
          : 'RESPONSE <unavailable>';
        const responseBlock = [responseLine, formatHeadersBlock(responseHeaders)]
          .filter(Boolean)
          .join('\n');
        const fileContents = [requestBlock, '----', responseBlock].filter(Boolean).join('\n');
        await writeFile(rawFilePath, `${fileContents}\n`, 'utf8');
        appendSessionIndexRow({
          startTs,
          url,
          topics,
          userAgent,
          origin,
          responseHeaders,
        });
      } catch (error) {
        /* eslint-disable no-console */
        console.error('[socket-sniffer] Failed to persist order session handshake:', error);
        /* eslint-enable no-console */
      }
    })();
  };

  const handleLegendWsRequest = (request: Request) => {
    if (request.resourceType() !== 'websocket') {
      return;
    }
    const url = request.url();
    if (!shouldProcessLegendWS(url)) {
      return;
    }
    const timestampMs = Date.now();
    const method = request.method();
    const headers = request.headersArray();

    void (async () => {
      try {
        const response = await request.response().catch(() => null);
        await onLegendOpen({
          url,
          timestampMs,
          symbols: effectiveSymbols,
          assetClassHint: resolvedAssetClassHint,
          request: { method, headers },
          response: response
            ? {
                status: response.status(),
                statusText: response.statusText(),
                headers: response.headersArray(),
              }
            : undefined,
        });
      } catch (error) {
        console.warn('[socket-sniffer] Failed to persist legend handshake:', error);
      }
    })();
  };

  const persistOrderPayload = (params: {
    url: string;
    direction: WsFrameDirection;
    payload: unknown;
    text: string;
  }) => {
    const timestampMs = Date.now();
    const day = resolveUtcDateFromTimestamp(timestampMs);
    const stream = ensureOrderRawStream(day);
    const entry: Record<string, unknown> = {
      ts: timestampMs,
      url: params.url,
      direction: params.direction,
      payload: params.payload,
      text: params.text,
    };
    stream.write(`${JSON.stringify(entry)}\n`);
  };

  const handleOrderPayload = (params: {
    url: string;
    direction: WsFrameDirection;
    payload: unknown;
    text: string;
  }) => {
    const candidates = collectOrderRecords(params.payload);
    if (!candidates.length) {
      return;
    }
    const summaries = candidates
      .map((record) => buildOrderSummary(record))
      .filter((summary): summary is OrderSummary => summary !== null);
    if (!summaries.length) {
      return;
    }
    writeGeneral({
      kind: 'order-event',
      url: params.url,
      direction: params.direction,
      orders: summaries,
    });
    persistOrderPayload(params);
  };

  const resolveFrameText = (payload: string | Buffer | undefined): string | null => {
    if (typeof payload === 'string') {
      return payload;
    }
    if (Buffer.isBuffer(payload)) {
      return payload.toString('utf8');
    }
    return null;
  };

  const processWebSocketFrame = (params: {
    url: string;
    direction: WsFrameDirection;
    payload?: string | Buffer;
  }) => {
    const text = resolveFrameText(params.payload);
    if (!text) {
      return;
    }
    const parsed = safeJsonParse(text);
    if (parsed === undefined) {
      return;
    }
    const heartbeat = resolveHeartbeatPayload(parsed);
    if (heartbeat) {
      const now = Date.now();
      const serverTsMs = resolveHeartbeatServerTimestamp(heartbeat.dataBase64);
      if (typeof serverTsMs === 'number') {
        const skewMs = now - serverTsMs;
        writeGeneral({
          kind: 'ws-keepalive',
          url: params.url,
          opCode: heartbeat.opCode,
          serverTsMs,
          skewMs,
        });
      } else {
        writeGeneral({
          kind: 'ws-keepalive',
          url: params.url,
          opCode: heartbeat.opCode,
        });
      }
      appendHeartbeatRow({
        url: params.url,
        direction: params.direction,
        opCode: heartbeat.opCode,
        dataBase64: heartbeat.dataBase64,
      });
    }
    handleOrderPayload({
      url: params.url,
      direction: params.direction,
      payload: parsed,
      text,
    });
  };

  const cleanupWebSocket = (socket: WebSocket) => {
    const cleanup = websocketCleanupMap.get(socket);
    if (cleanup) {
      try {
        cleanup();
      } finally {
        websocketCleanupMap.delete(socket);
      }
    }
  };

  const cleanupAllWebSockets = () => {
    for (const socket of [...websocketCleanupMap.keys()]) {
      cleanupWebSocket(socket);
    }
  };

  const handleWebsocket = (socket: WebSocket) => {
    const url = socket.url();
    if (!url.startsWith(ROBINHOOD_STREAMING_WS_PREFIX)) {
      return;
    }
    if (!isOrderUpdateWs(url)) {
      writeGeneral({ kind: 'order-ws-ignore', reason: 'unexpected-topics', url });
      return;
    }
    const onFrameReceived = (frame: { payload: string | Buffer }) => {
      processWebSocketFrame({ url, direction: 'received', payload: frame.payload });
    };
    const onFrameSent = (frame: { payload: string | Buffer }) => {
      processWebSocketFrame({ url, direction: 'sent', payload: frame.payload });
    };
    const onClose = () => {
      cleanupWebSocket(socket);
    };
    socket.on('framereceived', onFrameReceived);
    socket.on('framesent', onFrameSent);
    socket.on('close', onClose);
    websocketCleanupMap.set(socket, () => {
      socket.off('framereceived', onFrameReceived);
      socket.off('framesent', onFrameSent);
      socket.off('close', onClose);
    });
  };

  page.on('websocket', handleWebsocket);
  page.on('request', handleOrderWsRequest);
  page.on('request', handleLegendWsRequest);

  const counts: StatsCounts = {
    ch1: 0,
    ch3: 0,
    ch5: 0,
    ch7: 0,
    ch9: 0,
    ch11: 0,
    ch13: 0,
    legendOptions: 0,
    legendNews: 0,
    other: 0,
    total: 0,
  };
  const lastWriteTs: Record<string, number> = {};
  const lastLagWarnAt = new Map<string, number>();
  let lastStatsSnapshotAt = 0;

  const checkLagThresholds = (now: number, lagMs: Record<string, number>) => {
    for (const [key, threshold] of Object.entries(LAG_WARN_THRESHOLDS_MS)) {
      const currentLag = lagMs[key];
      if (currentLag === undefined) {
        continue;
      }

      if (currentLag > threshold) {
        const previousWarnAt = lastLagWarnAt.get(key) ?? 0;
        if (now - previousWarnAt > LAG_WARN_COOLDOWN_MS) {
          writeGeneral({
            kind: 'lag-warn',
            source: 'health',
            key,
            lagMs: currentLag,
            thresholdMs: threshold,
          });
          lastLagWarnAt.set(key, now);
        }
      } else if (lastLagWarnAt.has(key)) {
        lastLagWarnAt.delete(key);
      }
    }
  };

  const writeStatsSnapshot = (now: number, force = false) => {
    if (!force && now - lastStatsSnapshotAt < STATS_SNAPSHOT_INTERVAL_MS) {
      return;
    }

    lastStatsSnapshotAt = now;
    const rss = typeof process.memoryUsage === 'function' ? process.memoryUsage().rss : undefined;
    const uptimeSec = Math.floor(process.uptime());
    const row = buildStatsCsvRow({
      ts: now,
      counts: { ...counts },
      rss,
      uptimeSec,
    });
    statsWriter.write(toCsvLine(CSV_HEADERS.stats, row));
  };

  const bump = (channel: number, n: number, options: { allowNoise?: boolean } = {}) => {
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }

    const { allowNoise = false } = options;

    const channelKey = `ch${channel}` as keyof StatsCounts;
    if (Object.prototype.hasOwnProperty.call(counts, channelKey)) {
      counts[channelKey] += n;
      counts.total += n;
      lastWriteTs[channelKey as string] = Date.now();
      return;
    }

    if (allowNoise) {
      counts.other += n;
      counts.total += n;
      lastWriteTs.other = Date.now();
    }
  };

  let closed = false;

  const normalizeSymbolKey = (input?: string | null): string | undefined => {
    if (!input) {
      return undefined;
    }
    const trimmed = input.trim();
    if (!trimmed) {
      return undefined;
    }
    const base = trimmed.includes('{') ? trimmed.slice(0, trimmed.indexOf('{')) : trimmed;
    const sanitized = base.replace(/[^0-9A-Za-z._/-]+/g, '').toUpperCase();
    return sanitized || undefined;
  };

  const resolveSymbolKey = (candidate?: string | null): string => normalizeSymbolKey(candidate) ?? defaultSymbol;

  const normalizeAssetClassHint = (hint: string | undefined): string | undefined => {
    if (!hint) {
      return undefined;
    }
    const trimmed = hint.trim();
    if (!trimmed) {
      return undefined;
    }
    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith('future')) {
      return 'futures';
    }
    if (lowered.startsWith('stock') || lowered.startsWith('equity')) {
      return 'stock';
    }
    return lowered;
  };

  const FUTURES_MONTH_PATTERN = /[FGHJKMNQUVXZ]\d{1,2}$/;
  const looksLikeFuturesSymbol = (symbol: string): boolean => {
    const sanitized = symbol.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (sanitized.length < 3) {
      return false;
    }
    return FUTURES_MONTH_PATTERN.test(sanitized);
  };

  const assetClassOverride = normalizeAssetClassHint(assetClassHint);
  const resolvedAssetClassHint = assetClassOverride ?? 'stock';
  const resolveAssetClassForSymbol = (symbol: string): string => {
    if (assetClassOverride) {
      return assetClassOverride;
    }
    return looksLikeFuturesSymbol(symbol) ? 'futures' : 'stock';
  };

  type CandleWriterEntry = { writer: WriteStream; lastTimestamp?: number; segment: string };
  type SymbolDataContext = {
    readonly symbol: string;
    readonly assetClass: string;
    readonly date: string;
    readonly baseDir: string;
    readonly rawWriter: WriteStream;
    readonly quoteWriter: WriteStream;
    readonly legendOptionsWriter: WriteStream;
    readonly newsWriter: WriteStream;
    readonly candleWriters: Map<string, CandleWriterEntry>;
  };

  const createFileWriter = (filePath: string, header?: string): WriteStream => {
    const exists = existsSync(filePath);
    ensureDirectoryForFileSync(filePath);
    const stream = createWriteStream(filePath, { flags: 'a' });
    if (!exists && header) {
      stream.write(`${header}\n`);
    }
    return stream;
  };

  const closeStream = (stream: WriteStream | undefined) => {
    if (!stream) {
      return;
    }
    const state = stream as WriteStream & { closed?: boolean };
    if (state.destroyed || state.closed) {
      return;
    }
    stream.end();
  };

  let activeDate = DateTime.utc().toFormat('yyyy-MM-dd');
  const symbolContexts = new Map<string, SymbolDataContext>();

  const createSymbolContext = (symbol: string): SymbolDataContext => {
    const assetClass = resolveAssetClassForSymbol(symbol);
    const baseDir = ensureSymbolDateDir({ assetClass, symbol, date: activeDate });
    writeGeneral({ kind: 'data-dir', symbol, assetClass, date: activeDate, baseDir });
    const rawWriter = createFileWriter(dataPath({ assetClass, symbol, date: activeDate }, 'raw.jsonl'));
    const quoteWriter = createFileWriter(
      dataPath({ assetClass, symbol, date: activeDate }, 'quotes.csv'),
      CSV_HEADER_TEXT.quote,
    );
    const legendOptionsWriter = createFileWriter(
      dataPath({ assetClass, symbol, date: activeDate }, 'options.jsonl'),
    );
    const newsWriter = createFileWriter(dataPath({ assetClass, symbol, date: activeDate }, 'news.jsonl'));
    return {
      symbol,
      assetClass,
      date: activeDate,
      baseDir,
      rawWriter,
      quoteWriter,
      legendOptionsWriter,
      newsWriter,
      candleWriters: new Map<string, CandleWriterEntry>(),
    };
  };

  const ensureSymbolContext = (symbol: string): SymbolDataContext => {
    const key = symbol.toUpperCase();
    const existing = symbolContexts.get(key);
    if (existing) {
      return existing;
    }
    const context = createSymbolContext(symbol);
    symbolContexts.set(key, context);
    return context;
  };

  const closeSymbolContext = (context: SymbolDataContext) => {
    closeStream(context.rawWriter);
    closeStream(context.quoteWriter);
    closeStream(context.legendOptionsWriter);
    closeStream(context.newsWriter);
    for (const entry of context.candleWriters.values()) {
      closeStream(entry.writer);
    }
    context.candleWriters.clear();
  };

  const closeAllSymbolContexts = () => {
    for (const context of symbolContexts.values()) {
      closeSymbolContext(context);
    }
    symbolContexts.clear();
  };

  const timeframeSegment = (timeframe: string): string => {
    const normalized = (timeframe || 'general').toLowerCase();
    const mapped = AGGREGATION_FILE_SEGMENTS[normalized as AggregationTimeframeKey];
    if (mapped) {
      return mapped;
    }
    if (!normalized || normalized === 'general') {
      return 'candles';
    }
    return normalized.replace(/[^0-9a-z]+/g, '-');
  };

  const getCandleWriter = (symbol: string, timeframe: string): CandleWriterEntry => {
    const context = ensureSymbolContext(symbol);
    const segment = timeframeSegment(timeframe);
    let entry = context.candleWriters.get(segment);
    if (!entry) {
      const filePath = dataPath({ assetClass: context.assetClass, symbol: context.symbol, date: context.date }, `${segment}.csv`);
      const writer = createFileWriter(filePath, CSV_HEADER_TEXT.candle);
      entry = { writer, segment };
      context.candleWriters.set(segment, entry);
    }
    return entry;
  };

  const bumpLegend = (key: 'legendOptions' | 'legendNews', n: number) => {
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }

    counts.total += n;
    counts[key] += n;
    lastWriteTs[key] = Date.now();
  };

  const resolveLegendPayloadSymbol = (payload: Record<string, unknown> | undefined): string | undefined => {
    if (!payload) {
      return undefined;
    }
    const symbolKeys = ['symbol', 'eventSymbol', 'ticker', 'underlyingSymbol'];
    for (const key of symbolKeys) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    const symbolList = payload.symbols;
    if (Array.isArray(symbolList)) {
      for (const value of symbolList) {
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
    }
    const rawData = payload.data;
    if (Array.isArray(rawData)) {
      for (const entry of rawData) {
        if (typeof entry === 'string' && entry.trim()) {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          const nested = resolveLegendPayloadSymbol(entry as Record<string, unknown>);
          if (nested) {
            return nested;
          }
        }
      }
    }
    return undefined;
  };

  const writeLegendSink = (
    key: 'legendOptions' | 'legendNews',
    payload: Record<string, unknown> | undefined,
  ) => {
    if (!payload) {
      return;
    }

    const now = Date.now();
    rotateDateIfNeeded(now);
    const symbolKey = resolveSymbolKey(resolveLegendPayloadSymbol(payload));
    const context = ensureSymbolContext(symbolKey);
    const writer = key === 'legendOptions' ? context.legendOptionsWriter : context.newsWriter;
    const base = {
      ts: now,
      symbol: symbolKey,
      channel: (payload as { channel?: unknown }).channel,
      type: (payload as { type?: unknown }).type,
      topic: (payload as { topic?: unknown }).topic,
    };

    const rawData = (payload as { data?: unknown }).data;
    if (Array.isArray(rawData) && rawData.length > 0) {
      bumpLegend(key, rawData.length);
      for (const item of rawData) {
        writer.write(
          `${JSON.stringify({
            ...base,
            data: item,
          })}\n`,
        );
      }
      return;
    }

    bumpLegend(key, 1);
    writer.write(
      `${JSON.stringify({
        ...base,
        payload,
      })}\n`,
    );
  };

  const enabledTimeframes = resolveEnabledTimeframes(process.env.BARS_TIMEFRAMES);
  type AggregationEntry = { readonly timeframe: AggregationTimeframeKey; readonly aggregator: BarAggregator };
  const aggregations = enabledTimeframes.map<AggregationEntry>((timeframe) => ({
    timeframe,
    aggregator: new BarAggregator({
      timeframe,
      periodMs: AGGREGATION_SPECS[timeframe].periodMs,
      preferNative: timeframe === '15min',
    }),
  }));
  const aggregationMap = new Map<AggregationTimeframeKey, AggregationEntry>();
  for (const entry of aggregations) {
    aggregationMap.set(entry.timeframe, entry);
  }
  const writeAggregatedBars = (bars: readonly AggregatedBarResult[]) => {
    if (!bars.length) {
      return;
    }
    const now = Date.now();
    for (const result of bars) {
      if (result.source === 'native') {
        continue;
      }
      const symbolKey = resolveSymbolKey(result.symbol);
      const entry = getCandleWriter(symbolKey, result.timeframe);
      const timestamp = result.bar.t;
      if (
        typeof timestamp === 'number' &&
        entry.lastTimestamp !== undefined &&
        timestamp < entry.lastTimestamp
      ) {
        continue;
      }
      if (typeof timestamp === 'number') {
        entry.lastTimestamp = timestamp;
      }
      entry.writer.write(`${toCsvLine(CSV_HEADERS.candle, buildBarCsvRow(result.bar))}\n`);
      lastWriteTs[`bar:${result.timeframe}`] = now;
    }
  };

  writeGeneral({ kind: 'boot', msg: 'socket-sniffer up', start: meta.start, end: meta.end });
  writeStatsSnapshot(Date.now(), true);

  function flushBars(now: number): void {
    for (const { aggregator } of aggregations) {
      const closed = aggregator.drainClosed(now);
      if (closed.length > 0) {
        writeAggregatedBars(closed);
      }
    }
  }

  function rotateDateIfNeeded(now: number): void {
    const nextDate = DateTime.fromMillis(now, { zone: 'utc' }).toFormat('yyyy-MM-dd');
    if (nextDate === activeDate) {
      return;
    }
    flushBars(now);
    closeAllSymbolContexts();
    activeDate = nextDate;
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    rotateDateIfNeeded(now);
    flushBars(now);
    writeStatsSnapshot(now);
  }, HEARTBEAT_INTERVAL_MS);

  const healthbeat = setInterval(() => {
    const now = Date.now();
    const rss = typeof process.memoryUsage === 'function' ? process.memoryUsage().rss : undefined;
    const lagMs = computeLagMs(now, lastWriteTs);
    writeGeneral({
      kind: 'health',
      ts: now,
      counts: { ...counts },
      lastWriteTs: { ...lastWriteTs },
      lagMs,
      rss,
      uptimeSec: Math.floor(process.uptime()),
    });
    checkLagThresholds(now, lagMs);
  }, HEALTH_INTERVAL_MS);

  let watchdogReloadInFlight = false;
  let lastWatchdogActionAt = 0;
  const watchdog = setInterval(() => {
    void (async () => {
      const now = Date.now();
      if (!isMarketHours(now)) {
        return;
      }

      const lastWrite = lastWriteTs[WATCHDOG_KEY];
      if (!lastWrite) {
        return;
      }

      if (now - lastWatchdogActionAt < WATCHDOG_COOLDOWN_MS) {
        return;
      }

      const lag = now - lastWrite;
      if (lag <= WATCHDOG_THRESHOLD_MS || watchdogReloadInFlight || page.isClosed()) {
        return;
      }

      watchdogReloadInFlight = true;
      try {
        writeGeneral({
          kind: 'watchdog-reload',
          key: WATCHDOG_KEY,
          lagMs: lag,
          thresholdMs: WATCHDOG_THRESHOLD_MS,
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        lastWatchdogActionAt = Date.now();
      } catch (error) {
        /* eslint-disable no-console */
        console.error('[socket-sniffer] watchdog reload failed:', error);
        /* eslint-enable no-console */
      } finally {
        watchdogReloadInFlight = false;
      }
    })();
  }, WATCHDOG_INTERVAL_MS);

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

  const writeChannelRows = (
    channel: number,
    rows: readonly unknown[],
    context: { allowNoise?: boolean; sourceUrl?: string } = {},
  ) => {
    if (!rows?.length) {
      return;
    }

    const { allowNoise = false, sourceUrl } = context;

    if (!allowNoise) {
      if (sourceUrl !== undefined && !isLegend(sourceUrl)) {
        return;
      }

      if (!LEGEND_CHANNELS.has(channel)) {
        return;
      }
    }

    const metadata = LEGEND_CHANNEL_METADATA[channel];
    bump(channel, rows.length, { allowNoise });

    let lastNow = Date.now();
    for (const row of rows) {
      const currentNow = Date.now();
      lastNow = currentNow;
      rotateDateIfNeeded(currentNow);
      const parsed = BaseEvent.safeParse(row ?? {});
      const event = parsed.success ? parsed.data : BaseEvent.parse({});
      const resolvedType = event.eventType ?? metadata?.resolvedType;
      const baseSymbol = resolveSymbolKey(resolveEventSymbol(event));
      const symbolContext = ensureSymbolContext(baseSymbol);

      if (resolvedType === 'Candle' && !isValidCandle(event)) {
        continue;
      }

      const normalized = normalizeDxFeedRow(channel, event);
      if (!parsed.success) {
        (normalized as Record<string, unknown>).raw = row;
      }
      (normalized as Record<string, unknown>).symbol = baseSymbol;
      symbolContext.rawWriter.write(`${JSON.stringify(normalized)}\n`);

      const eventTs = resolveEventTimestamp(event);
      if (typeof eventTs === 'number') {
        const lagMs = Date.now() - eventTs;
        if (lagMs > EVENT_LAG_WARN_THRESHOLD_MS) {
          writeGeneral({
            kind: 'lag-warn',
            channel,
            symbol: baseSymbol,
            lagMs,
            eventTs,
            thresholdMs: EVENT_LAG_WARN_THRESHOLD_MS,
          });
        }
      }

      if (resolvedType === 'Candle') {
        const candleRow = buildCandleCsvRow(event);
        if (candleRow) {
          const timeframe = resolveCandleTimeframe(event.eventSymbol);
          const candleEntry = getCandleWriter(baseSymbol, timeframe);
          const timestamp = typeof candleRow.t === 'number' ? candleRow.t : undefined;
          if (
            timestamp !== undefined &&
            candleEntry.lastTimestamp !== undefined &&
            timestamp < candleEntry.lastTimestamp
          ) {
            continue;
          }
          if (timestamp !== undefined) {
            candleEntry.lastTimestamp = timestamp;
          }
          candleRow.symbol = baseSymbol;
          candleEntry.writer.write(`${toCsvLine(CSV_HEADERS.candle, candleRow)}\n`);
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
          quoteRow.symbol = baseSymbol;
          symbolContext.quoteWriter.write(`${toCsvLine(CSV_HEADERS.quote, quoteRow)}\n`);
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
        if (shouldProcessLegendWS(entry.url)) {
          try {
            onLegendFrame({
              url: entry.url,
              timestampMs: Date.now(),
              payload: entry.parsed,
              symbols: effectiveSymbols,
              assetClassHint: resolvedAssetClassHint,
            });
          } catch (error) {
            console.warn('[socket-sniffer] Legend recorder failed:', error);
          }
        }
        legendClassification = classifyLegendWsMessage(entry);
        if (shouldIgnoreWsMessage(entry, legendClassification)) {
          return;
        }
      }

      writeGeneral(entry);

      if (isWsMessageEntry(entry)) {
        let cachedFeed: ReturnType<typeof extractFeed> | undefined;
        const resolveFeed = () => {
          if (cachedFeed === undefined) {
            cachedFeed = extractFeed(entry.parsed);
          }
          return cachedFeed;
        };
        const writeFeedIfValid = () => {
          const feed = resolveFeed();
          if (!feed || !feed.data.length) {
            return;
          }

          if (!isLegend(entry.url) || !LEGEND_CHANNELS.has(feed.channel)) {
            return;
          }

          writeChannelRows(feed.channel, feed.data, { sourceUrl: entry.url });
        };

        const classification = legendClassification ?? classifyLegendWsMessage(entry);
        if (classification.matched) {
          switch (classification.kind) {
            case 'marketdata':
              writeFeedIfValid();
              break;
            case 'options':
              writeLegendSink('legendOptions', classification.payload);
              break;
            case 'news':
              writeLegendSink('legendNews', classification.payload);
              break;
            case 'unknown':
              writeFeedIfValid();
              break;
            case 'ignore':
              break;
          }
        } else {
          writeFeedIfValid();
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
    clearInterval(watchdog);
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

    try {
      page.off('websocket', handleWebsocket);
    } catch (error) {
      void error;
    }
    try {
      page.off('request', handleOrderWsRequest);
    } catch (error) {
      void error;
    }
    try {
      page.off('request', handleLegendWsRequest);
    } catch (error) {
      void error;
    }
    cleanupAllWebSockets();
    closeStreamMap(orderRawStreamsByDay);
    closeStreamMap(heartbeatStreamsByDay);
    closeStreamMap(sessionIndexStreamsByDay);
    generalWriter.close();
    writeStatsSnapshot(Date.now(), true);
    closeAllSymbolContexts();
    statsWriter.close();

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

const sanitizeLogPrefix = (raw: string | undefined): string => {
  if (!raw) {
    return DEFAULT_PREFIX;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_PREFIX;
  }

  const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || DEFAULT_PREFIX;
};

const resolveLogBaseName = (prefix: string): string => `${prefix}-socket-sniffer`;

export async function runSocketSniffer(
  page: Page,
  options: SocketSnifferOptions = {},
): Promise<SocketSnifferHandle> {
  const symbols = normaliseSymbols(options.symbols ?? []);
  const logPrefix = sanitizeLogPrefix(options.logPrefix);
  const baseName = resolveLogBaseName(logPrefix);
  const logFile = path.join(process.cwd(), 'logs', `${baseName}.jsonl`);

  ensureDirectoryForFileSync(logFile);

  const normalizedSymbols = symbols.length > 0 ? symbols : ['GENERAL'];
  const fallbackSymbol = normalizedSymbols[0] ?? 'GENERAL';

  const closeLogger = await exposeLogger(
    page,
    logFile,
    normalizedSymbols,
    fallbackSymbol,
    {
      start: options.start,
      end: options.end,
    },
    options.assetClassHint,
  );

  const hookScriptString = buildHookPlainSource({
    wantedSymbols: symbols,
    maxTextLength: MAX_WS_ENTRY_TEXT_LENGTH,
    hookGuardFlag: HOOK_GUARD_FLAG,
  });

  try {
    await page.context().addInitScript({ content: hookScriptString });
  } catch (error) {
    console.warn('[socket-sniffer] addInitScript failed:', error);
  }

  const runHookInFrame = async (frame: Frame): Promise<void> => {
    if (!isHookableFrame(frame)) {
      return;
    }

    try {
      await frame.evaluate((script: string) => {
        // eslint-disable-next-line no-new-func
        const runner = new Function(script);
        runner();
      }, hookScriptString);
    } catch (error) {
      console.warn('[socket-sniffer] hook evaluate failed; continuing in CDP-only mode:', error);
    }
  };

  page.on('framenavigated', (frame) => {
    void runHookInFrame(frame);
  });

  await Promise.all(page.frames().map((frame) => runHookInFrame(frame)));

  const logPattern = path.join(process.cwd(), 'logs', `${baseName}*.jsonl`);

  const close = () => {
    closeLogger();
  };

  return {
    close,
    logPattern,
  } satisfies SocketSnifferHandle;
}

function buildHookPlainSource(params: {
  readonly wantedSymbols: readonly string[];
  readonly maxTextLength: number;
  readonly hookGuardFlag: string;
}): string {
  return `
${HOOK_POLYFILL}
(function __name_wrapper(){
  (function(params){
    const { wantedSymbols, maxTextLength, hookGuardFlag } = params || {};
    const globalObject = window;
    const guardKey = hookGuardFlag || '${HOOK_GUARD_FLAG}';
    const locationObject = globalObject && globalObject.location;
    const hostname = locationObject && typeof locationObject.hostname === 'string' ? locationObject.hostname : '';
    if (!/robinhood[.]com/i.test(hostname)) {
      return;
    }
    if (globalObject[guardKey]) {
      return;
    }

    globalObject[guardKey] = true;

    try {
      globalObject.__socketHookInstalled = true;
      if (globalObject.DEBUG_HOOKS) {
        console.log('[socket-sniffer][HOOK] instalado en', location.href);
      }
      globalObject.socketSnifferLog && globalObject.socketSnifferLog({ kind: 'hook-installed', href: location.href });
    } catch (error) {
      void error;
    }

    const upperSymbols = new Set((wantedSymbols || []).map((symbol) => {
      if (typeof symbol !== 'string') { return ''; }
      const text = symbol.trim();
      return text ? text.toUpperCase() : '';
    }).filter(Boolean));

    const shouldKeep = (payload) => {
      if (!upperSymbols.size) {
        return true;
      }
      if (!payload || typeof payload !== 'object') {
        return true;
      }
      const record = payload;
      const candidates = [
        record && record.data && record.data.eventSymbol,
        record && record.eventSymbol,
        record && record.symbol,
        record && record.result && record.result.symbol,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
          return upperSymbols.has(candidate.trim().toUpperCase());
        }
      }
      return true;
    };

    const truncate = (text) => {
      if (typeof text !== 'string') {
        return null;
      }
      return text.length > maxTextLength ? text.slice(0, maxTextLength) : text;
    };

    const safeLog = (entry) => {
      try {
        globalObject.socketSnifferLog && globalObject.socketSnifferLog(entry);
      } catch (error) {
        console.warn('[socket-sniffer] Error al enviar log:', error);
      }
    };

    // --- WebSocket hook ---
    (function(){
      const OriginalWebSocket = window.WebSocket;
      const originalSend = OriginalWebSocket.prototype.send;
      const LEGEND_WS_URL = 'wss://api.robinhood.com/marketdata/streaming/legend/';

      const normaliseUrl = (arg) => {
        if (typeof arg === 'string') {
          return arg;
        }
        if (arg instanceof URL) {
          return String(arg);
        }
        return '';
      };

      const shouldProcessLegendWs = (url) => {
        if (typeof url !== 'string') {
          return false;
        }
        const normalized = url.trim().toLowerCase();
        if (!normalized) {
          return false;
        }
        return normalized === LEGEND_WS_URL;
      };

      const emit = (kind, url, text, parsed) => {
        if (!shouldProcessLegendWs(url)) {
          return;
        }
        if (parsed && !shouldKeep(parsed)) {
          return;
        }
        const entry = { kind, url, text: truncate(text) };
        if (parsed !== undefined) {
          entry.parsed = parsed;
        }
        safeLog(entry);
      };

      function PatchedWebSocket(...args){
        const ws = new OriginalWebSocket(...args);
        const targetUrl = normaliseUrl(args && args[0]);

        ws.addEventListener('message', (event) => {
          let parsed;
          let text = null;
          if (typeof event.data === 'string') {
            text = event.data;
            try {
              parsed = JSON.parse(event.data);
            } catch (error) {
              void error;
            }
          }
          emit('ws-message', targetUrl, text, parsed);
        });

        return ws;
      }

      PatchedWebSocket.prototype = OriginalWebSocket.prototype;
      window.WebSocket = PatchedWebSocket;

      OriginalWebSocket.prototype.send = function patchedSend(data){
        let parsed;
        let text = null;
        if (typeof data === 'string') {
          text = data;
          try {
            parsed = JSON.parse(data);
          } catch (error) {
            void error;
          }
        }
        emit('ws-send', this && this.url, text, parsed);
        return originalSend.apply(this, [data]);
      };
    })();

    // --- fetch hook ---
    (function(){
      const originalFetch = window.fetch.bind(window);
      const WANT = /(marketdata|options|instruments|greeks|historicals)/i;

      window.fetch = async (...args) => {
        let url = '';
        const candidate = args[0];
        if (typeof candidate === 'string') {
          url = candidate;
        } else if (candidate instanceof Request) {
          url = candidate.url;
        } else if (candidate instanceof URL) {
          url = String(candidate);
        }

        const response = await originalFetch(...args);
        try {
          if (!WANT.test(url)) {
            return response;
          }
          const contentType = response.headers && response.headers.get && response.headers.get('content-type');
          const normalizedContentType =
            typeof contentType === 'string' ? contentType.toLowerCase() : '';
          if (!normalizedContentType.includes('application/json')) {
            return response;
          }
          const clone = response.clone();
          const text = await clone.text();
          safeLog({ kind: 'http', url, text: truncate(text) });
        } catch (error) {
          console.warn('[socket-sniffer] fetch hook error:', error);
        }
        return response;
      };
    })();

  })(${JSON.stringify(params)});
})();
`;
}

function isLegend(sourceUrl: string): boolean {
  return shouldProcessLegendWSStrict(sourceUrl);
}

