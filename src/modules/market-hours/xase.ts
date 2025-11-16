import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { DateTime } from 'luxon';

import { ensureDirectory, ensureDirectoryForFileSync } from '../../io/dir.js';
import { upsertCsv, type CsvRowInput } from '../../io/upsertCsv.js';

const EXCHANGE_CODE = 'XASE' as const;
const EXCHANGE_TZ = 'America/New_York' as const;

export const MARKET_HOURS_DAY_HEADER = [
  'ts',
  'exchange',
  'date_local',
  'tz_exchange',
  'is_open',
  'open_utc',
  'close_utc',
  'open_et',
  'close_et',
  'reg_minutes',
  'ext_open_utc',
  'ext_close_utc',
  'ext_open_et',
  'ext_close_et',
  'ext_minutes',
  'late_opt_close_utc',
  'idx_opt_0dte_close_utc',
  'idx_opt_non0dte_close_utc',
  'curb_open_utc',
  'curb_close_utc',
  'all_day_open_utc',
  'all_day_close_utc',
  'fx_is_open',
  'fx_open_utc',
  'fx_close_utc',
  'fx_next_open_utc',
  'source_url',
] as const;

export const MARKET_HOURS_SESSION_HEADER = [
  'ts',
  'exchange',
  'date_local',
  'session_type',
  'start_utc',
  'end_utc',
  'start_et',
  'end_et',
  'minutes',
  'is_open_flag',
  'source_url',
] as const;

export type MarketHoursDayRow = CsvRowInput<typeof MARKET_HOURS_DAY_HEADER>;
export type MarketHoursSessionRow = CsvRowInput<typeof MARKET_HOURS_SESSION_HEADER>;

export type NormalizedMarketHours = {
  readonly day: MarketHoursDayRow;
  readonly sessions: MarketHoursSessionRow[];
};

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
};

type MaybeRecord = Record<string, unknown> | undefined;

type MarketHoursRaw = {
  readonly date?: string;
  readonly is_open?: unknown;
  readonly opens_at?: unknown;
  readonly closes_at?: unknown;
  readonly extended_opens_at?: unknown;
  readonly extended_closes_at?: unknown;
  readonly late_option_closes_at?: unknown;
  readonly index_option_0dte_closes_at?: unknown;
  readonly index_option_non_0dte_closes_at?: unknown;
  readonly index_options_extended_hours?: MaybeRecord;
  readonly all_day_opens_at?: unknown;
  readonly all_day_closes_at?: unknown;
  readonly fx_opens_at?: unknown;
  readonly fx_closes_at?: unknown;
  readonly fx_next_open_hours?: unknown;
  readonly fx_is_open?: unknown;
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

const toIsoUtc = (value: unknown): string | null => {
  const candidate = toStringValue(value);
  if (!candidate) {
    return null;
  }
  const parsed = DateTime.fromISO(candidate, { zone: 'utc' });
  if (!parsed.isValid) {
    return null;
  }
  return parsed.toUTC().toISO();
};

const toDateOnly = (value: unknown): string | null => {
  const candidate = toStringValue(value);
  if (!candidate) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return candidate;
  }
  const parsed = DateTime.fromISO(candidate, { zone: 'utc' });
  if (!parsed.isValid) {
    return null;
  }
  return parsed.toISODate();
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
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  return undefined;
};

const flagFromBoolean = (value: unknown): 0 | 1 | null => {
  const bool = toBoolean(value);
  if (bool === undefined) {
    return null;
  }
  return bool ? 1 : 0;
};

const toEtIso = (isoUtc: string | null): string | null => {
  if (!isoUtc) {
    return null;
  }
  try {
    const parsed = DateTime.fromISO(isoUtc, { zone: 'utc' });
    if (!parsed.isValid) {
      return null;
    }
    return parsed.setZone(EXCHANGE_TZ).toISO();
  } catch {
    return null;
  }
};

