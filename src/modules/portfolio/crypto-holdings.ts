import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import Decimal from 'decimal.js';

import { ensureDirectory, ensureDirectoryForFile } from '../../io/dir.js';
import { getDataRoot } from '../../io/paths.js';
import { toCsvLine } from '../../io/row.js';
import type { CsvRowInput } from '../../io/upsertCsv.js';

const DEFAULT_SOURCE_URL = 'https://nummus.robinhood.com/holdings/';
const DEFAULT_ACCOUNT_SEGMENT = 'UNKNOWN-ACCOUNT';

export const HOLDINGS_CURRENT_HEADER = [
  'ts',
  'source_url',
  'account_id',
  'holding_id',
  'currency_id',
  'currency_code',
  'currency_name',
  'currency_pair_id',
  'increment',
  'precision',
  'is_display_only',
  'qty',
  'qty_available',
  'qty_held',
  'qty_held_for_buy',
  'qty_held_for_sell',
  'qty_staked',
  'qty_transferable',
  'cb_direct_qty',
  'cb_direct_cost',
  'cb_reward_qty',
  'cb_reward_cost',
  'cb_transfer_qty',
  'cb_transfer_cost',
  'cb_intraday_qty',
  'cb_intraday_cost',
  'cb_marked_qty',
  'cb_marked_cost',
  'lots_count',
  'created_at_iso',
  'updated_at_iso',
  'has_position',
] as const;

export const HOLDINGS_COST_BASES_HEADER = [
  'ts',
  'source_url',
  'account_id',
  'holding_id',
  'cost_basis_id',
  'currency_id',
  'direct_qty',
  'direct_cost',
  'reward_qty',
  'reward_cost',
  'transfer_qty',
  'transfer_cost',
  'intraday_qty',
  'intraday_cost',
  'marked_qty',
  'marked_cost',
] as const;

export const HOLDINGS_TAX_LOTS_HEADER = [
  'ts',
  'source_url',
  'account_id',
  'holding_id',
  'tax_lot_id',
  'clearing_book_cost_basis',
  'clearing_running_qty',
  'clearing_running_qty_wo_cb',
  'intraday_cb',
  'intraday_qty',
  'intraday_qty_wo_cb',
] as const;

export type HoldingCurrentRow = CsvRowInput<typeof HOLDINGS_CURRENT_HEADER>;
export type HoldingCostBasisRow = CsvRowInput<typeof HOLDINGS_COST_BASES_HEADER>;
export type HoldingTaxLotRow = CsvRowInput<typeof HOLDINGS_TAX_LOTS_HEADER>;

export type HoldingCurrencyRaw = Record<string, unknown> & {
  readonly id?: unknown;
  readonly code?: unknown;
  readonly name?: unknown;
  readonly increment?: unknown;
  readonly display_only?: unknown;
};

export type HoldingCostBasisRaw = Record<string, unknown> & {
  readonly id?: unknown;
  readonly currency_id?: unknown;
  readonly direct_cost_basis?: unknown;
  readonly direct_quantity?: unknown;
  readonly direct_reward_cost_basis?: unknown;
  readonly direct_reward_quantity?: unknown;
  readonly direct_transfer_cost_basis?: unknown;
  readonly direct_transfer_quantity?: unknown;
  readonly intraday_cost_basis?: unknown;
  readonly intraday_quantity?: unknown;
  readonly marked_cost_basis?: unknown;
  readonly marked_quantity?: unknown;
};

export type HoldingTaxLotRaw = Record<string, unknown> & {
  readonly id?: unknown;
  readonly clearing_book_cost_basis?: unknown;
  readonly clearing_running_quantity?: unknown;
  readonly clearing_running_quantity_without_cost_basis?: unknown;
  readonly intraday_cost_basis?: unknown;
  readonly intraday_quantity?: unknown;
  readonly intraday_quantity_without_cost_basis?: unknown;
};

