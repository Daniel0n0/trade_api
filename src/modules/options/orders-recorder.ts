import { appendFile, writeFile } from 'node:fs/promises';
import type { APIResponse, Page, Response } from 'playwright';

import { RotatingWriter } from '../../modulos/rotating-writer.js';
import { dataPath } from '../../io/paths.js';
import { upsertCsv, type CsvRowInput } from '../../io/upsertCsv.js';

const JSON_MIME_PATTERN = /application\/json/i;

export type OptionsOrdersRecorderHandle = {
  close: () => Promise<void>;
};

export type InstallOptionsOrdersRecorderParams = {
  page: Page;
  logPrefix?: string;
};

type ResponseSource = 'network' | 'followup';

type OrdersPayload = {
  readonly next?: unknown;
  readonly previous?: unknown;
  readonly results?: unknown;
  readonly count?: unknown;
};

type ResponseLike = Response | APIResponse;

type GeneralLogEntry = Record<string, unknown> & { readonly kind: string };

const ORDERS_ROTATE_POLICY = { maxBytes: 512_000, maxMinutes: 10, gzipOnRotate: true } as const;
const RAW_FILE_PREFIX = 'options_orders_';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const toCsvValue = (value: unknown): string | number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return undefined;
};

const deriveOrderDate = (createdAt: string | undefined): string | null => {
  if (!createdAt) {
    return null;
  }
  const trimmed = createdAt.trim();
  if (trimmed.length < 10) {
    return null;
  }
  return trimmed.slice(0, 10);
};

const deriveSymbolDir = (symbol: string | undefined): string | null => {
  if (!symbol) {
    return null;
  }
  const trimmed = symbol.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toUpperCase();
};

const buildExecutionFallbackId = (
  orderId: string | undefined,
  legId: string | undefined,
  index: number,
): string => {
  const orderSegment = orderId ?? 'order';
  const legSegment = legId ?? 'leg';
  return `${orderSegment}:${legSegment}:${index}`;
};

const buildLegRows = (order: OrderRecord): LegsRow[] => {
  const legs = Array.isArray(order.legs) ? (order.legs as unknown[]) : [];
  if (!legs.length) {
    return [];
  }
  const baseRow: LegsRow = {
    order_id: asString(order.id),
    account_number: asString(order.account_number),
    created_at: asString(order.created_at),
    updated_at: asString(order.updated_at),
    state: asString(order.state),
    derived_state: asString(order.derived_state),
    direction: asString(order.direction),
    market_hours: asString(order.market_hours),
    time_in_force: asString(order.time_in_force),
    trigger: asString(order.trigger),
    type: asString(order.type),
    strategy: asString(order.strategy),
    chain_id: asString(order.chain_id),
    chain_symbol: asString(order.chain_symbol),
    ref_id: asString(order.ref_id),
  };

  const rows: LegsRow[] = [];
  for (const leg of legs) {
    if (!isRecord(leg)) {
      continue;
    }
    rows.push({
      ...baseRow,
      leg_id: asString(leg.id),
      position_effect: asString(leg.position_effect),
      side: asString(leg.side),
      ratio_quantity: toCsvValue(leg.ratio_quantity),
      option_type: asString(leg.option_type),
      expiration_date: asString(leg.expiration_date),
      strike_price: toCsvValue(leg.strike_price),
      long_strategy_code: asString(leg.long_strategy_code),
      short_strategy_code: asString(leg.short_strategy_code),
      option_url: asString(leg.option),
    });
  }
  return rows;
};

const buildExecutionRows = (order: OrderRecord): ExecutionsRow[] => {
  const legs = Array.isArray(order.legs) ? (order.legs as unknown[]) : [];
  if (!legs.length) {
    return [];
  }
  const rows: ExecutionsRow[] = [];
  const orderId = asString(order.id);
  for (const leg of legs) {
    if (!isRecord(leg)) {
      continue;
    }
    const legRecord = leg as LegRecord;
    const legId = asString(legRecord.id);
    const executions = Array.isArray(legRecord.executions) ? (legRecord.executions as unknown[]) : [];
    executions.forEach((execution, index) => {
      if (!isRecord(execution)) {
        return;
      }
      rows.push({
        order_id: orderId,
        leg_id: legId,
        execution_id: asString(execution.id) ?? buildExecutionFallbackId(orderId, legId, index),
        timestamp: asString(execution.timestamp),
        settlement_date: asString(execution.settlement_date),
        price: toCsvValue(execution.price),
        quantity: toCsvValue(execution.quantity),
      });
    });
  }
  return rows;
};

