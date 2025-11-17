import path from 'node:path';

import { upsertCsv, type CsvRowInput } from '../../io/upsertCsv.js';
import { safeJsonParse } from '../../utils/payload.js';

export type HttpClient = { getText: (url: string) => Promise<string> };

type Envelope = {
  readonly ts: number;
  readonly transport: 'http' | 'ws' | string;
  readonly source: string;
  readonly payload: unknown;
};

export type InstrumentsPage = {
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: InstrumentResponse[];
};

export type InstrumentResponse = {
  readonly id: string;
  readonly url: string;
  readonly quote: string;
  readonly fundamentals: string;
  readonly splits: string;
  readonly state: string;
  readonly market: string;
  readonly simple_name: string | null;
  readonly name: string | null;
  readonly tradeable: boolean;
  readonly tradability: string;
  readonly symbol: string;
  readonly bloomberg_unique: string | null;
  readonly margin_initial_ratio: string;
  readonly maintenance_ratio: string;
  readonly country: string;
  readonly day_trade_ratio: string;
  readonly list_date: string | null;
  readonly min_tick_size: string | null;
  readonly type: string;
  readonly tradable_chain_id: string | null;
  readonly rhs_tradability: string;
  readonly affiliate_tradability: string;
  readonly fractional_tradability: string;
  readonly short_selling_tradability: string;
  readonly default_collar_fraction: string;
  readonly ipo_access_status: string | null;
  readonly ipo_access_cob_deadline: string | null;
  readonly ipo_s1_url: string | null;
  readonly ipo_roadshow_url: string | null;
  readonly is_spac: boolean;
  readonly is_test: boolean;
  readonly ipo_access_supports_dsp: boolean;
  readonly extended_hours_fractional_tradability: boolean;
  readonly internal_halt_reason: string;
  readonly internal_halt_details: string;
  readonly internal_halt_sessions: string | null;
  readonly internal_halt_start_time: string | null;
  readonly internal_halt_end_time: string | null;
  readonly internal_halt_source: string;
  readonly all_day_tradability: string;
  readonly notional_estimated_quantity_decimals: number;
  readonly tax_security_type: string;
  readonly reserved_buying_power_percent_queued: string;
  readonly reserved_buying_power_percent_immediate: string;
  readonly otc_market_tier: string;
  readonly car_required: boolean;
  readonly high_risk_maintenance_ratio: string;
  readonly low_risk_maintenance_ratio: string;
  readonly default_preset_percent_limit: string;
  readonly affiliate: string;
  readonly account_type_tradabilities: ReadonlyArray<{
    readonly account_type: string;
    readonly account_type_tradability: string;
  }>;
  readonly issuer_type: string;
};

export type InstrumentEnvelope = Envelope & {
  readonly topic: 'instrument';
  readonly symbol: string;
  readonly payload: InstrumentsPage;
};

export const INSTRUMENTS_HEADER = [
  'instrument_id',
  'symbol',
  'market_url',
  'type',
  'tax_security_type',
  'state',
  'tradeable',
  'tradability',
  'rhs_tradability',
  'affiliate_tradability',
  'fractional_tradability',
  'short_selling_tradability',
  'all_day_tradability',
  'simple_name',
  'name',
  'country',
  'list_date',
  'margin_initial_ratio',
  'maintenance_ratio',
  'high_risk_maintenance_ratio',
  'low_risk_maintenance_ratio',
  'day_trade_ratio',
  'default_collar_fraction',
  'default_preset_percent_limit',
  'reserved_bp_percent_queued',
  'reserved_bp_percent_immediate',
  'extended_hours_fractional_tradability',
  'is_spac',
  'is_test',
  'issuer_type',
  'affiliate',
  'notional_qty_decimals',
  'min_tick_size',
  'bloomberg_unique',
  'otc_market_tier',
  'internal_halt_reason',
  'internal_halt_details',
  'internal_halt_sessions',
  'internal_halt_start_time',
  'internal_halt_end_time',
  'internal_halt_source',
  'account_type_tradabilities_json',
  'fetched_ts',
  'source_transport',
  'source_url',
] as const;

export type InstrumentRow = {
  readonly instrument_id: string;
  readonly symbol: string;
  readonly market_url: string;
  readonly type: string;
  readonly tax_security_type: string;
  readonly state: string;
  readonly tradeable: boolean;
  readonly tradability: string;
  readonly rhs_tradability: string;
  readonly affiliate_tradability: string;
  readonly fractional_tradability: string;
  readonly short_selling_tradability: string;
  readonly all_day_tradability: string;
  readonly simple_name: string | null;
  readonly name: string | null;
  readonly country: string;
  readonly list_date: string | null;
  readonly margin_initial_ratio: number;
  readonly maintenance_ratio: number;
  readonly high_risk_maintenance_ratio: number;
  readonly low_risk_maintenance_ratio: number;
  readonly day_trade_ratio: number;
  readonly default_collar_fraction: number;
  readonly default_preset_percent_limit: number;
  readonly reserved_bp_percent_queued: number;
  readonly reserved_bp_percent_immediate: number;
  readonly extended_hours_fractional_tradability: boolean;
  readonly is_spac: boolean;
  readonly is_test: boolean;
  readonly issuer_type: string;
  readonly affiliate: string;
  readonly notional_qty_decimals: number;
  readonly min_tick_size: number | null;
  readonly bloomberg_unique: string | null;
  readonly otc_market_tier: string;
  readonly internal_halt_reason: string;
  readonly internal_halt_details: string;
  readonly internal_halt_sessions: string | null;
  readonly internal_halt_start_time: string | null;
  readonly internal_halt_end_time: string | null;
  readonly internal_halt_source: string;
  readonly account_type_tradabilities_json: string;
  readonly fetched_ts: number;
  readonly source_transport: 'http';
  readonly source_url: string;
};