export type HoldingRaw = Record<string, unknown> & {
  readonly id?: unknown;
  readonly account_id?: unknown;
  readonly currency_pair_id?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly quantity?: unknown;
  readonly quantity_available?: unknown;
  readonly quantity_held?: unknown;
  readonly quantity_held_for_buy?: unknown;
  readonly quantity_held_for_sell?: unknown;
  readonly quantity_staked?: unknown;
  readonly quantity_transferable?: unknown;
  readonly currency?: HoldingCurrencyRaw;
  readonly cost_bases?: readonly HoldingCostBasisRaw[];
  readonly tax_lot_cost_bases?: readonly HoldingTaxLotRaw[];
};

export type HoldingsResponseRaw = {
  readonly next?: unknown;
  readonly previous?: unknown;
  readonly results?: readonly HoldingRaw[];
};

export type HoldingsEnvelope = {
  readonly ts?: number;
  readonly source?: string;
  readonly payload?: HoldingsResponseRaw | null | undefined;
};

export type CryptoHoldingsSnapshot = {
  readonly accountId: string;
  readonly ts: number;
  readonly sourceUrl: string;
  readonly holdings: readonly HoldingRaw[];
  readonly currentRows: readonly HoldingCurrentRow[];
  readonly costBasisRows: readonly HoldingCostBasisRow[];
  readonly taxLotRows: readonly HoldingTaxLotRow[];
};

export type PersistHoldingsResult = {
  readonly accountId: string;
  readonly rawPath: string;
  readonly currentDailyPath: string;
  readonly currentRollingPath: string;
  readonly costBasesPath: string;
  readonly taxLotsPath: string;
};

type ParsedCostBasis = {
  readonly id: string;
  readonly currencyId?: string;
  readonly directQty: string;
  readonly directCost: string;
  readonly rewardQty: string;
  readonly rewardCost: string;
  readonly transferQty: string;
  readonly transferCost: string;
  readonly intradayQty: string;
  readonly intradayCost: string;
  readonly markedQty: string;
  readonly markedCost: string;
};

type ParsedTaxLot = {
  readonly id: string;
  readonly clearingBookCostBasis: string;
  readonly clearingRunningQty: string;
  readonly clearingRunningQtyWoCb: string;
  readonly intradayCostBasis: string;
  readonly intradayQty: string;
  readonly intradayQtyWoCb: string;
};

type ParsedHolding = {
  readonly accountId: string;
  readonly holdingId: string;
  readonly currencyId?: string;
  readonly currencyCode: string;
  readonly currencyName?: string;
  readonly currencyPairId?: string;
  readonly increment?: string;
  readonly precision: number;
  readonly isDisplayOnly: 0 | 1;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly qty: string;
  readonly qtyAvailable: string;
  readonly qtyHeld: string;
  readonly qtyHeldForBuy: string;
  readonly qtyHeldForSell: string;
  readonly qtyStaked: string;
  readonly qtyTransferable: string;
  readonly hasPosition: 0 | 1;
  readonly costBases: readonly ParsedCostBasis[];
  readonly taxLots: readonly ParsedTaxLot[];
  readonly raw: HoldingRaw;
};

type AggregatedCostBasis = {
  readonly direct_qty: string;
  readonly direct_cost: string;
  readonly reward_qty: string;
  readonly reward_cost: string;
  readonly transfer_qty: string;
  readonly transfer_cost: string;
  readonly intraday_qty: string;
  readonly intraday_cost: string;
  readonly marked_qty: string;
  readonly marked_cost: string;
};

type SnapshotMapEntry = {
  readonly parsed: ParsedHolding[];
  readonly raw: HoldingRaw[];
};

const ZERO = new Decimal(0);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return undefined;
};

const decimalFrom = (value: unknown): Decimal => {
  if (value instanceof Decimal) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Decimal(value);
  }
  if (typeof value === 'bigint') {
    return new Decimal(value.toString());
  }
  const candidate = typeof value === 'string' ? value.trim() : undefined;
  if (!candidate) {
    return ZERO;
  }
  try {
    return new Decimal(candidate);
  } catch {
    return ZERO;
  }
};

