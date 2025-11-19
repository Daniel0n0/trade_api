import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ensureDirectoryForFile } from '../../io/dir.js';
import { safeJsonParse } from '../../utils/payload.js';
import type { HttpClient } from '../instrument/index.js';

export type Timeframe = '5m' | '15m' | '1h';

export type RawSpyCandle = {
  readonly begins_at: string;
  readonly open_price: string | number;
  readonly high_price: string | number;
  readonly low_price: string | number;
  readonly close_price: string | number;
  readonly volume: string | number;
  readonly vwap?: string | number | null;
  readonly session?: string | null;
  readonly [key: string]: unknown;
};

export type SpyCandleRow = {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly vwap: number | null;
  readonly tf: Timeframe;
  readonly source_transport: 'http';
  readonly source_url: string;
};

// Fuente cruda de velas SPY:
//  - wss://api.robinhood.com/marketdata/streaming/legend/
//  - <<TODO_URL_5M_SPY>>, <<TODO_URL_15M_SPY>>, <<TODO_URL_1H_SPY>>  // HTTP fallback por tf
export const SPY_TF_ENDPOINTS: Record<Timeframe, string> = {
  '5m': '<<TODO_URL_5M_SPY>>',
  '15m': '<<TODO_URL_15M_SPY>>',
  '1h': '<<TODO_URL_1H_SPY>>',
};

const SPY_CSV_HEADER = 'timestamp,open,high,low,close,volume,vwap,source_transport,source_url';

const serializeRow = (row: SpyCandleRow): string =>
  [
    row.timestamp,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    row.vwap ?? '',
    row.source_transport,
    row.source_url,
  ].join(',');

export function resolveSpyPath(row: Pick<SpyCandleRow, 'timestamp' | 'tf'>): string {
  const date = new Date(row.timestamp);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');

  const dateStr = `${yyyy}-${mm}-${dd}`;
  return path.join(process.cwd(), 'data', 'stocks', 'SPY', dateStr, `${row.tf}.csv`);
}

export async function upsertSpyCandle(row: SpyCandleRow): Promise<void> {
  const filePath = resolveSpyPath(row);
  await ensureDirectoryForFile(filePath);

  const payload = serializeRow(row);
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.trim().split(/\r?\n/);
    const header = lines[0] || SPY_CSV_HEADER;
    const body = lines.slice(1).filter(Boolean);

    const tsStr = String(row.timestamp);
    let replaced = false;
    const newBody = body.map((line) => {
      const [ts] = line.split(',');
      if (ts === tsStr) {
        replaced = true;
        return payload;
      }
      return line;
    });

    if (!replaced) {
      newBody.push(payload);
      newBody.sort((a, b) => Number(a.split(',')[0]) - Number(b.split(',')[0]));
    }

    const normalisedHeader = header === SPY_CSV_HEADER ? header : SPY_CSV_HEADER;
    await writeFile(filePath, [normalisedHeader, ...newBody].join('\n') + '\n', 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    const headerLine = `${SPY_CSV_HEADER}\n`;
    await writeFile(filePath, `${headerLine}${payload}\n`, 'utf8');
  }
}

export function validateSpyCandle(raw: RawSpyCandle, tf: Timeframe): boolean {
  if (!raw.begins_at || typeof raw.begins_at !== 'string') {
    return false;
  }

  const numbers = [raw.open_price, raw.high_price, raw.low_price, raw.close_price, raw.volume].map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) {
    return false;
  }

  const [open, high, low, close, volume] = numbers;
  if (!(high >= open && high >= close && low <= open && low <= close && high >= low)) {
    return false;
  }

  if (volume < 0) {
    return false;
  }

  const timestamp = Date.parse(raw.begins_at);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const date = new Date(timestamp);
  if (date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) {
    return false;
  }

  const minutes = date.getUTCMinutes();
  if (tf === '5m' && minutes % 5 !== 0) {
    return false;
  }
  if (tf === '15m' && minutes % 15 !== 0) {
    return false;
  }
  if (tf === '1h' && minutes !== 0) {
    return false;
  }

  return true;
}

export function normalizeSpyCandle(raw: RawSpyCandle, tf: Timeframe, sourceUrl: string): SpyCandleRow {
  const timestamp = Date.parse(raw.begins_at);
  const vwapValue = Number(raw.vwap);

  return {
    timestamp,
    open: Number(raw.open_price),
    high: Number(raw.high_price),
    low: Number(raw.low_price),
    close: Number(raw.close_price),
    volume: Number(raw.volume),
    vwap: Number.isFinite(vwapValue) ? vwapValue : null,
    tf,
    source_transport: 'http',
    source_url: sourceUrl,
  };
}

type SanitizeSpyOptions = {
  readonly client: HttpClient;
  readonly tfs: readonly Timeframe[];
  readonly since?: string;
};

const extractCandles = (payload: unknown): RawSpyCandle[] => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload as RawSpyCandle[];
  }
  if (typeof payload === 'object') {
    const withResults = payload as { results?: unknown; candles?: unknown };
    if (Array.isArray(withResults.results)) {
      return withResults.results as RawSpyCandle[];
    }
    if (Array.isArray(withResults.candles)) {
      return withResults.candles as RawSpyCandle[];
    }
  }
  return [];
};

export async function sanitizeSpyTf(opts: SanitizeSpyOptions): Promise<void> {
  const sinceTimestamp = opts.since ? Date.parse(`${opts.since}T00:00:00Z`) : undefined;
  if (opts.since && !Number.isFinite(sinceTimestamp)) {
    throw new Error(`Fecha inválida para --since: ${opts.since}`);
  }

  for (const tf of opts.tfs) {
    const url = SPY_TF_ENDPOINTS[tf];
    const text = await opts.client.getText(url);
    const parsed = safeJsonParse<unknown>(text);
    const rawCandles = extractCandles(parsed);

    for (const raw of rawCandles) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }

      if (!validateSpyCandle(raw as RawSpyCandle, tf)) {
        continue;
      }

      const row = normalizeSpyCandle(raw as RawSpyCandle, tf, url);
      if (sinceTimestamp !== undefined && row.timestamp < sinceTimestamp) {
        continue;
      }

      await upsertSpyCandle(row);
    }
  }
}

export const fetchHttpClient: HttpClient = {
  async getText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falló la solicitud a ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  },
};
