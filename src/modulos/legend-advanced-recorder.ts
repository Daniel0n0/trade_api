import path from 'node:path';
import { createWriteStream, existsSync, statSync, type WriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { ensureDirectorySync, ensureDirectoryForFileSync } from '../io/dir.js';
import { ensureSymbolDateDir } from '../io/paths.js';

const normalizeLegendUrl = (url: string): string => {
  if (!url) {
    return '';
  }
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  if (trimmed.endsWith('/legend')) {
    return `${trimmed}/`;
  }
  return trimmed.replace(/\/+$/u, '/');
};

const LEGEND_WS_URL = 'wss://api.robinhood.com/marketdata/streaming/legend/';
const NORMALIZED_LEGEND_URL = normalizeLegendUrl(LEGEND_WS_URL);
const KEEPALIVE_HEADER = 'ts_ms,date_utc,ws_url,channel,type';
const DEFAULT_SYMBOL = 'GENERAL';
const DEFAULT_ASSET_CLASS = 'stock';

export type LegendHeaderEntry = { readonly name: string; readonly value: string };

export type LegendOpenParams = {
  readonly url: string;
  readonly timestampMs: number;
  readonly symbols?: readonly string[];
  readonly assetClassHint?: string;
  readonly request: { readonly method: string; readonly headers: readonly LegendHeaderEntry[] };
  readonly response?: { readonly status: number; readonly statusText: string; readonly headers: readonly LegendHeaderEntry[] };
};

export type LegendFrameParams = {
  readonly url: string;
  readonly timestampMs: number;
  readonly symbols?: readonly string[];
  readonly assetClassHint?: string;
  readonly payload: unknown;
};

type LegendDateContext = {
  readonly symbol: string;
  readonly date: string;
  readonly assetClass: string;
  readonly baseDir: string;
  readonly rawDir: string;
  readonly keepaliveWriter: WriteStream;
  readonly tradesWriter: WriteStream;
  readonly tradesEthWriter: WriteStream;
};

const contextCache = new Map<string, LegendDateContext>();

const LEGEND_TRADE_TYPES = new Set(['Trade', 'TradeETH'] as const);

type LegendTradeType = 'Trade' | 'TradeETH';

type LegendTradeRecord = {
  readonly channel: number;
  readonly eventSymbol: string;
  readonly eventType: LegendTradeType;
  readonly price: number;
  readonly dayVolume: number;
  readonly time: number;
};

const formatUtcDate = (timestampMs: number): string => {
  if (!Number.isFinite(timestampMs)) {
    return new Date().toISOString().slice(0, 10);
  }
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sanitizeSymbol = (input: string | undefined): string => {
  if (!input) {
    return DEFAULT_SYMBOL;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_SYMBOL;
  }
  const sanitized = trimmed.replace(/[^0-9A-Za-z._/-]+/g, '').toUpperCase();
  return sanitized || DEFAULT_SYMBOL;
};

const normalizeAssetClass = (hint: string | undefined): string => {
  if (!hint) {
    return DEFAULT_ASSET_CLASS;
  }
  const trimmed = hint.trim();
  if (!trimmed) {
    return DEFAULT_ASSET_CLASS;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('future')) {
    return 'futures';
  }
  if (lowered.startsWith('crypto')) {
    return 'crypto';
  }
  if (lowered.startsWith('option')) {
    return 'stock';
  }
  if (lowered.startsWith('stock') || lowered.startsWith('equity')) {
    return 'stock';
  }
  return DEFAULT_ASSET_CLASS;
};

const resolvePrimarySymbol = (symbols: readonly string[] | undefined): string => {
  if (!symbols || symbols.length === 0) {
    return DEFAULT_SYMBOL;
  }
  for (const candidate of symbols) {
    const sanitized = sanitizeSymbol(candidate);
    if (sanitized && sanitized !== DEFAULT_SYMBOL) {
      return sanitized;
    }
  }
  return sanitizeSymbol(symbols[0]);
};

const resolveDateSegment = (input: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  const numeric = Number(input);
  if (Number.isFinite(numeric)) {
    return formatUtcDate(numeric);
  }
  const parsed = Date.parse(input);
  if (!Number.isNaN(parsed)) {
    return formatUtcDate(parsed);
  }
  return formatUtcDate(Date.now());
};

const ensureLegendDateContext = (symbol: string, date: string, assetClass: string): LegendDateContext => {
  const symbolKey = sanitizeSymbol(symbol);
  const normalizedDate = resolveDateSegment(date);
  const cacheKey = `${symbolKey}:${normalizedDate}:${assetClass}`;
  const cached = contextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseDir = ensureSymbolDateDir({ assetClass, symbol: symbolKey, date: normalizedDate });
  const legendDir = path.join(baseDir, 'legend');
  ensureDirectorySync(legendDir);
  const rawDir = path.join(legendDir, 'raw');
  ensureDirectorySync(rawDir);

  const keepalivePath = path.join(legendDir, 'keepalive.csv');
  const tradesPath = path.join(legendDir, 'trades.jsonl');
  const tradesEthPath = path.join(legendDir, 'trades_eth.jsonl');

  const keepaliveWriter = createAppendStream(keepalivePath, KEEPALIVE_HEADER);
  const tradesWriter = createAppendStream(tradesPath);
  const tradesEthWriter = createAppendStream(tradesEthPath);

  const context: LegendDateContext = {
    symbol: symbolKey,
    date: normalizedDate,
    assetClass,
    baseDir: legendDir,
    rawDir,
    keepaliveWriter,
    tradesWriter,
    tradesEthWriter,
  };
  contextCache.set(cacheKey, context);
  return context;
};

const createAppendStream = (filePath: string, header?: string): WriteStream => {
  ensureDirectoryForFileSync(filePath);
  const needsHeader = header ? !existsSync(filePath) || statSync(filePath).size === 0 : false;
  const stream = createWriteStream(filePath, { flags: 'a' });
  if (needsHeader && header) {
    stream.write(`${header}\n`);
  }
  return stream;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const resolveChannel = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const resolveNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const resolveTradeRecord = (
  input: Record<string, unknown>,
  fallbackChannel: number | undefined,
): LegendTradeRecord | undefined => {
  const eventTypeRaw = input.eventType;
  if (typeof eventTypeRaw !== 'string' || !LEGEND_TRADE_TYPES.has(eventTypeRaw as LegendTradeType)) {
    return undefined;
  }
  const eventSymbolRaw = input.eventSymbol;
  if (typeof eventSymbolRaw !== 'string' || !eventSymbolRaw.trim()) {
    return undefined;
  }
  const price = resolveNumber(input.price);
  const dayVolume = resolveNumber(input.dayVolume);
  const time = resolveNumber(input.time);
  const channel = resolveChannel(input.channel ?? fallbackChannel);
  if (!channel || price === undefined || dayVolume === undefined || time === undefined) {
    return undefined;
  }
  return {
    channel,
    eventSymbol: eventSymbolRaw,
    eventType: eventTypeRaw as LegendTradeType,
    price,
    dayVolume,
    time,
  };
};

const formatHeadersBlock = (entries: readonly LegendHeaderEntry[], options: { omitAuthorization?: boolean } = {}): string => {
  if (!entries.length) {
    return '';
  }
  const { omitAuthorization = false } = options;
  return entries
    .filter((entry) =>
      omitAuthorization ? entry.name.toLowerCase() !== 'authorization' : true,
    )
    .map((entry) => `${entry.name}: ${entry.value}`)
    .join('\n');
};

export const shouldProcessLegendWS = (url: string): boolean => {
  if (typeof url !== 'string') {
    return false;
  }
  return normalizeLegendUrl(url) === NORMALIZED_LEGEND_URL;
};

export async function onLegendOpen(params: LegendOpenParams): Promise<void> {
  if (!shouldProcessLegendWS(params.url)) {
    return;
  }
  const primarySymbol = resolvePrimarySymbol(params.symbols);
  const assetClass = normalizeAssetClass(params.assetClassHint);
  const dateSegment = formatUtcDate(params.timestampMs);
  const context = ensureLegendDateContext(primarySymbol, dateSegment, assetClass);

  const requestBlock = [
    `REQUEST ${params.request.method ?? 'GET'} ${params.url}`,
    formatHeadersBlock(params.request.headers, { omitAuthorization: true }),
  ]
    .filter(Boolean)
    .join('\n');

  const responseBlock = params.response
    ? [
        `RESPONSE ${params.response.status} ${params.response.statusText}`,
        formatHeadersBlock(params.response.headers),
      ]
        .filter(Boolean)
        .join('\n')
    : 'RESPONSE <unavailable>';

  const contents = [requestBlock, '----', responseBlock].filter(Boolean).join('\n');
  const filePath = path.join(context.rawDir, `ws_connect_${params.timestampMs}.txt`);
  try {
    await writeFile(filePath, `${contents}\n`, 'utf8');
  } catch (error) {
    console.warn('[legend-advanced-recorder] Failed to persist handshake:', error);
  }
}

export function onLegendFrame(params: LegendFrameParams): void {
  if (!shouldProcessLegendWS(params.url) || !isRecord(params.payload)) {
    return;
  }
  const typeValue = typeof params.payload.type === 'string' ? params.payload.type.trim().toUpperCase() : '';
  const assetClass = normalizeAssetClass(params.assetClassHint);
  const fallbackSymbol = resolvePrimarySymbol(params.symbols);

  if (typeValue === 'KEEPALIVE') {
    persistKeepalive({
      timestampMs: params.timestampMs,
      assetClass,
      symbol: fallbackSymbol,
    });
    return;
  }

  if (typeValue === 'FEED_DATA') {
    const channel = resolveChannel(params.payload.channel);
    const rawData = (params.payload as { data?: unknown }).data;
    if (!Array.isArray(rawData)) {
      return;
    }
    for (const entry of rawData) {
      if (!isRecord(entry)) {
        continue;
      }
      const trade = resolveTradeRecord(entry, channel);
      if (!trade) {
        continue;
      }
      const targetSymbol = sanitizeSymbol(entry.eventSymbol as string) || fallbackSymbol;
      persistTrade({ trade, symbol: targetSymbol, assetClass });
    }
  }
}

const persistKeepalive = (params: { timestampMs: number; symbol: string; assetClass: string }): void => {
  const dateSegment = formatUtcDate(params.timestampMs);
  try {
    const context = ensureLegendDateContext(params.symbol, dateSegment, params.assetClass);
    const row = [
      params.timestampMs,
      dateSegment,
      LEGEND_WS_URL,
      0,
      'KEEPALIVE',
    ].join(',');
    context.keepaliveWriter.write(`${row}\n`);
  } catch (error) {
    console.warn('[legend-advanced-recorder] Failed to write keepalive row:', error);
  }
};

const persistTrade = (params: { trade: LegendTradeRecord; symbol: string; assetClass: string }): void => {
  const dateSegment = formatUtcDate(params.trade.time);
  try {
    const context = ensureLegendDateContext(params.symbol, dateSegment, params.assetClass);
    const payload = JSON.stringify(params.trade);
    const writer = params.trade.eventType === 'Trade' ? context.tradesWriter : context.tradesEthWriter;
    writer.write(`${payload}\n`);
  } catch (error) {
    console.warn('[legend-advanced-recorder] Failed to write trade payload:', error);
  }
};
