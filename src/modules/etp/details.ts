import path from 'node:path';

import { getDataRoot } from '../../io/paths.js';
import { upsertCsv } from '../../io/upsertCsv.js';
import { safeJsonParse } from '../../utils/payload.js';
import type { HttpClient } from '../instrument/index.js';

type Envelope = {
  readonly ts: number;
  readonly transport: 'http' | 'ws' | string;
  readonly source: string;
  readonly payload: unknown;
};

type EtpPerformanceBucket = {
  readonly '1Y': string;
  readonly '3Y': string;
  readonly '5Y': string;
  readonly '10Y': string;
  readonly since_inception: string;
};

type EtpDetailsResponse = {
  readonly instrument_id: string;
  readonly symbol: string;

  readonly is_inverse: boolean;
  readonly is_leveraged: boolean;
  readonly is_volatility_linked: boolean;
  readonly is_crypto_futures: boolean;

  readonly aum: string;
  readonly sec_yield: string;
  readonly gross_expense_ratio: string;

  readonly documents: {
    readonly prospectus?: string;
    readonly [k: string]: string | undefined;
  };

  readonly quarter_end_date: string;
  readonly quarter_end_performance: {
    readonly market: EtpPerformanceBucket;
    readonly nav: EtpPerformanceBucket;
  };

  readonly month_end_date: string;
  readonly month_end_performance: {
    readonly market: EtpPerformanceBucket;
    readonly nav: EtpPerformanceBucket;
  };

  readonly inception_date: string;
  readonly index_tracked: string;
  readonly category: string;
  readonly total_holdings: number;
  readonly is_actively_managed: boolean;
  readonly broad_category_group: string;

  readonly sectors_portfolio_date: string;
  readonly sectors: ReadonlyArray<{
    readonly name: string;
    readonly weight: string;
    readonly description: string;
    readonly color: {
      readonly light: string;
      readonly dark: string;
    };
  }>;

  readonly holdings_portfolio_date: string;
  readonly holdings: ReadonlyArray<{
    readonly name: string;
    readonly instrument_id: string;
    readonly symbol: string;
    readonly weight: string;
    readonly sector: string;
    readonly description: string;
    readonly color: {
      readonly light: string;
      readonly dark: string;
    };
  }>;

  readonly show_holdings_visualization: boolean;
};

export type EtpDetailsEnvelope = Envelope & {
  readonly topic: 'etp_details';
  readonly instrument_id?: string;
  readonly symbol: string;
  readonly payload: EtpDetailsResponse;
};

const toNum = (value: string | null | undefined): number | null =>
  value != null ? Number(value) : null;

export type EtpMasterRow = {
  readonly instrument_id: string;
  readonly symbol: string;

  readonly is_inverse: boolean;
  readonly is_leveraged: boolean;
  readonly is_volatility_linked: boolean;
  readonly is_crypto_futures: boolean;

  readonly aum_usd: number;
  readonly sec_yield_pct: number;
  readonly gross_expense_ratio_pct: number;

  readonly prospectus_url: string | null;

  readonly inception_date: string;
  readonly index_tracked: string;
  readonly category: string;
  readonly total_holdings: number;
  readonly is_actively_managed: boolean;
  readonly broad_category_group: string;

  readonly sectors_portfolio_date: string;
  readonly holdings_portfolio_date: string;

  readonly show_holdings_visualization: boolean;

  readonly fetched_ts: number;
  readonly source_transport: Envelope['transport'];
  readonly source_url: string;
};

export const ETP_MASTER_HEADER = [
  'instrument_id',
  'symbol',
  'is_inverse',
  'is_leveraged',
  'is_volatility_linked',
  'is_crypto_futures',
  'aum_usd',
  'sec_yield_pct',
  'gross_expense_ratio_pct',
  'prospectus_url',
  'inception_date',
  'index_tracked',
  'category',
  'total_holdings',
  'is_actively_managed',
  'broad_category_group',
  'sectors_portfolio_date',
  'holdings_portfolio_date',
  'show_holdings_visualization',
  'fetched_ts',
  'source_transport',
  'source_url',
] as const;

export type EtpPerformanceRow = {
  readonly instrument_id: string;
  readonly symbol: string;
  readonly as_of_date: string;
  readonly time_scope: 'quarter_end' | 'month_end';
  readonly basis: 'market' | 'nav';
  readonly period: '1Y' | '3Y' | '5Y' | '10Y' | 'since_inception';
  readonly return_pct: number;
  readonly fetched_ts: number;
  readonly source_url: string;
};

export const ETP_PERFORMANCE_HEADER = [
  'instrument_id',
  'symbol',
  'as_of_date',
  'time_scope',
  'basis',
  'period',
  'return_pct',
  'fetched_ts',
  'source_url',
] as const;