const buildFeeRow = (order: Record<string, unknown>): FeesRow | null => {
  const row: FeesRow = {
    order_id: asString(order.id),
    regulatory_fees: toCsvValue(order.regulatory_fees),
    contract_fees: toCsvValue(order.contract_fees),
    gold_savings: toCsvValue(order.gold_savings),
    estimated_total_net_amount: toCsvValue(order.estimated_total_net_amount),
    estimated_total_net_amount_direction: asString(order.estimated_total_net_amount_direction),
    net_amount: toCsvValue(order.net_amount),
    net_amount_direction: asString(order.net_amount_direction),
    processed_premium: toCsvValue(order.processed_premium),
    processed_premium_direction: asString(order.processed_premium_direction),
    average_net_premium_paid: toCsvValue(order.average_net_premium_paid),
  };

  const hasValue = FEES_HEADER.some((key) => {
    if (key === 'order_id') {
      return false;
    }
    const value = row[key];
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return true;
  });

  return hasValue ? row : null;
};

const appendValues = <T>(map: Map<string, T[]>, key: string, values: readonly T[]): void => {
  if (!values.length) {
    return;
  }
  const existing = map.get(key);
  if (existing) {
    existing.push(...values);
  } else {
    map.set(key, [...values]);
  }
};

const logOrderIssue = (
  writeGeneral: (entry: GeneralLogEntry) => void,
  orderId: string | undefined,
  reason: string,
): void => {
  const entry: GeneralLogEntry = { kind: 'options-orders-order-error', reason };
  if (orderId) {
    entry.orderId = orderId;
  }
  writeGeneral(entry);
};

const persistOrdersPayload = async (
  payload: OrdersPayload,
  writeGeneral: (entry: GeneralLogEntry) => void,
): Promise<void> => {
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (!results.length) {
    return;
  }

  const rawContent = JSON.stringify(payload, null, 2);
  const rawTimestamp = Date.now();
  const rawPaths = new Set<string>();
  const orderLinesByPath = new Map<string, string[]>();
  const legRowsByPath = new Map<string, LegsRow[]>();
  const executionRowsByPath = new Map<string, ExecutionsRow[]>();
  const feeRowsByPath = new Map<string, FeesRow[]>();

  for (const candidate of results) {
    if (!isRecord(candidate)) {
      logOrderIssue(writeGeneral, undefined, 'invalid-order-shape');
      continue;
    }
    const orderRecord = candidate as OrderRecord;
    const orderId = asString(orderRecord.id);
    if (!orderId) {
      logOrderIssue(writeGeneral, undefined, 'missing-order-id');
      continue;
    }
    const orderDate = deriveOrderDate(asString(orderRecord.created_at));
    if (!orderDate) {
      logOrderIssue(writeGeneral, orderId, 'invalid-created-at');
      continue;
    }
    const symbolDir = deriveSymbolDir(asString(orderRecord.chain_symbol));
    if (!symbolDir) {
      logOrderIssue(writeGeneral, orderId, 'invalid-chain-symbol');
      continue;
    }

    const baseInput = { assetClass: 'stock', symbol: symbolDir, date: orderDate } as const;
    const ordersPath = dataPath(baseInput, 'options', 'orders.jsonl');
    appendValues(orderLinesByPath, ordersPath, [JSON.stringify(candidate)]);

    const rawPath = dataPath(baseInput, 'options', 'raw', `${RAW_FILE_PREFIX}${rawTimestamp}.json`);
    rawPaths.add(rawPath);

    const legsPath = dataPath(baseInput, 'options', 'legs.csv');
    appendValues(legRowsByPath, legsPath, buildLegRows(orderRecord));

    const executionsPath = dataPath(baseInput, 'options', 'executions.csv');
    appendValues(executionRowsByPath, executionsPath, buildExecutionRows(orderRecord));

    const feeRow = buildFeeRow(orderRecord);
    if (feeRow) {
      const feesPath = dataPath(baseInput, 'options', 'fees.csv');
      appendValues(feeRowsByPath, feesPath, [feeRow]);
    }
  }

  const writePromises: Promise<unknown>[] = [];
  for (const rawPath of rawPaths) {
    writePromises.push(writeFile(rawPath, rawContent));
  }
  for (const [filePath, lines] of orderLinesByPath.entries()) {
    writePromises.push(appendFile(filePath, `${lines.join('\n')}\n`));
  }

  if (writePromises.length) {
    await Promise.all(writePromises);
  }

  const upsertPromises: Promise<void>[] = [];
  for (const [filePath, rows] of legRowsByPath.entries()) {
    upsertPromises.push(upsertCsv(filePath, LEGS_HEADER, rows, (row) => `${row.order_id ?? ''}|${row.leg_id ?? ''}`));
  }
  for (const [filePath, rows] of executionRowsByPath.entries()) {
    upsertPromises.push(
      upsertCsv(
        filePath,
        EXECUTIONS_HEADER,
        rows,
        (row) => String(row.execution_id ?? `${row.order_id ?? ''}|${row.leg_id ?? ''}|${row.timestamp ?? ''}`),
      ),
    );
  }
  for (const [filePath, rows] of feeRowsByPath.entries()) {
    upsertPromises.push(upsertCsv(filePath, FEES_HEADER, rows, (row) => String(row.order_id ?? '')));
  }

  if (upsertPromises.length) {
    await Promise.all(upsertPromises);
  }
};