export type InstrumentCsvRow = CsvRowInput<typeof INSTRUMENTS_HEADER>;

const toNum = (value: string | null | undefined): number | null =>
  value != null ? Number(value) : null;

export function normaliseInstrument(env: InstrumentEnvelope): InstrumentRow {
  const page = env.payload;
  const instrument = page.results[0];

  return {
    instrument_id: instrument.id,
    symbol: instrument.symbol,
    market_url: instrument.market,
    type: instrument.type,
    tax_security_type: instrument.tax_security_type,
    state: instrument.state,
    tradeable: instrument.tradeable,
    tradability: instrument.tradability,
    rhs_tradability: instrument.rhs_tradability,
    affiliate_tradability: instrument.affiliate_tradability,
    fractional_tradability: instrument.fractional_tradability,
    short_selling_tradability: instrument.short_selling_tradability,
    all_day_tradability: instrument.all_day_tradability,
    simple_name: instrument.simple_name,
    name: instrument.name,
    country: instrument.country,
    list_date: instrument.list_date,
    margin_initial_ratio: toNum(instrument.margin_initial_ratio) ?? 0,
    maintenance_ratio: toNum(instrument.maintenance_ratio) ?? 0,
    high_risk_maintenance_ratio: toNum(instrument.high_risk_maintenance_ratio) ?? 0,
    low_risk_maintenance_ratio: toNum(instrument.low_risk_maintenance_ratio) ?? 0,
    day_trade_ratio: toNum(instrument.day_trade_ratio) ?? 0,
    default_collar_fraction: toNum(instrument.default_collar_fraction) ?? 0,
    default_preset_percent_limit: toNum(instrument.default_preset_percent_limit) ?? 0,
    reserved_bp_percent_queued: toNum(instrument.reserved_buying_power_percent_queued) ?? 0,
    reserved_bp_percent_immediate: toNum(instrument.reserved_buying_power_percent_immediate) ?? 0,
    extended_hours_fractional_tradability: instrument.extended_hours_fractional_tradability,
    is_spac: instrument.is_spac,
    is_test: instrument.is_test,
    issuer_type: instrument.issuer_type,
    affiliate: instrument.affiliate,
    notional_qty_decimals: instrument.notional_estimated_quantity_decimals,
    min_tick_size: toNum(instrument.min_tick_size),
    bloomberg_unique: instrument.bloomberg_unique,
    otc_market_tier: instrument.otc_market_tier,
    internal_halt_reason: instrument.internal_halt_reason,
    internal_halt_details: instrument.internal_halt_details,
    internal_halt_sessions: instrument.internal_halt_sessions,
    internal_halt_start_time: instrument.internal_halt_start_time,
    internal_halt_end_time: instrument.internal_halt_end_time,
    internal_halt_source: instrument.internal_halt_source,
    account_type_tradabilities_json: JSON.stringify(instrument.account_type_tradabilities ?? []),
    fetched_ts: env.ts,
    source_transport: 'http',
    source_url: env.source,
  };
}

export async function fetchInstrumentBySymbol(
  client: HttpClient,
  symbol: string,
): Promise<InstrumentEnvelope> {
  const trimmed = symbol.trim();
  if (!trimmed) {
    throw new Error('symbol is required to fetch instrument data');
  }

  const normalizedSymbol = trimmed.toUpperCase();

  const url =
    `https://api.robinhood.com/instruments/?active_instruments_only=false&symbol=${encodeURIComponent(normalizedSymbol)}`;
  const text = await client.getText(url);
  const page = safeJsonParse<InstrumentsPage>(text);

  if (!page || !Array.isArray(page.results) || page.results.length === 0) {
    throw new Error(`Instrument not found for symbol=${normalizedSymbol}`);
  }

  return {
    ts: Date.now(),
    transport: 'http',
    source: url,
    topic: 'instrument',
    symbol: normalizedSymbol,
    payload: page,
  };
}

export async function persistInstrumentRows(rows: readonly InstrumentRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const filePath = path.join(process.cwd(), 'data', 'meta', 'instruments.csv');
  await upsertCsv(filePath, INSTRUMENTS_HEADER, rows, (row) => String(row.instrument_id));
}

export async function syncInstrument(
  client: HttpClient,
  symbol: string,
): Promise<InstrumentRow> {
  const envelope = await fetchInstrumentBySymbol(client, symbol);
  const row = normaliseInstrument(envelope);
  await persistInstrumentRows([row]);
  return row;
}