export type EtpSectorRow = {
  readonly instrument_id: string;
  readonly symbol: string;
  readonly as_of_date: string;
  readonly sector_name: string;
  readonly weight_pct: number;
  readonly description: string;
  readonly color_light: string;
  readonly color_dark: string;
  readonly fetched_ts: number;
  readonly source_url: string;
};

export const ETP_SECTORS_HEADER = [
  'instrument_id',
  'symbol',
  'as_of_date',
  'sector_name',
  'weight_pct',
  'description',
  'color_light',
  'color_dark',
  'fetched_ts',
  'source_url',
] as const;

export type EtpHoldingRow = {
  readonly etp_instrument_id: string;
  readonly etp_symbol: string;
  readonly as_of_date: string;
  readonly holding_instrument_id: string;
  readonly holding_symbol: string;
  readonly holding_name: string;
  readonly holding_sector: string;
  readonly weight_pct: number;
  readonly description: string;
  readonly color_light: string;
  readonly color_dark: string;
  readonly fetched_ts: number;
  readonly source_url: string;
};

export const ETP_HOLDINGS_HEADER = [
  'etp_instrument_id',
  'etp_symbol',
  'as_of_date',
  'holding_instrument_id',
  'holding_symbol',
  'holding_name',
  'holding_sector',
  'weight_pct',
  'description',
  'color_light',
  'color_dark',
  'fetched_ts',
  'source_url',
] as const;

export async function fetchEtpDetails(
  client: HttpClient,
  instrumentId: string,
  symbol: string,
): Promise<EtpDetailsEnvelope> {
  const normalizedInstrumentId = instrumentId.trim();
  if (!normalizedInstrumentId) {
    throw new Error('instrumentId is required to fetch ETP details');
  }

  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    throw new Error('symbol is required to fetch ETP details');
  }

  const url = `https://bonfire.robinhood.com/instruments/${encodeURIComponent(normalizedInstrumentId)}/etp-details/`;
  const text = await client.getText(url);
  const payload = safeJsonParse<EtpDetailsResponse>(text);

  if (!payload) {
    throw new Error('Failed to parse ETP details payload');
  }

  return {
    ts: Date.now(),
    transport: 'http',
    source: url,
    topic: 'etp_details',
    symbol: normalizedSymbol,
    payload,
    instrument_id: payload.instrument_id ?? normalizedInstrumentId,
  };
}

export function normaliseEtpMaster(env: EtpDetailsEnvelope): EtpMasterRow {
  const p = env.payload;

  return {
    instrument_id: p.instrument_id,
    symbol: p.symbol,
    is_inverse: p.is_inverse,
    is_leveraged: p.is_leveraged,
    is_volatility_linked: p.is_volatility_linked,
    is_crypto_futures: p.is_crypto_futures,
    aum_usd: toNum(p.aum) ?? 0,
    sec_yield_pct: toNum(p.sec_yield) ?? 0,
    gross_expense_ratio_pct: toNum(p.gross_expense_ratio) ?? 0,
    prospectus_url: p.documents?.prospectus ?? null,
    inception_date: p.inception_date,
    index_tracked: p.index_tracked,
    category: p.category,
    total_holdings: p.total_holdings,
    is_actively_managed: p.is_actively_managed,
    broad_category_group: p.broad_category_group,
    sectors_portfolio_date: p.sectors_portfolio_date,
    holdings_portfolio_date: p.holdings_portfolio_date,
    show_holdings_visualization: p.show_holdings_visualization,
    fetched_ts: env.ts,
    source_transport: env.transport,
    source_url: env.source,
  };
}

function explodePerf(
  instrument_id: string,
  symbol: string,
  as_of_date: string,
  time_scope: 'quarter_end' | 'month_end',
  basis: 'market' | 'nav',
  bucket: EtpPerformanceBucket,
  fetched_ts: number,
  source_url: string,
): EtpPerformanceRow[] {
  const entries: Array<[EtpPerformanceRow['period'], string]> = [
    ['1Y', bucket['1Y']],
    ['3Y', bucket['3Y']],
    ['5Y', bucket['5Y']],
    ['10Y', bucket['10Y']],
    ['since_inception', bucket.since_inception],
  ];

  return entries.map(([period, val]) => ({
    instrument_id,
    symbol,
    as_of_date,
    time_scope,
    basis,
    period,
    return_pct: Number(val),
    fetched_ts,
    source_url,
  }));
}