const LEGS_HEADER = [
  'order_id',
  'account_number',
  'created_at',
  'updated_at',
  'state',
  'derived_state',
  'direction',
  'market_hours',
  'time_in_force',
  'trigger',
  'type',
  'strategy',
  'chain_id',
  'chain_symbol',
  'ref_id',
  'leg_id',
  'position_effect',
  'side',
  'ratio_quantity',
  'option_type',
  'expiration_date',
  'strike_price',
  'long_strategy_code',
  'short_strategy_code',
  'option_url',
] as const;

const EXECUTIONS_HEADER = [
  'order_id',
  'leg_id',
  'execution_id',
  'timestamp',
  'settlement_date',
  'price',
  'quantity',
] as const;

const FEES_HEADER = [
  'order_id',
  'regulatory_fees',
  'contract_fees',
  'gold_savings',
  'estimated_total_net_amount',
  'estimated_total_net_amount_direction',
  'net_amount',
  'net_amount_direction',
  'processed_premium',
  'processed_premium_direction',
  'average_net_premium_paid',
] as const;

type LegsRow = CsvRowInput<typeof LEGS_HEADER>;
type ExecutionsRow = CsvRowInput<typeof EXECUTIONS_HEADER>;
type FeesRow = CsvRowInput<typeof FEES_HEADER>;
type OrderRecord = Record<string, unknown> & { legs?: unknown };
type LegRecord = Record<string, unknown> & { executions?: unknown };

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const shouldProcessUrl = (url: string): boolean => url.includes('/options/orders/');

const normalizeSymbol = (logPrefix?: string): string =>
  logPrefix ? `options-orders-${logPrefix}` : 'options-orders';

const createGeneralLogger = (logPrefix?: string) => {
  const symbol = normalizeSymbol(logPrefix);
  const basePath = dataPath({ assetClass: 'general', symbol }, 'options-orders.jsonl');
  const writer = new RotatingWriter(basePath, ORDERS_ROTATE_POLICY);

  const writeGeneral = (entry: GeneralLogEntry) => {
    writer.write(JSON.stringify({ ts: Date.now(), ...entry }));
  };

  const close = async () => {
    writer.close();
  };

  return { writeGeneral, close };
};

const resolveContentType = (response: ResponseLike): string | undefined => {
  const headers = response.headers();
  if (!headers) {
    return undefined;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') {
      return value;
    }
  }
  return undefined;
};

