import path from 'node:path';
import { closeSync, createWriteStream, existsSync, openSync, statSync, type WriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { ensureDirectorySync, ensureDirectoryForFileSync } from '../io/dir.js';
import { ensureSymbolDateDir, sanitizeAssetClass } from '../io/paths.js';

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
const DEFAULT_ASSET_CLASS = 'stocks';
const LEGEND_PRIMARY_SYMBOL_FALLBACK = process.env.LEGEND_PRIMARY_SYMBOL ?? 'SPY';

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

type LegendOptionsWriterKey = 'trades' | 'quotes' | 'summaries' | 'greeks';

type LegendOptionsSymbolWriters = Partial<Record<LegendOptionsWriterKey, WriteStream>>;

type LegendDateContext = {
  readonly symbol: string;
  readonly date: string;
  readonly assetClass: string;
  readonly legendDir: string;
  readonly rawDir: string;
  readonly optionsBySymbolDir: string;
  readonly keepaliveWriter: WriteStream;
  readonly tradesWriter: WriteStream;
  readonly tradesEthWriter: WriteStream;
  readonly optionsAggregatedWriters: Record<LegendOptionsWriterKey, WriteStream>;
  readonly optionsSymbolWriters: Map<string, LegendOptionsSymbolWriters>;
};

const contextCache = new Map<string, LegendDateContext>();

const LEGEND_TRADE_TYPES = new Set(['Trade', 'TradeETH'] as const);

const SPY_SYMBOL = 'SPY';
const SPY_ASSET_CLASS = 'stocks';
const SPY_SOURCE_TRANSPORT = 'ws';
const SPY_CANDLE_HEADER =
  'timestamp,open,high,low,close,volume,vwap,count,imp_vol,event_flags,tf,session,source_transport,source_url';
const SPY_TRADE_HEADER = 'timestamp,price,day_volume,session,source_transport,source_url';
const SPY_ORDERBOOK_HEADER =
  'timestamp,bid_price,bid_size,ask_price,ask_size,spread,mid,source_transport,source_url';

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

const normalizeAssetClass = (hint: string | undefined): string => sanitizeAssetClass(hint) || DEFAULT_ASSET_CLASS;

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

const resolveLegendBaseSymbol = (symbols: readonly string[] | undefined): string => {
  const resolved = resolvePrimarySymbol(symbols);
  if (resolved && resolved !== DEFAULT_SYMBOL) {
    return resolved;
  }
  return sanitizeSymbol(LEGEND_PRIMARY_SYMBOL_FALLBACK);
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

const LEGEND_OPTIONS_EVENT_TYPE_TO_WRITER: Record<string, LegendOptionsWriterKey> = {
  TRADE: 'trades',
  TRADEETH: 'trades',
  QUOTE: 'quotes',
  SUMMARY: 'summaries',
  GREEKS: 'greeks',
};

const ensureLegendDateContext = (symbol: string, date: string, assetClass: string): LegendDateContext => {
  const symbolKey = sanitizeSymbol(symbol);
  const normalizedDate = resolveDateSegment(date);
  const cacheKey = `${process.cwd()}:${symbolKey}:${normalizedDate}:${assetClass}`;
  const cached = contextCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseDir = ensureSymbolDateDir({ assetClass, symbol: symbolKey, date: normalizedDate });
  const legendDir = path.join(baseDir, 'legend');
  ensureDirectorySync(legendDir);
  const rawDir = path.join(legendDir, 'raw');
  ensureDirectorySync(rawDir);
  const optionsDir = path.join(baseDir, 'options');
  ensureDirectorySync(optionsDir);
  const optionsBySymbolDir = path.join(optionsDir, 'by_symbol');
  ensureDirectorySync(optionsBySymbolDir);

  const keepalivePath = path.join(legendDir, 'keepalive.csv');
  const tradesPath = path.join(legendDir, 'trades.jsonl');
  const tradesEthPath = path.join(legendDir, 'trades_eth.jsonl');
  const optionsTradesPath = path.join(legendDir, 'options_trades.jsonl');
  const optionsQuotesPath = path.join(legendDir, 'options_quotes.jsonl');
  const optionsSummariesPath = path.join(legendDir, 'options_summaries.jsonl');
  const optionsGreeksPath = path.join(legendDir, 'options_greeks.jsonl');

  const keepaliveWriter = createAppendStream(keepalivePath, KEEPALIVE_HEADER);
  const tradesWriter = createAppendStream(tradesPath);
  const tradesEthWriter = createAppendStream(tradesEthPath);
  const optionsAggregatedWriters: Record<LegendOptionsWriterKey, WriteStream> = {
    trades: createAppendStream(optionsTradesPath),
    quotes: createAppendStream(optionsQuotesPath),
    summaries: createAppendStream(optionsSummariesPath),
    greeks: createAppendStream(optionsGreeksPath),
  };

  const context: LegendDateContext = {
    symbol: symbolKey,
    date: normalizedDate,
    assetClass,
    legendDir,
    rawDir,
    optionsBySymbolDir,
    keepaliveWriter,
    tradesWriter,
    tradesEthWriter,
    optionsAggregatedWriters,
    optionsSymbolWriters: new Map<string, LegendOptionsSymbolWriters>(),
  };
  contextCache.set(cacheKey, context);
  return context;
};

const createAppendStream = (filePath: string, header?: string): WriteStream => {
  ensureDirectoryForFileSync(filePath);
  const fileExists = existsSync(filePath);
  const needsHeader = header ? !fileExists || statSync(filePath).size === 0 : false;
  if (!fileExists) {
    const handle = openSync(filePath, 'a');
    closeSync(handle);
  }
  const stream = createWriteStream(filePath, { flags: 'a' });
  if (needsHeader && header) {
    stream.write(`${header}\n`);
  }
  return stream;
};

const spyCsvWriterCache = new Map<string, WriteStream>();

const getSpyCsvWriter = (filePath: string, header: string): WriteStream => {
  const existing = spyCsvWriterCache.get(filePath);
  if (existing) {
    return existing;
  }
  const writer = createAppendStream(filePath, header);
  spyCsvWriterCache.set(filePath, writer);
  return writer;
};

const appendSpyCsvRow = (
  filePath: string,
  header: string,
  values: readonly (string | number | undefined | null)[],
): void => {
  const writer = getSpyCsvWriter(filePath, header);
  const line = values
    .map((value) => {
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : '';
      }
      if (typeof value === 'string') {
        return value.replace(/\r?\n/gu, ' ');
      }
      return '';
    })
    .join(',');
  writer.write(`${line}\n`);
};

const isSpyEventSymbol = (value: string): boolean => value.trim().toUpperCase().startsWith(SPY_SYMBOL);

const SPY_TIMEFRAME_TOKEN_MAP: Record<string, string> = {
  d: '1d',
  h: '1h',
  '15': '15m',
  '5': '5m',
};

const resolveSpyTimeframe = (eventSymbol: string): string | undefined => {
  const match = /=([0-9a-z]+)/iu.exec(eventSymbol);
  if (!match) {
    return undefined;
  }
  const token = match[1].toLowerCase();
  return SPY_TIMEFRAME_TOKEN_MAP[token];
};

const ensureSpyDateDir = (timestampMs: number): string =>
  ensureSymbolDateDir({ assetClass: SPY_ASSET_CLASS, symbol: SPY_SYMBOL, date: formatUtcDate(timestampMs) });

const resolveOptionsWriterKey = (eventType: unknown): LegendOptionsWriterKey | undefined => {
  if (typeof eventType !== 'string') {
    return undefined;
  }
  const normalized = eventType.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  return LEGEND_OPTIONS_EVENT_TYPE_TO_WRITER[normalized];
};

const OPTIONS_SYMBOL_FILE_NAMES: Record<LegendOptionsWriterKey, string> = {
  trades: 'options_trades.jsonl',
  quotes: 'options_quotes.jsonl',
  summaries: 'options_summaries.jsonl',
  greeks: 'options_greeks.jsonl',
};

const ensureOptionsSymbolWriter = (
  context: LegendDateContext,
  eventSymbol: string,
  kind: LegendOptionsWriterKey,
): WriteStream => {
  const symbolKey = sanitizeSymbol(eventSymbol);
  const existing = context.optionsSymbolWriters.get(symbolKey) ?? {};
  if (existing[kind]) {
    return existing[kind] as WriteStream;
  }
  const symbolDir = path.join(context.optionsBySymbolDir, symbolKey);
  ensureDirectorySync(symbolDir);
  const filePath = path.join(symbolDir, OPTIONS_SYMBOL_FILE_NAMES[kind]);
  const writer = createAppendStream(filePath);
  const next = { ...existing, [kind]: writer };
  context.optionsSymbolWriters.set(symbolKey, next);
  return writer;
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

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const persistSpyCandle = (params: {
  entry: Record<string, unknown>;
  eventSymbol: string;
  sourceUrl: string;
}): void => {
  const timestamp = resolveNumber(params.entry.time);
  const open = resolveNumber(params.entry.open);
  const high = resolveNumber(params.entry.high);
  const low = resolveNumber(params.entry.low);
  const close = resolveNumber(params.entry.close);
  const volume = resolveNumber(params.entry.volume);
  const vwap = resolveNumber(params.entry.vwap);
  const count = resolveNumber(params.entry.count);
  const impVolatility = resolveNumber(params.entry.impVolatility);
  const impVol = resolveNumber(params.entry.impVol);
  const eventFlags =
    typeof params.entry.eventFlags === 'number' || typeof params.entry.eventFlags === 'string'
      ? params.entry.eventFlags
      : '';
  const session = /\btho=true\b/i.test(params.eventSymbol) ? 'rth+eth' : 'rth';
  const tf = resolveSpyTimeframe(params.eventSymbol);

  if (
    tf === undefined ||
    timestamp === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    volume === undefined
  ) {
    return;
  }

  const filePath = path.join(ensureSpyDateDir(timestamp), `${tf}.csv`);
  appendSpyCsvRow(filePath, SPY_CANDLE_HEADER, [
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    vwap,
    count,
    impVolatility ?? impVol,
    eventFlags,
    tf,
    session,
    SPY_SOURCE_TRANSPORT,
    params.sourceUrl,
  ]);
};

const persistSpyTradeCsv = (params: {
  entry: Record<string, unknown>;
  eventType: LegendTradeType;
  sourceUrl: string;
}): void => {
  const price = resolveNumber(params.entry.price);
  const dayVolume = resolveNumber(params.entry.dayVolume);
  const timestamp = resolveNumber(params.entry.time);
  if (price === undefined || dayVolume === undefined || timestamp === undefined) {
    return;
  }

  const session = params.eventType === 'TradeETH' ? 'eth' : 'rth';
  const filePath = path.join(ensureSpyDateDir(timestamp), '1sec_trades.csv');
  appendSpyCsvRow(filePath, SPY_TRADE_HEADER, [
    timestamp,
    price,
    dayVolume,
    session,
    SPY_SOURCE_TRANSPORT,
    params.sourceUrl,
  ]);
};

const persistSpyQuote = (params: { entry: Record<string, unknown>; sourceUrl: string }): void => {
  const bidPrice = resolveNumber(params.entry.bidPrice);
  const askPrice = resolveNumber(params.entry.askPrice);
  const bidSize = resolveNumber(params.entry.bidSize);
  const askSize = resolveNumber(params.entry.askSize);
  const bidTime = resolveNumber(params.entry.bidTime);
  const askTime = resolveNumber(params.entry.askTime);
  const fallbackTime = resolveNumber(params.entry.time);

  if (bidPrice === undefined || askPrice === undefined) {
    return;
  }

  const timestampCandidates = [bidTime, askTime, fallbackTime].filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value),
  );
  const timestamp = timestampCandidates.length ? Math.max(...timestampCandidates) : undefined;
  if (timestamp === undefined) {
    return;
  }

  const filePath = path.join(ensureSpyDateDir(timestamp), 'orderbook.csv');
  const spread = askPrice - bidPrice;
  const mid = (askPrice + bidPrice) / 2;
  appendSpyCsvRow(filePath, SPY_ORDERBOOK_HEADER, [
    timestamp,
    bidPrice,
    bidSize,
    askPrice,
    askSize,
    spread,
    mid,
    SPY_SOURCE_TRANSPORT,
    params.sourceUrl,
  ]);
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

export const shouldProcessLegendWSStrict = (url: string): boolean => {
  if (!shouldProcessLegendWS(url)) {
    return false;
  }
  return url.trim().toLowerCase() === LEGEND_WS_URL;
};

export async function onLegendOpen(params: LegendOpenParams): Promise<void> {
  if (!shouldProcessLegendWS(params.url)) {
    return;
  }
  const primarySymbol = resolveLegendBaseSymbol(params.symbols);
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
  const fallbackSymbol = resolveLegendBaseSymbol(params.symbols);

  if (typeValue === 'KEEPALIVE') {
    persistKeepalive({
      timestampMs: params.timestampMs,
      assetClass,
      symbol: fallbackSymbol,
    });
    return;
  }

  if (typeValue === 'FEED_CONFIG') {
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
      const eventSymbolValue = typeof entry.eventSymbol === 'string' ? entry.eventSymbol.trim() : '';
      if (eventSymbolValue.startsWith('.')) {
        const timestampForOptions = resolveNumber(entry.time) ?? params.timestampMs;
        persistOptionsPayload({
          assetClass,
          fallbackSymbol,
          eventSymbol: eventSymbolValue || fallbackSymbol,
          entry,
          eventType: typeof entry.eventType === 'string' ? entry.eventType : undefined,
          timestampMs: timestampForOptions,
        });
        continue;
      }
      if (isSpyEventSymbol(eventSymbolValue)) {
        const eventType = typeof entry.eventType === 'string' ? entry.eventType.trim() : '';
        if (eventType === 'Candle') {
          persistSpyCandle({ entry, eventSymbol: eventSymbolValue, sourceUrl: params.url });
          continue;
        }
        if (eventType === 'Trade' || eventType === 'TradeETH') {
          persistSpyTradeCsv({ entry, eventType: eventType as LegendTradeType, sourceUrl: params.url });
          continue;
        }
        if (eventType === 'Quote') {
          persistSpyQuote({ entry, sourceUrl: params.url });
          continue;
        }
      }
      const trade = resolveTradeRecord(entry, channel);
      if (!trade) {
        continue;
      }
      const normalizedEventSymbol = sanitizeSymbol(eventSymbolValue);
      const normalizedFallback = sanitizeSymbol(fallbackSymbol);
      if (normalizedEventSymbol !== normalizedFallback) {
        continue;
      }
      persistTrade({ trade, symbol: normalizedFallback, assetClass });
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

const persistOptionsPayload = (params: {
  assetClass: string;
  fallbackSymbol: string;
  eventSymbol: string;
  entry: Record<string, unknown>;
  eventType: string | undefined;
  timestampMs: number;
}): void => {
  const writerKey = resolveOptionsWriterKey(params.eventType);
  if (!writerKey) {
    return;
  }
  const dateSegment = formatUtcDate(params.timestampMs);
  try {
    const context = ensureLegendDateContext(params.fallbackSymbol, dateSegment, params.assetClass);
    const payload = JSON.stringify(params.entry);
    context.optionsAggregatedWriters[writerKey].write(`${payload}\n`);
    const symbolWriter = ensureOptionsSymbolWriter(context, params.eventSymbol, writerKey);
    symbolWriter.write(`${payload}\n`);
  } catch (error) {
    console.warn('[legend-advanced-recorder] Failed to write options payload:', error);
  }
};