const sanitizeDecimal = (value: unknown): string => decimalFrom(value).toString();

const precisionFromIncrement = (increment: string | undefined): number => {
  if (!increment) {
    return 0;
  }
  const trimmed = increment.trim();
  if (!trimmed) {
    return 0;
  }
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex < 0) {
    return 0;
  }
  return Math.max(0, trimmed.length - dotIndex - 1);
};

const sanitizeBooleanFlag = (value: unknown): 0 | 1 => (value ? 1 : 0);

const formatDateFolder = (ts: number): { date: string; month: string; timestamp: string } => {
  const date = new Date(Number.isFinite(ts) ? ts : Date.now());
  const iso = date.toISOString();
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 19).replace(/:/g, '');
  return { date: datePart, month: iso.slice(0, 7), timestamp: `${datePart}T${timePart}Z` };
};

const sanitizeAccountSegment = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_ACCOUNT_SEGMENT;
  }
  const replaced = trimmed.replace(/[^0-9A-Za-z_-]+/g, '-').replace(/^-+|-+$/g, '');
  return replaced || DEFAULT_ACCOUNT_SEGMENT;
};

const writeCsvSnapshot = async <T extends readonly string[]>(
  filePath: string,
  header: T,
  rows: readonly CsvRowInput<T>[],
): Promise<void> => {
  await ensureDirectoryForFile(filePath);
  const lines: string[] = [header.join(',')];
  for (const row of rows) {
    lines.push(toCsvLine(header, row as Record<string, unknown>));
  }
  if (lines.length === 1) {
    lines.push('');
  }
  await writeFile(filePath, `${lines.join('\n')}\n`);
};

const parseCostBasis = (value: unknown): ParsedCostBasis | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const id = toTrimmedString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    currencyId: toTrimmedString(value.currency_id),
    directQty: sanitizeDecimal(value.direct_quantity),
    directCost: sanitizeDecimal(value.direct_cost_basis),
    rewardQty: sanitizeDecimal(value.direct_reward_quantity),
    rewardCost: sanitizeDecimal(value.direct_reward_cost_basis),
    transferQty: sanitizeDecimal(value.direct_transfer_quantity),
    transferCost: sanitizeDecimal(value.direct_transfer_cost_basis),
    intradayQty: sanitizeDecimal(value.intraday_quantity),
    intradayCost: sanitizeDecimal(value.intraday_cost_basis),
    markedQty: sanitizeDecimal(value.marked_quantity),
    markedCost: sanitizeDecimal(value.marked_cost_basis),
  };
};

const parseTaxLot = (value: unknown): ParsedTaxLot | null => {
  if (!isPlainObject(value)) {
    return null;
  }
  const id = toTrimmedString(value.id);
  if (!id) {
    return null;
  }
  return {
    id,
    clearingBookCostBasis: sanitizeDecimal(value.clearing_book_cost_basis),
    clearingRunningQty: sanitizeDecimal(value.clearing_running_quantity),
    clearingRunningQtyWoCb: sanitizeDecimal(value.clearing_running_quantity_without_cost_basis),
    intradayCostBasis: sanitizeDecimal(value.intraday_cost_basis),
    intradayQty: sanitizeDecimal(value.intraday_quantity),
    intradayQtyWoCb: sanitizeDecimal(value.intraday_quantity_without_cost_basis),
  };
};

