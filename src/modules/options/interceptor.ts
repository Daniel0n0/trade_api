import type { BrowserContext, Page, Response } from 'playwright';
import { DateTime } from 'luxon';

import { getCsvWriter } from '../../io/csvWriter.js';
import { dataPath } from '../../io/paths.js';
import { toCsvLine } from '../../io/row.js';
import type { UrlMode } from '../../orchestrator/messages.js';

const OPTION_HEADER = [
  't',
  'chainSymbol',
  'occSymbol',
  'instrumentId',
  'expiration',
  'dte',
  'strike',
  'type',
  'bid',
  'ask',
  'mark',
  'last',
  'volume',
  'openInterest',
  'impliedVolatility',
  'delta',
  'gamma',
  'theta',
  'vega',
  'rho',
  'underlyingPrice',
  'source',
] as const;

export type OptionCsvHeader = typeof OPTION_HEADER;
export type OptionCsvRow = Partial<Record<OptionCsvHeader[number], string | number | undefined>>;

const OPTION_HEADER_TEXT = OPTION_HEADER.join(',');

const OPTION_URL_PATTERN = /(marketdata\/options|\/options\/|\/options_chains\/|\/option_marketdata)/i;
const JSON_MIME_PATTERN = /application\/json/i;

const SYMBOL_REGEX = /^(?:[A-Z]+:)?([A-Z.]{1,6})\d{6}[CP]/i;
const EXPIRATION_CLEANER = /T.*$/;

const NUMBER_KEYS: Record<string, readonly string[]> = {
  strike: ['strike_price', 'strikePrice', 'strike'],
  bid: ['bid_price', 'bidPrice', 'bid'],
  ask: ['ask_price', 'askPrice', 'ask'],
  mark: ['mark_price', 'markPrice'],
  last: ['last_trade_price', 'lastTradePrice', 'last_price', 'lastPrice'],
  volume: ['volume'],
  openInterest: ['open_interest', 'openInterest'],
  impliedVolatility: ['implied_volatility', 'impliedVolatility', 'mark_iv', 'markIv'],
  delta: ['delta'],
  gamma: ['gamma'],
  theta: ['theta'],
  vega: ['vega'],
  rho: ['rho'],
  underlyingPrice: ['underlying_price', 'underlyingPrice', 'adjusted_underlying_price'],
};

const STRING_KEYS: Record<string, readonly string[]> = {
  chainSymbol: ['chain_symbol', 'chainSymbol', 'chain'],
  occSymbol: ['symbol', 'occ_symbol', 'occSymbol'],
  instrumentId: ['instrument_id', 'instrumentId', 'id', 'option_id', 'optionId'],
  optionType: ['option_type', 'optionType', 'type', 'call_put'],
  expiration: ['expiration_date', 'expirationDate', 'expiry', 'expiration'],
};

const FLATTEN_KEYS = [
  'attributes',
  'market_data',
  'marketData',
  'greeks',
  'greeks_live',
  'greeksLive',
  'quote',
  'option',
  'instrument',
];

const OPTION_TYPE_TOKENS = new Set(['call', 'put', 'c', 'p']);

const sanitizeExpirationSegment = (expiration: string | undefined): string => {
  if (!expiration) {
    return 'undated';
  }
  return expiration.replace(/[^0-9a-zA-Z-]+/g, '-');
};

const normalizeExpiration = (raw: string | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const text = String(raw).trim();
  if (!text) {
    return undefined;
  }
  const cleaned = text.replace(EXPIRATION_CLEANER, '');
  const dt = DateTime.fromISO(cleaned, { zone: 'utc' });
  if (dt.isValid) {
    return dt.toISODate();
  }
  return undefined;
};

const normaliseOptionType = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (OPTION_TYPE_TOKENS.has(normalized)) {
    return normalized.startsWith('p') ? 'PUT' : 'CALL';
  }
  if (normalized.includes('call')) {
    return 'CALL';
  }
  if (normalized.includes('put')) {
    return 'PUT';
  }
  return undefined;
};

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseFloat(trimmed.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const flattenRecord = (record: Record<string, unknown>): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...record };
  for (const key of FLATTEN_KEYS) {
    const candidate = record[key];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    for (const [childKey, childValue] of Object.entries(candidate as Record<string, unknown>)) {
      if (!(childKey in merged)) {
        merged[childKey] = childValue;
      }
    }
  }
  return merged;
};