export function normaliseEtpPerformance(env: EtpDetailsEnvelope): EtpPerformanceRow[] {
  const p = env.payload;
  const rows: EtpPerformanceRow[] = [];

  rows.push(
    ...explodePerf(
      p.instrument_id,
      p.symbol,
      p.quarter_end_date,
      'quarter_end',
      'market',
      p.quarter_end_performance.market,
      env.ts,
      env.source,
    ),
    ...explodePerf(
      p.instrument_id,
      p.symbol,
      p.quarter_end_date,
      'quarter_end',
      'nav',
      p.quarter_end_performance.nav,
      env.ts,
      env.source,
    ),
    ...explodePerf(
      p.instrument_id,
      p.symbol,
      p.month_end_date,
      'month_end',
      'market',
      p.month_end_performance.market,
      env.ts,
      env.source,
    ),
    ...explodePerf(
      p.instrument_id,
      p.symbol,
      p.month_end_date,
      'month_end',
      'nav',
      p.month_end_performance.nav,
      env.ts,
      env.source,
    ),
  );

  return rows;
}

export function normaliseEtpSectors(env: EtpDetailsEnvelope): EtpSectorRow[] {
  const p = env.payload;
  return p.sectors.map((s) => ({
    instrument_id: p.instrument_id,
    symbol: p.symbol,
    as_of_date: p.sectors_portfolio_date,
    sector_name: s.name,
    weight_pct: Number(s.weight),
    description: s.description,
    color_light: s.color.light,
    color_dark: s.color.dark,
    fetched_ts: env.ts,
    source_url: env.source,
  }));
}

export function normaliseEtpHoldings(
  env: EtpDetailsEnvelope,
  opts?: { maxHoldings?: number; truncateDescriptionAt?: number },
): EtpHoldingRow[] {
  const p = env.payload;
  const maxHoldings = opts?.maxHoldings ?? Infinity;
  const truncateAt = opts?.truncateDescriptionAt ?? 512;

  return p.holdings.slice(0, maxHoldings).map((h) => ({
    etp_instrument_id: p.instrument_id,
    etp_symbol: p.symbol,
    as_of_date: p.holdings_portfolio_date,
    holding_instrument_id: h.instrument_id,
    holding_symbol: h.symbol,
    holding_name: h.name,
    holding_sector: h.sector,
    weight_pct: Number(h.weight),
    description: h.description.length > truncateAt
      ? `${h.description.slice(0, truncateAt)}…`
      : h.description,
    color_light: h.color.light,
    color_dark: h.color.dark,
    fetched_ts: env.ts,
    source_url: env.source,
  }));
}

async function persistMaster(rows: readonly EtpMasterRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const filePath = path.join(getDataRoot(), 'meta', 'etp_master.csv');
  await upsertCsv(filePath, ETP_MASTER_HEADER, rows, (row) => String(row.instrument_id));
}

async function persistPerformance(rows: readonly EtpPerformanceRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const filePath = path.join(getDataRoot(), 'meta', 'etp_performance.csv');
  await upsertCsv(filePath, ETP_PERFORMANCE_HEADER, rows, (row) =>
    [row.instrument_id, row.as_of_date, row.time_scope, row.basis, row.period].join('|'),
  );
}

async function persistSectors(rows: readonly EtpSectorRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const filePath = path.join(process.cwd(), 'data', 'meta', 'etp_sectors.csv');
  await upsertCsv(filePath, ETP_SECTORS_HEADER, rows, (row) =>
    [row.instrument_id, row.as_of_date, row.sector_name].join('|'),
  );
}

async function persistHoldings(rows: readonly EtpHoldingRow[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const filePath = path.join(getDataRoot(), 'meta', 'etp_holdings.csv');
  await upsertCsv(filePath, ETP_HOLDINGS_HEADER, rows, (row) =>
    [row.etp_instrument_id, row.as_of_date, row.holding_instrument_id].join('|'),
  );
}

export async function syncEtpDetails(
  client: HttpClient,
  instrumentId: string,
  symbol: string,
  opts?: { maxHoldings?: number; truncateDescriptionAt?: number },
): Promise<{
  master: EtpMasterRow;
  performance: EtpPerformanceRow[];
  sectors: EtpSectorRow[];
  holdings: EtpHoldingRow[];
}> {
  const envelope = await fetchEtpDetails(client, instrumentId, symbol);
  const master = normaliseEtpMaster(envelope);
  const performance = normaliseEtpPerformance(envelope);
  const sectors = normaliseEtpSectors(envelope);
  const holdings = normaliseEtpHoldings(envelope, opts);

  await Promise.all([
    persistMaster([master]),
    persistPerformance(performance),
    persistSectors(sectors),
    persistHoldings(holdings),
  ]);

  return { master, performance, sectors, holdings };
}

export type { EtpDetailsResponse, EtpPerformanceBucket };