const parseHolding = (holding: HoldingRaw): ParsedHolding | null => {
  if (!isPlainObject(holding)) {
    return null;
  }
  const accountId = toTrimmedString(holding.account_id);
  const holdingId = toTrimmedString(holding.id);
  const currency = holding.currency;
  const currencyCode = currency ? toTrimmedString(currency.code) : undefined;

  if (!accountId || !holdingId || !currencyCode) {
    return null;
  }

  const increment = currency ? toTrimmedString(currency.increment) : undefined;
  const costBases = Array.isArray(holding.cost_bases)
    ? holding.cost_bases.map(parseCostBasis).filter((cb): cb is ParsedCostBasis => cb !== null)
    : [];
  const taxLots = Array.isArray(holding.tax_lot_cost_bases)
    ? holding.tax_lot_cost_bases.map(parseTaxLot).filter((lot): lot is ParsedTaxLot => lot !== null)
    : [];
  const qty = sanitizeDecimal(holding.quantity);
  const hasPosition = decimalFrom(qty).greaterThan(0) ? 1 : 0;

  return {
    accountId,
    holdingId,
    currencyId: currency ? toTrimmedString(currency.id) : undefined,
    currencyCode,
    currencyName: currency ? toTrimmedString(currency.name) : undefined,
    currencyPairId: toTrimmedString(holding.currency_pair_id),
    increment,
    precision: precisionFromIncrement(increment),
    isDisplayOnly: sanitizeBooleanFlag(currency?.display_only),
    createdAt: toTrimmedString(holding.created_at),
    updatedAt: toTrimmedString(holding.updated_at),
    qty,
    qtyAvailable: sanitizeDecimal(holding.quantity_available),
    qtyHeld: sanitizeDecimal(holding.quantity_held),
    qtyHeldForBuy: sanitizeDecimal(holding.quantity_held_for_buy),
    qtyHeldForSell: sanitizeDecimal(holding.quantity_held_for_sell),
    qtyStaked: sanitizeDecimal(holding.quantity_staked),
    qtyTransferable: sanitizeDecimal(holding.quantity_transferable),
    hasPosition,
    costBases,
    taxLots,
    raw: holding,
  };
};

const aggregateCostBases = (costBases: readonly ParsedCostBasis[]): AggregatedCostBasis => {
  let directQty = ZERO;
  let directCost = ZERO;
  let rewardQty = ZERO;
  let rewardCost = ZERO;
  let transferQty = ZERO;
  let transferCost = ZERO;
  let intradayQty = ZERO;
  let intradayCost = ZERO;
  let markedQty = ZERO;
  let markedCost = ZERO;

  for (const cb of costBases) {
    directQty = directQty.plus(new Decimal(cb.directQty));
    directCost = directCost.plus(new Decimal(cb.directCost));
    rewardQty = rewardQty.plus(new Decimal(cb.rewardQty));
    rewardCost = rewardCost.plus(new Decimal(cb.rewardCost));
    transferQty = transferQty.plus(new Decimal(cb.transferQty));
    transferCost = transferCost.plus(new Decimal(cb.transferCost));
    intradayQty = intradayQty.plus(new Decimal(cb.intradayQty));
    intradayCost = intradayCost.plus(new Decimal(cb.intradayCost));
    markedQty = markedQty.plus(new Decimal(cb.markedQty));
    markedCost = markedCost.plus(new Decimal(cb.markedCost));
  }

  return {
    direct_qty: directQty.toString(),
    direct_cost: directCost.toString(),
    reward_qty: rewardQty.toString(),
    reward_cost: rewardCost.toString(),
    transfer_qty: transferQty.toString(),
    transfer_cost: transferCost.toString(),
    intraday_qty: intradayQty.toString(),
    intraday_cost: intradayCost.toString(),
    marked_qty: markedQty.toString(),
    marked_cost: markedCost.toString(),
  };
};

const buildSnapshotMap = (holdings: readonly HoldingRaw[]): Map<string, SnapshotMapEntry> => {
  const map = new Map<string, SnapshotMapEntry>();
  for (const holding of holdings) {
    const parsed = parseHolding(holding);
    if (!parsed) {
      continue;
    }
    const entry = map.get(parsed.accountId);
    if (entry) {
      entry.parsed.push(parsed);
      entry.raw.push(holding);
    } else {
      map.set(parsed.accountId, { parsed: [parsed], raw: [holding] });
    }
  }
  return map;
};