const extractString = (record: Record<string, unknown>, key: keyof typeof STRING_KEYS): string | undefined => {
  for (const candidateKey of STRING_KEYS[key]) {
    const value = record[candidateKey];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const extractNumber = (record: Record<string, unknown>, key: keyof typeof NUMBER_KEYS): number | undefined => {
  for (const candidateKey of NUMBER_KEYS[key]) {
    const value = record[candidateKey];
    const parsed = toNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
};

const deriveChainSymbol = (record: Record<string, unknown>): string | undefined => {
  const direct = extractString(record, 'chainSymbol');
  if (direct) {
    return direct.toUpperCase();
  }
  const occ = extractString(record, 'occSymbol');
  if (!occ) {
    return undefined;
  }
  const match = occ.match(SYMBOL_REGEX);
  if (match) {
    return match[1]?.toUpperCase();
  }
  if (occ.includes(' ')) {
    const token = occ.split(' ').shift();
    if (token) {
      return token.replace(/[^A-Z.]+/gi, '').toUpperCase() || undefined;
    }
  }
  return undefined;
};

const looksLikeOptionRecord = (record: Record<string, unknown>): boolean => {
  const flattened = flattenRecord(record);
  const occ = extractString(flattened, 'occSymbol');
  if (occ && SYMBOL_REGEX.test(occ)) {
    return true;
  }
  const expiration = extractString(flattened, 'expiration');
  if (!expiration) {
    return false;
  }
  const optionType = normaliseOptionType(extractString(flattened, 'optionType'));
  if (optionType) {
    return true;
  }
  if (extractNumber(flattened, 'strike') !== undefined && deriveChainSymbol(flattened)) {
    return true;
  }
  if (typeof flattened.greeks === 'object' && flattened.greeks !== null) {
    return true;
  }
  if (typeof flattened.market_data === 'object' && flattened.market_data !== null) {
    return true;
  }
  return false;
};

const collectOptionRecords = (payload: unknown): Record<string, unknown>[] => {
  const results: Record<string, unknown>[] = [];
  const visited = new Set<unknown>();
  const visit = (value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    if (looksLikeOptionRecord(record)) {
      results.push(flattenRecord(record));
      return;
    }
    for (const child of Object.values(record)) {
      visit(child);
    }
  };
  visit(payload);
  return results;
};

const computeDte = (expiration: string | undefined, now: DateTime): number | undefined => {
  if (!expiration) {
    return undefined;
  }
  const dt = DateTime.fromISO(expiration, { zone: 'utc' });
  if (!dt.isValid) {
    return undefined;
  }
  const diff = dt.plus({ days: 1 }).startOf('day').diff(now, 'days').days;
  return Number.isFinite(diff) ? Number(diff) : undefined;
};

const optionRowFromRecord = (
  record: Record<string, unknown>,
  meta: {
    readonly url: string;
    readonly now: DateTime;
    readonly allowedSymbols: ReadonlySet<string>;
    readonly horizonDays?: number;
    readonly primarySymbol?: string;
    readonly primaryExpiration?: string;
  },
): OptionCsvRow | null => {
  const chainSymbol = deriveChainSymbol(record) ?? meta.primarySymbol;
  if (!chainSymbol) {
    return null;
  }

  if (meta.allowedSymbols.size > 0 && !meta.allowedSymbols.has(chainSymbol.toUpperCase())) {
    return null;
  }

  const expiration = normalizeExpiration(extractString(record, 'expiration')) ?? meta.primaryExpiration;
  if (!expiration) {
    return null;
  }

  const dte = computeDte(expiration, meta.now);
  if (meta.horizonDays !== undefined && dte !== undefined && dte > meta.horizonDays) {
    return null;
  }

  const optionType = normaliseOptionType(extractString(record, 'optionType'));

  const row: OptionCsvRow = {
    t: meta.now.toMillis(),
    chainSymbol,
    occSymbol: extractString(record, 'occSymbol')?.toUpperCase(),
    instrumentId: extractString(record, 'instrumentId'),
    expiration,
    dte: dte !== undefined ? Number(dte.toFixed(6)) : undefined,
    strike: extractNumber(record, 'strike'),
    type: optionType,
    bid: extractNumber(record, 'bid'),
    ask: extractNumber(record, 'ask'),
    mark: extractNumber(record, 'mark'),
    last: extractNumber(record, 'last'),
    volume: extractNumber(record, 'volume'),
    openInterest: extractNumber(record, 'openInterest'),
    impliedVolatility: extractNumber(record, 'impliedVolatility'),
    delta: extractNumber(record, 'delta'),
    gamma: extractNumber(record, 'gamma'),
    theta: extractNumber(record, 'theta'),
    vega: extractNumber(record, 'vega'),
    rho: extractNumber(record, 'rho'),
    underlyingPrice: extractNumber(record, 'underlyingPrice'),
    source: meta.url,
  };

  return row;
};

const shouldProcessResponse = (response: Response): boolean => {
  const url = response.url();
  if (!OPTION_URL_PATTERN.test(url)) {
    return false;
  }
  const status = response.status();
  if (status >= 400) {
    return false;
  }
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  if (!contentType || !JSON_MIME_PATTERN.test(contentType)) {
    return false;
  }
  return true;
};

export type OptionsRecorderHandle = {
  readonly close: () => Promise<void>;
  readonly getPrimaryExpiration: () => string | undefined;
};

export type OptionsRecorderOptions = {
  readonly page: Page;
  readonly logPrefix: string;
  readonly symbols?: readonly string[];
  readonly optionsDate?: string;
  readonly horizonDays?: number;
  readonly urlMode?: UrlMode;
  readonly onPrimaryExpirationChange?: (expiration: string | undefined) => void;
  readonly updateInfo?: (info: Record<string, unknown>) => void;
};

export function installOptionsResponseRecorder(options: OptionsRecorderOptions): OptionsRecorderHandle {
  const { page, logPrefix, symbols = [], optionsDate, horizonDays, onPrimaryExpirationChange, updateInfo } = options;
  const context: BrowserContext = page.context();
  const allowedSymbols = new Set(symbols.map((symbol) => symbol.toUpperCase()));
  const primarySymbol = symbols[0];
  let primaryExpiration = normalizeExpiration(optionsDate);
  const writerMap = new Map<string, { path: string; write: (line: string) => void; stream: NodeJS.WritableStream }>();
  const pending = new Set<Promise<void>>();

  updateInfo?.({
    optionsSymbols: symbols,
    optionsUrlMode: options.urlMode ?? 'auto',
    optionsPrimaryExpiration: primaryExpiration,
  });

  const resolveWriter = (chainSymbol: string, expiration: string) => {
    const normalizedExpiration = sanitizeExpirationSegment(expiration);
    const symbolDir = chainSymbol || primarySymbol || 'OPTIONS';
    const key = `${symbolDir}__${normalizedExpiration}`;
    let entry = writerMap.get(key);
    if (!entry) {
      const targetPath = dataPath(symbolDir, `${logPrefix}-options-${normalizedExpiration}.csv`);
      const stream = getCsvWriter(targetPath, OPTION_HEADER_TEXT);
      const write = (line: string) => {
        stream.write(`${line}\n`);
      };
      entry = { path: targetPath, write, stream };
      writerMap.set(key, entry);
    }
    return entry;
  };

  const updatePrimaryExpiration = (candidate: string | undefined) => {
    if (!candidate) {
      return;
    }
    if (primaryExpiration === candidate) {
      return;
    }
    primaryExpiration = candidate;
    onPrimaryExpirationChange?.(primaryExpiration);
    updateInfo?.({ optionsPrimaryExpiration: primaryExpiration });
  };

  const processResponse = async (response: Response) => {
    if (!shouldProcessResponse(response)) {
      return;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      console.warn('[options-interceptor] No se pudo parsear JSON:', error);
      return;
    }

    const records = collectOptionRecords(payload);
    if (records.length === 0) {
      return;
    }

    const now = DateTime.utc();
    const meta = {
      url: response.url(),
      now,
      allowedSymbols,
      horizonDays,
      primarySymbol,
      primaryExpiration,
    } as const;

    const rows: OptionCsvRow[] = [];
    for (const record of records) {
      const row = optionRowFromRecord(record, meta);
      if (!row) {
        continue;
      }
      rows.push(row);
    }

    if (rows.length === 0) {
      return;
    }

    const expirations = rows
      .map((row) => row.expiration)
      .filter((value): value is string => typeof value === 'string');
    if (expirations.length > 0) {
      const sorted = [...new Set(expirations)].sort();
      updatePrimaryExpiration(sorted[0]);
    }

    for (const row of rows) {
      const targetExpiration = row.expiration ?? primaryExpiration ?? 'undated';
      const targetSymbol = (row.chainSymbol ?? primarySymbol ?? 'OPTIONS').toUpperCase();
      const writer = resolveWriter(targetSymbol, targetExpiration);
      writer.write(toCsvLine(OPTION_HEADER, row));
    }

    updateInfo?.({
      optionsLastUrl: response.url(),
      optionsLastCount: rows.length,
      optionsPrimaryExpiration: primaryExpiration,
      optionsLastAt: now.toISO(),
    });
  };

  const handler = (response: Response) => {
    const task = processResponse(response);
    pending.add(task);
    task.finally(() => {
      pending.delete(task);
    });
  };

  context.on('response', handler);

  const close = async () => {
    context.off('response', handler);
    if (pending.size > 0) {
      await Promise.allSettled(Array.from(pending));
    }
    for (const entry of writerMap.values()) {
      const stream = entry.stream;
      if ('end' in stream && typeof stream.end === 'function') {
        stream.end();
      }
    }
    writerMap.clear();
  };

  return {
    close,
    getPrimaryExpiration: () => primaryExpiration,
  };
}

export {
  computeDte,
  collectOptionRecords,
  deriveChainSymbol,
  normalizeExpiration,
  optionRowFromRecord,
  normaliseOptionType,
};