const readJsonBody = async (response: ResponseLike) => {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${toErrorMessage(error)}`);
  }
};

const toAbsoluteUrl = (url: string, base: string): string | null => {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
};

const normalizeCursorUrl = (cursor: unknown, baseUrl: string): string | null => {
  if (typeof cursor !== 'string') {
    return null;
  }
  const trimmed = cursor.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = toAbsoluteUrl(trimmed, baseUrl);
  if (!resolved) {
    return null;
  }
  if (!shouldProcessUrl(resolved)) {
    return null;
  }
  return resolved;
};

const extractResultsCount = (payload: OrdersPayload): number | undefined => {
  const { results } = payload;
  if (Array.isArray(results)) {
    return results.length;
  }
  return undefined;
};

const extractTotalCount = (payload: OrdersPayload): number | undefined => {
  const { count } = payload;
  if (typeof count === 'number' && Number.isFinite(count)) {
    return count;
  }
  return undefined;
};

export const installOptionsOrdersRecorder = (
  params: InstallOptionsOrdersRecorderParams,
): OptionsOrdersRecorderHandle => {
  const context = params.page.context();
  const { writeGeneral, close: closeLogger } = createGeneralLogger(params.logPrefix);
  const pending = new Set<Promise<void>>();
  const scheduled = new Set<string>();
  let closed = false;

  const runTask = (task: Promise<void>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  const scheduleFollowup = (url: string, parentUrl: string) => {
    if (closed || scheduled.has(url)) {
      return;
    }
    scheduled.add(url);
    const followup = (async () => {
      try {
        const response = await context.request.get(url);
        await processResponse(response, 'followup');
      } catch (error) {
        writeGeneral({
          kind: 'options-orders-error',
          source: 'followup',
          url,
          parentUrl,
          error: toErrorMessage(error),
        });
      } finally {
        scheduled.delete(url);
      }
    })();
    runTask(followup);
  };

  const processPayload = async (
    payload: OrdersPayload,
    url: string,
    source: ResponseSource,
    status: number,
  ): Promise<void> => {
    const nextUrl = normalizeCursorUrl(payload?.next, url);
    const previousUrl = normalizeCursorUrl(payload?.previous, url);
    const resultCount = extractResultsCount(payload);
    const totalCount = extractTotalCount(payload);

    writeGeneral({
      kind: 'options-orders-page',
      url,
      source,
      status,
      count: totalCount,
      resultCount,
      hasNext: Boolean(nextUrl),
      hasPrevious: Boolean(previousUrl),
    });

    if (nextUrl) {
      scheduleFollowup(nextUrl, url);
    }

    if (!Array.isArray(payload?.results)) {
      writeGeneral({ kind: 'options-orders-error', url, source, status, error: 'invalid-results' });
      return;
    }

    await persistOrdersPayload(payload, writeGeneral);
  };

  const processResponse = async (response: ResponseLike, source: ResponseSource): Promise<void> => {
    const url = response.url();
    if (!shouldProcessUrl(url)) {
      return;
    }

    const status = response.status();
    if (status >= 400) {
      writeGeneral({ kind: 'options-orders-error', url, source, status, error: 'http-error' });
      return;
    }

    const contentType = resolveContentType(response);
    if (!contentType || !JSON_MIME_PATTERN.test(contentType)) {
      writeGeneral({
        kind: 'options-orders-error',
        url,
        source,
        status,
        error: 'non-json-response',
        contentType,
      });
      return;
    }

    let payload: OrdersPayload;
    try {
      payload = (await readJsonBody(response)) as OrdersPayload;
    } catch (error) {
      writeGeneral({
        kind: 'options-orders-error',
        url,
        source,
        status,
        error: toErrorMessage(error),
      });
      return;
    }

    await processPayload(payload, url, source, status);
  };

  const handleResponse = (response: Response) => {
    if (!shouldProcessUrl(response.url())) {
      return;
    }
    runTask(processResponse(response, 'network'));
  };

  context.on('response', handleResponse);

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    context.off('response', handleResponse);
    if (pending.size > 0) {
      await Promise.allSettled(Array.from(pending));
    }
    await closeLogger();
  };

  return { close };
};