const normaliseSourceUrl = (source?: string): string => {
  const trimmed = toTrimmedString(source);
  if (!trimmed) {
    return DEFAULT_SOURCE_URL;
  }
  return trimmed;
};

const writeRawSnapshot = async (
  baseDir: string,
  accountId: string,
  timestamp: string,
  holdings: readonly HoldingRaw[],
  ts: number,
  sourceUrl: string,
): Promise<string> => {
  const accountSegment = sanitizeAccountSegment(accountId);
  const monthFolder = timestamp.slice(0, 7);
  const rawDir = path.join(baseDir, '_raw', 'crypto_holdings', accountSegment, monthFolder);
  await ensureDirectory(rawDir);
  const filePath = path.join(rawDir, `${timestamp}.json`);
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        ts,
        source: sourceUrl,
        account_id: accountId,
        count: holdings.length,
        results: holdings,
      },
      null,
      2,
    )}\n`,
  );
  return filePath;
};

const writeHoldingsCsvs = async (
  baseDir: string,
  accountId: string,
  dateFolder: string,
  currentRows: readonly HoldingCurrentRow[],
  costBasisRows: readonly HoldingCostBasisRow[],
  taxLotRows: readonly HoldingTaxLotRow[],
): Promise<{ currentDailyPath: string; currentRollingPath: string; costBasesPath: string; taxLotsPath: string }> => {
  const accountSegment = sanitizeAccountSegment(accountId);
  const holdingsDir = path.join(baseDir, 'portfolio', 'holdings', 'crypto', accountSegment);
  const dailyDir = path.join(holdingsDir, dateFolder);

  const currentDailyPath = path.join(dailyDir, 'holdings_current.csv');
  const costBasesPath = path.join(dailyDir, 'holdings_cost_bases.csv');
  const taxLotsPath = path.join(dailyDir, 'holdings_tax_lots.csv');
  const currentRollingPath = path.join(holdingsDir, 'current.csv');

  await writeCsvSnapshot(currentDailyPath, HOLDINGS_CURRENT_HEADER, currentRows);
  await writeCsvSnapshot(costBasesPath, HOLDINGS_COST_BASES_HEADER, costBasisRows);
  await writeCsvSnapshot(taxLotsPath, HOLDINGS_TAX_LOTS_HEADER, taxLotRows);
  await writeCsvSnapshot(currentRollingPath, HOLDINGS_CURRENT_HEADER, currentRows);

  return { currentDailyPath, costBasesPath, taxLotsPath, currentRollingPath };
};

export function normalizeCryptoHoldings(env: HoldingsEnvelope): CryptoHoldingsSnapshot[] {
  const ts = Number.isFinite(env.ts) && typeof env.ts === 'number' ? Math.trunc(env.ts) : Date.now();
  const sourceUrl = normaliseSourceUrl(env.source);
  const payload = env.payload ?? { results: [] };
  const holdings = Array.isArray(payload.results) ? payload.results : [];
  const map = buildSnapshotMap(holdings);
  const snapshots: CryptoHoldingsSnapshot[] = [];

  for (const [accountId, entry] of map.entries()) {
    const currentRows: HoldingCurrentRow[] = [];
    const costBasisRows: HoldingCostBasisRow[] = [];
    const taxLotRows: HoldingTaxLotRow[] = [];

    for (const holding of entry.parsed) {
      const aggregates = aggregateCostBases(holding.costBases);
      currentRows.push({
        ts,
        source_url: sourceUrl,
        account_id: accountId,
        holding_id: holding.holdingId,
        currency_id: holding.currencyId,
        currency_code: holding.currencyCode,
        currency_name: holding.currencyName,
        currency_pair_id: holding.currencyPairId,
        increment: holding.increment,
        precision: holding.precision,
        is_display_only: holding.isDisplayOnly,
        qty: holding.qty,
        qty_available: holding.qtyAvailable,
        qty_held: holding.qtyHeld,
        qty_held_for_buy: holding.qtyHeldForBuy,
        qty_held_for_sell: holding.qtyHeldForSell,
        qty_staked: holding.qtyStaked,
        qty_transferable: holding.qtyTransferable,
        cb_direct_qty: aggregates.direct_qty,
        cb_direct_cost: aggregates.direct_cost,
        cb_reward_qty: aggregates.reward_qty,
        cb_reward_cost: aggregates.reward_cost,
        cb_transfer_qty: aggregates.transfer_qty,
        cb_transfer_cost: aggregates.transfer_cost,
        cb_intraday_qty: aggregates.intraday_qty,
        cb_intraday_cost: aggregates.intraday_cost,
        cb_marked_qty: aggregates.marked_qty,
        cb_marked_cost: aggregates.marked_cost,
        lots_count: holding.taxLots.length,
        created_at_iso: holding.createdAt,
        updated_at_iso: holding.updatedAt,
        has_position: holding.hasPosition,
      });

      for (const costBasis of holding.costBases) {
        costBasisRows.push({
          ts,
          source_url: sourceUrl,
          account_id: accountId,
          holding_id: holding.holdingId,
          cost_basis_id: costBasis.id,
          currency_id: costBasis.currencyId,
          direct_qty: costBasis.directQty,
          direct_cost: costBasis.directCost,
          reward_qty: costBasis.rewardQty,
          reward_cost: costBasis.rewardCost,
          transfer_qty: costBasis.transferQty,
          transfer_cost: costBasis.transferCost,
          intraday_qty: costBasis.intradayQty,
          intraday_cost: costBasis.intradayCost,
          marked_qty: costBasis.markedQty,
          marked_cost: costBasis.markedCost,
        });
      }

      for (const lot of holding.taxLots) {
        taxLotRows.push({
          ts,
          source_url: sourceUrl,
          account_id: accountId,
          holding_id: holding.holdingId,
          tax_lot_id: lot.id,
          clearing_book_cost_basis: lot.clearingBookCostBasis,
          clearing_running_qty: lot.clearingRunningQty,
          clearing_running_qty_wo_cb: lot.clearingRunningQtyWoCb,
          intraday_cb: lot.intradayCostBasis,
          intraday_qty: lot.intradayQty,
          intraday_qty_wo_cb: lot.intradayQtyWoCb,
        });
      }
    }

    snapshots.push({
      accountId,
      ts,
      sourceUrl,
      holdings: entry.raw,
      currentRows,
      costBasisRows,
      taxLotRows,
    });
  }

  return snapshots;
}

export async function persistCryptoHoldingsSnapshot(
  snapshot: CryptoHoldingsSnapshot,
  options?: { readonly baseDir?: string },
): Promise<PersistHoldingsResult> {
  const baseDir = options?.baseDir ?? getDataRoot();
  const { date, timestamp } = formatDateFolder(snapshot.ts);
  const rawPath = await writeRawSnapshot(baseDir, snapshot.accountId, timestamp, snapshot.holdings, snapshot.ts, snapshot.sourceUrl);
  const csvPaths = await writeHoldingsCsvs(
    baseDir,
    snapshot.accountId,
    date,
    snapshot.currentRows,
    snapshot.costBasisRows,
    snapshot.taxLotRows,
  );

  return {
    accountId: snapshot.accountId,
    rawPath,
    currentDailyPath: csvPaths.currentDailyPath,
    currentRollingPath: csvPaths.currentRollingPath,
    costBasesPath: csvPaths.costBasesPath,
    taxLotsPath: csvPaths.taxLotsPath,
  };
}

export const __test__ = {
  decimalFrom,
  precisionFromIncrement,
  parseHolding,
  aggregateCostBases,
  buildSnapshotMap,
  sanitizeAccountSegment,
  formatDateFolder,
  writeCsvSnapshot,
};
