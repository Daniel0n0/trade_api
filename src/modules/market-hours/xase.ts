import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { ensureDirectoryForFileSync } from '../../io/dir.js';
import { getDataRoot } from '../../io/paths.js';
import { upsertCsv, type CsvRowInput } from '../../io/upsertCsv.js';

const EXCHANGE_CODE = 'XASE' as const;

export const MARKET_HOURS_HEADER = [
  'date',
  'market',
  'is_open',
  'opens_at',
  'closes_at',
  'late_option_closes_at',
  'extended_opens_at',
  'extended_closes_at',
  'all_day_opens_at',
  'all_day_closes_at',
  'index_option_0dte_closes_at',
  'index_option_non_0dte_closes_at',
  'index_curb_opens_at',
  'index_curb_closes_at',
  'fx_is_open',
  'fx_opens_at',
  'fx_closes_at',
  'fx_next_open_hours',
  'previous_open_hours_url',
  'next_open_hours_url',
  'fetched_ts',
  'source_transport',
  'source_url',
] as const;

export type MarketHoursRow = CsvRowInput<typeof MARKET_HOURS_HEADER>;

type FetchLike = typeof fetch;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type SyncMarketHoursOptions = {
  readonly date?: string;
  readonly fetchImpl?: FetchLike;
  readonly baseDir?: string;
};

type NormalizeEnv = {
  readonly ts?: number;
  readonly source?: string;
  readonly transport?: string;
};

type MaybeRecord = Record<string, unknown> | undefined;

type MarketHoursRaw = {
  readonly date?: string;
  readonly is_open?: unknown;
  readonly opens_at?: unknown;
  readonly closes_at?: unknown;
  readonly late_option_closes_at?: unknown;
  readonly extended_opens_at?: unknown;
  readonly extended_closes_at?: unknown;
  readonly all_day_opens_at?: unknown;
  readonly all_day_closes_at?: unknown;
  readonly index_option_0dte_closes_at?: unknown;
  readonly index_option_non_0dte_closes_at?: unknown;
  readonly index_options_extended_hours?: MaybeRecord;
  readonly fx_is_open?: unknown;
  readonly fx_opens_at?: unknown;
  readonly fx_closes_at?: unknown;
  readonly fx_next_open_hours?: unknown;
  readonly previous_open_hours?: unknown;
  readonly next_open_hours?: unknown;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return undefined;
};

const toDateOnly = (value: unknown): string | null => {
  const candidate = toStringValue(value);
  if (!candidate) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return candidate;
  }
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
};

const toMs = (value: unknown): number | null => {
  const candidate = toStringValue(value);
  if (!candidate) {
    return null;
  }
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

const ensureRecord = (payload: unknown): MaybeRecord => {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const record = ensureRecord(entry);
      if (record) {
        return record;
      }
    }
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    return ensureRecord(record.results);
  }
  return record;
};

export const isWithinRegularHours = (row: MarketHoursRow, nowMs: number): boolean => {
  if (row.is_open !== true || row.opens_at == null || row.closes_at == null) {
    return false;
  }
  return nowMs >= row.opens_at && nowMs <= row.closes_at;
};

export const isWithinExtendedHours = (row: MarketHoursRow, nowMs: number): boolean => {
  if (row.extended_opens_at == null || row.extended_closes_at == null) {
    return false;
  }
  return nowMs >= row.extended_opens_at && nowMs <= row.extended_closes_at;
};

export function normalizeMarketHoursXase(payload: unknown, env: NormalizeEnv): MarketHoursRow | undefined {
  const record = ensureRecord(payload) as MarketHoursRaw | undefined;
  if (!record) {
    return undefined;
  }

  const date = toDateOnly(record.date);
  if (!date) {
    return undefined;
  }

  const row: MarketHoursRow = {
    date,
    market: EXCHANGE_CODE,
    is_open: toBoolean(record.is_open),
    opens_at: toMs(record.opens_at),
    closes_at: toMs(record.closes_at),
    late_option_closes_at: toMs(record.late_option_closes_at),
    extended_opens_at: toMs(record.extended_opens_at),
    extended_closes_at: toMs(record.extended_closes_at),
    all_day_opens_at: toMs(record.all_day_opens_at),
    all_day_closes_at: toMs(record.all_day_closes_at),
    index_option_0dte_closes_at: toMs(record.index_option_0dte_closes_at),
    index_option_non_0dte_closes_at: toMs(record.index_option_non_0dte_closes_at),
    index_curb_opens_at: toMs(record.index_options_extended_hours?.curb_opens_at),
    index_curb_closes_at: toMs(record.index_options_extended_hours?.curb_closes_at),
    fx_is_open: toBoolean(record.fx_is_open),
    fx_opens_at: toMs(record.fx_opens_at),
    fx_closes_at: toMs(record.fx_closes_at),
    fx_next_open_hours: toMs(record.fx_next_open_hours),
    previous_open_hours_url: toStringValue(record.previous_open_hours),
    next_open_hours_url: toStringValue(record.next_open_hours),
    fetched_ts: env.ts ?? Date.now(),
    source_transport: env.transport ?? 'http',
    source_url: env.source,
  };

  return row;
}

const sanitizeDateInput = (value: string | undefined): string => {
  if (value) {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
};

const persistNormalized = async (row: MarketHoursRow, rawPayload: unknown, baseDir?: string): Promise<void> => {
  const [year] = row.date.split('-');
  const base = getDataRoot(baseDir ?? process.cwd());
  const csvFile = path.join(base, 'system', 'market_hours', row.market ?? EXCHANGE_CODE, `${year}.csv`);

  await upsertCsv(csvFile, MARKET_HOURS_HEADER, [row], (r) => `${r.date}-${r.market}`);

  const rawFile = path.join(base, 'system', 'market_hours', '_raw', row.market ?? EXCHANGE_CODE, `${row.date}.json`);
  ensureDirectoryForFileSync(rawFile);
  await writeFile(rawFile, `${JSON.stringify(rawPayload, null, 2)}\n`, 'utf8');
};

export async function syncMarketHoursXase(options: SyncMarketHoursOptions = {}): Promise<void> {
  const fetchFn: FetchLike | undefined = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchFn) {
    console.warn('[market-hours:xase] fetch API no disponible, se omite la sincronización.');
    return;
  }

  const targetDate = sanitizeDateInput(options.date);
  const url = `https://api.robinhood.com/markets/${EXCHANGE_CODE}/hours/${targetDate}/`;

  let response: FetchResponse;
  try {
    response = (await fetchFn(url, { headers: { Accept: 'application/json' } })) as FetchResponse;
  } catch (error) {
    console.warn('[market-hours:xase] Error al solicitar horarios de mercado:', error);
    return;
  }

  if (!response.ok) {
    console.warn('[market-hours:xase] Respuesta HTTP inválida:', response.status);
    return;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    console.warn('[market-hours:xase] No se pudo parsear el payload JSON:', error);
    return;
  }

  const normalized = normalizeMarketHoursXase(payload, {
    ts: Date.now(),
    source: url,
    transport: 'http',
  });

  if (!normalized) {
    console.warn('[market-hours:xase] Payload sin datos de horario válidos, se omite.');
    return;
  }

  await persistNormalized(normalized, payload, options.baseDir);
}