const minutesBetween = (startIso: string | null, endIso: string | null): number | null => {
  if (!startIso || !endIso) {
    return null;
  }
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  const diff = end - start;
  if (!Number.isFinite(diff)) {
    return null;
  }
  return Math.max(0, diff / 60_000);
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

const buildSessionRow = (
  type: string,
  date: string,
  startUtc: string | null,
  endUtc: string | null,
  isOpenFlag: 0 | 1 | null,
  env: NormalizeEnv,
): MarketHoursSessionRow | null => {
  if (!startUtc || !endUtc) {
    return null;
  }
  return {
    ts: env.ts ?? Date.now(),
    exchange: EXCHANGE_CODE,
    date_local: date,
    session_type: type,
    start_utc: startUtc,
    end_utc: endUtc,
    start_et: toEtIso(startUtc),
    end_et: toEtIso(endUtc),
    minutes: minutesBetween(startUtc, endUtc),
    is_open_flag: isOpenFlag,
    source_url: env.source,
  };
};

export function normalizeMarketHoursXase(
  payload: unknown,
  env: NormalizeEnv,
): NormalizedMarketHours | undefined {
  const record = ensureRecord(payload) as MarketHoursRaw | undefined;
  if (!record) {
    return undefined;
  }

  const date = toDateOnly(record.date);
  if (!date) {
    return undefined;
  }

  const opensAt = toIsoUtc(record.opens_at);
  const closesAt = toIsoUtc(record.closes_at);
  const extendedOpensAt = toIsoUtc(record.extended_opens_at);
  const extendedClosesAt = toIsoUtc(record.extended_closes_at);
  const lateOptionClosesAt = toIsoUtc(record.late_option_closes_at);
  const idx0dteClose = toIsoUtc(record.index_option_0dte_closes_at);
  const idxNon0dteClose = toIsoUtc(record.index_option_non_0dte_closes_at);
  const curbOpensAt = toIsoUtc(record.index_options_extended_hours?.curb_opens_at);
  const curbClosesAt = toIsoUtc(record.index_options_extended_hours?.curb_closes_at);
  const allDayOpensAt = toIsoUtc(record.all_day_opens_at);
  const allDayClosesAt = toIsoUtc(record.all_day_closes_at);
  const fxOpensAt = toIsoUtc(record.fx_opens_at);
  const fxClosesAt = toIsoUtc(record.fx_closes_at);
  const fxNextOpen = toIsoUtc(record.fx_next_open_hours);

  const day: MarketHoursDayRow = {
    ts: env.ts ?? Date.now(),
    exchange: EXCHANGE_CODE,
    date_local: date,
    tz_exchange: EXCHANGE_TZ,
    is_open: flagFromBoolean(record.is_open),
    open_utc: opensAt,
    close_utc: closesAt,
    open_et: toEtIso(opensAt),
    close_et: toEtIso(closesAt),
    reg_minutes: minutesBetween(opensAt, closesAt),
    ext_open_utc: extendedOpensAt,
    ext_close_utc: extendedClosesAt,
    ext_open_et: toEtIso(extendedOpensAt),
    ext_close_et: toEtIso(extendedClosesAt),
    ext_minutes: minutesBetween(extendedOpensAt, extendedClosesAt),
    late_opt_close_utc: lateOptionClosesAt,
    idx_opt_0dte_close_utc: idx0dteClose,
    idx_opt_non0dte_close_utc: idxNon0dteClose,
    curb_open_utc: curbOpensAt,
    curb_close_utc: curbClosesAt,
    all_day_open_utc: allDayOpensAt,
    all_day_close_utc: allDayClosesAt,
    fx_is_open: flagFromBoolean(record.fx_is_open),
    fx_open_utc: fxOpensAt,
    fx_close_utc: fxClosesAt,
    fx_next_open_utc: fxNextOpen,
    source_url: env.source,
  };

  const sessions: MarketHoursSessionRow[] = [];
  const addSession = (
    type: string,
    start: string | null,
    end: string | null,
    isOpenFlag: 0 | 1 | null,
  ): void => {
    const row = buildSessionRow(type, date, start, end, isOpenFlag, env);
    if (row) {
      sessions.push(row);
    }
  };

  addSession('PRE', extendedOpensAt, opensAt, 1);
  addSession('REG', opensAt, closesAt, flagFromBoolean(record.is_open));
  addSession('POST', closesAt, extendedClosesAt, 1);
  addSession('LATE_OPT', closesAt, lateOptionClosesAt, 1);
  addSession('IDX_0DTE', closesAt, idx0dteClose, 1);
  addSession('IDX_NON0DTE', closesAt, idxNon0dteClose, 1);
  addSession('IDX_CURB', curbOpensAt, curbClosesAt, 1);
  addSession('ALL_DAY', allDayOpensAt, allDayClosesAt, 1);
  addSession('FX', fxOpensAt, fxClosesAt, flagFromBoolean(record.fx_is_open));

  return { day, sessions };
}

const sanitizeDateInput = (value: string | undefined): string => {
  if (value) {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const parsed = DateTime.fromISO(trimmed, { zone: EXCHANGE_TZ });
    if (parsed.isValid) {
      return parsed.toISODate();
    }
  }
  return DateTime.now().setZone(EXCHANGE_TZ).toISODate();
};

const persistNormalized = async (
  normalized: NormalizedMarketHours,
  rawPayload: unknown,
  baseDir?: string,
): Promise<void> => {
  const date = normalized.day.date_local;
  const exchange = (normalized.day.exchange as string | undefined)?.trim() || EXCHANGE_CODE;
  if (!date) {
    return;
  }
  const [year, month] = date.split('-');
  const base = baseDir ?? process.cwd();

  const dayFile = path.join(base, 'data', 'calendars', 'market_hours', exchange, year, `${month}.csv`);
  await upsertCsv(dayFile, MARKET_HOURS_DAY_HEADER, [normalized.day], (row) => row.date_local ?? '');

  if (normalized.sessions.length > 0) {
    const sessionFile = path.join(
      base,
      'data',
      'calendars',
      'market_hours_sessions',
      exchange,
      year,
      month,
      `${date}.csv`,
    );
    await upsertCsv(
      sessionFile,
      MARKET_HOURS_SESSION_HEADER,
      normalized.sessions,
      (row) => `${row.session_type ?? ''}|${row.start_utc ?? ''}`,
    );
  }

  const rawDir = path.join(base, 'data', '_raw', 'market_hours', exchange, `${year}-${month}`);
  await ensureDirectory(rawDir);
  const rawFile = path.join(rawDir, `${date}.json`);
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
    response = (await fetchFn(url, {
      headers: { Accept: 'application/json' },
    })) as FetchResponse;
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

  const normalized = normalizeMarketHoursXase(payload, { ts: Date.now(), source: url });
  if (!normalized) {
    console.warn('[market-hours:xase] Payload sin datos de horario válidos, se omite.');
    return;
  }

  await persistNormalized(normalized, payload, options.baseDir);
}
