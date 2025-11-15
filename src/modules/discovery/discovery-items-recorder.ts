import path from 'node:path';
import { appendFile, writeFile } from 'node:fs/promises';
import type { APIResponse, Page, Request, Response } from 'playwright';

import { ensureDirectoryForFileSync, ensureDirectorySync } from '../../io/dir.js';
import { ensureSymbolDateDir } from '../../io/paths.js';

const JSON_MIME_PATTERN = /application\/json/i;
const ROBINHOOD_ORIGIN = 'https://api.robinhood.com';
const DISCOVERY_ITEMS_PATH_PATTERN = /^\/discovery\/lists\/v2\/([^/]+)\/items\/?$/i;
const DEFAULT_SYMBOL = 'SPY';
const SUMMARY_INDENT = 2;

export type DiscoveryItemsRecorderHandle = {
  close: () => Promise<void>;
};

type ResponseSource = 'network' | 'followup';

type HeaderEntry = { readonly name: string; readonly value: string };

type DiscoveryItemsPayload = {
  readonly results?: unknown;
  readonly next?: unknown;
  readonly returned_all_items?: unknown;
};

type RequestMetaInput = {
  readonly method: string;
  readonly headers: readonly HeaderEntry[];
};

type PersistPayloadParams = {
  readonly payload: DiscoveryItemsPayload;
  readonly rawText: string;
  readonly listId: string;
  readonly ownerType: string | null;
  readonly symbol: string;
  readonly timestampMs: number;
  readonly status: number;
  readonly url: string;
  readonly querystring: string;
  readonly requestMeta?: RequestMetaInput;
};

const toUtcDate = (timestampMs: number): string => new Date(timestampMs).toISOString().slice(0, 10);

const sanitizeListIdForPath = (listId: string): string => {
  const trimmed = listId.trim();
  if (!trimmed) {
    return 'unknown-list';
  }
  return trimmed.replace(/[\\/]/g, '_');
};

const formatRequestMeta = (
  params: PersistPayloadParams,
  headers: readonly HeaderEntry[],
): string => {
  const headerLines = headers.map((entry) => `${entry.name}: ${entry.value}`);
  const lines = [
    `url: ${params.url}`,
    `method: ${params.requestMeta?.method ?? 'GET'}`,
    `status_code: ${params.status}`,
    `timestamp_ms: ${params.timestampMs}`,
    `timestamp_utc: ${new Date(params.timestampMs).toISOString()}`,
    `querystring: ${params.querystring}`,
    'headers:',
    ...headerLines,
  ];
  return `${lines.join('\n')}\n`;
};

const appendItems = async (filePath: string, payload: DiscoveryItemsPayload): Promise<void> => {
  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return;
  }
  const content = payload.results.map((entry) => JSON.stringify(entry)).join('\n');
  await appendFile(filePath, `${content}\n`, 'utf8');
};

const buildSummaryPayload = (
  listId: string,
  ownerType: string | null,
  payload: DiscoveryItemsPayload,
): Record<string, unknown> => {
  const summary: Record<string, unknown> = { list_id: listId };
  if (ownerType) {
    summary.owner_type = ownerType;
  }
  if (typeof payload.returned_all_items === 'boolean') {
    summary.returned_all_items = payload.returned_all_items;
  }
  return summary;
};

export const persistDiscoveryItemsPayload = async (
  params: PersistPayloadParams,
): Promise<void> => {
  const dateSegment = toUtcDate(params.timestampMs);
  const baseDir = ensureSymbolDateDir({ assetClass: 'stocks', symbol: params.symbol, date: dateSegment });
  const discoveryDir = path.join(baseDir, 'discovery', 'lists', sanitizeListIdForPath(params.listId));
  ensureDirectorySync(discoveryDir);
  const rawDir = path.join(discoveryDir, 'raw');
  ensureDirectorySync(rawDir);

  const rawPath = path.join(rawDir, `response_${params.timestampMs}.json`);
  await writeFile(rawPath, `${params.rawText}\n`, 'utf8');

  const itemsPath = path.join(discoveryDir, 'items.jsonl');
  ensureDirectoryForFileSync(itemsPath);
  await appendItems(itemsPath, params.payload);

  const summaryPayload = buildSummaryPayload(params.listId, params.ownerType, params.payload);
  const summaryPath = path.join(discoveryDir, 'summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summaryPayload, null, SUMMARY_INDENT)}\n`, 'utf8');

  const headers = (params.requestMeta?.headers ?? []).filter(
    (entry) => entry.name.toLowerCase() !== 'authorization',
  );
  const metaPath = path.join(discoveryDir, `request_meta_${params.timestampMs}.txt`);
  await writeFile(metaPath, formatRequestMeta(params, headers), 'utf8');
};

const resolveContentType = (headers: Record<string, string>): string | undefined => {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === 'content-type') {
      return value;
    }
  }
  return undefined;
};

const buildHeaderEntriesFromObject = (headers: Record<string, string> | undefined): HeaderEntry[] => {
  if (!headers) {
    return [];
  }
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
};

const FOLLOWUP_HEADER_NAMES = new Set([
  'authorization',
  'user-agent',
  'accept',
  'accept-language',
  'accept-encoding',
  'origin',
  'x-robinhood-client',
  'x-app-info',
  'x-robinhood-api-version',
]);

const buildFollowupHeaders = (headers: readonly HeaderEntry[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const entry of headers) {
    const lowered = entry.name.toLowerCase();
    if (!FOLLOWUP_HEADER_NAMES.has(lowered)) {
      continue;
    }
    result[entry.name] = entry.value;
  }
  return result;
};

const toAbsoluteUrl = (next: string, baseUrl: string): string | null => {
  try {
    return new URL(next, baseUrl).toString();
  } catch {
    return null;
  }
};

const normalizeNextUrl = (next: unknown, baseUrl: string): string | null => {
  if (typeof next !== 'string') {
    return null;
  }
  const trimmed = next.trim();
  if (!trimmed) {
    return null;
  }
  const absolute = toAbsoluteUrl(trimmed, baseUrl);
  if (!absolute || !isDiscoveryItemsUrl(absolute)) {
    return null;
  }
  return absolute;
};

const toUrlParts = (
  url: string,
): { listId: string | null; ownerType: string | null; querystring: string } | null => {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== ROBINHOOD_ORIGIN) {
      return null;
    }
    const match = parsed.pathname.match(DISCOVERY_ITEMS_PATH_PATTERN);
    if (!match) {
      return null;
    }
    const ownerType = parsed.searchParams.get('owner_type');
    if (!ownerType || ownerType.toLowerCase() !== 'robinhood') {
      return null;
    }
    return { listId: match[1] ?? null, ownerType, querystring: parsed.searchParams.toString() };
  } catch {
    return null;
  }
};

const getRequestInfo = async (request: Request | null): Promise<RequestMetaInput | undefined> => {
  if (!request) {
    return undefined;
  }
  try {
    const headersArray = await request.headersArray();
    return {
      method: request.method(),
      headers: headersArray.map((entry) => ({ name: entry.name, value: entry.value })),
    };
  } catch (error) {
    console.warn('[discovery-items] No se pudieron leer los headers de la petición:', error);
    return undefined;
  }
};

const ensureRequestMeta = (input: RequestMetaInput | undefined): RequestMetaInput => {
  if (!input) {
    return { method: 'GET', headers: [] };
  }
  return input;
};

export const extractListId = (url: string): string | null => toUrlParts(url)?.listId ?? null;

export const isDiscoveryItemsUrl = (url: string): boolean => Boolean(toUrlParts(url));

type ProcessResponseArgs = {
  readonly response: Response | APIResponse;
  readonly source: ResponseSource;
  readonly requestMeta?: RequestMetaInput;
  readonly symbol: string;
  readonly followupHeaders?: Record<string, string>;
  readonly scheduleNext: (url: string, headers: Record<string, string>) => void;
};

const processResponse = async ({
  response,
  source,
  requestMeta,
  symbol,
  followupHeaders,
  scheduleNext,
}: ProcessResponseArgs): Promise<void> => {
  const url = response.url();
  if (!isDiscoveryItemsUrl(url)) {
    return;
  }
  const status = response.status();
  if (status >= 400) {
    console.warn('[discovery-items] Respuesta con error omitida:', { url, status, source });
    return;
  }
  const contentType = resolveContentType(response.headers());
  if (!contentType || !JSON_MIME_PATTERN.test(contentType)) {
    console.warn('[discovery-items] Respuesta no-JSON omitida:', { url, status, source, contentType });
    return;
  }
  const urlParts = toUrlParts(url);
  if (!urlParts?.listId) {
    return;
  }
  let rawText: string;
  try {
    rawText = await response.text();
  } catch (error) {
    console.warn('[discovery-items] No se pudo leer el cuerpo de la respuesta:', error);
    return;
  }
  let payload: DiscoveryItemsPayload;
  try {
    payload = JSON.parse(rawText) as DiscoveryItemsPayload;
  } catch (error) {
    console.warn('[discovery-items] No se pudo parsear el cuerpo JSON:', error);
    return;
  }
  const timestampMs = Date.now();
  await persistDiscoveryItemsPayload({
    payload,
    rawText,
    listId: urlParts.listId,
    ownerType: urlParts.ownerType,
    symbol,
    timestampMs,
    status,
    url,
    querystring: urlParts.querystring,
    requestMeta: ensureRequestMeta(requestMeta),
  });

  const nextUrl = normalizeNextUrl(payload?.next, url);
  if (nextUrl) {
    scheduleNext(nextUrl, followupHeaders ?? buildFollowupHeaders(requestMeta?.headers ?? []));
  }
};

export const installDiscoveryItemsRecorder = (params: {
  readonly page: Page;
  readonly symbol?: string;
}): DiscoveryItemsRecorderHandle => {
  const page = params.page;
  const symbol = (params.symbol ?? DEFAULT_SYMBOL).trim() || DEFAULT_SYMBOL;
  const context = page.context();
  const pending = new Set<Promise<void>>();
  const scheduled = new Set<string>();
  let closed = false;

  const runTask = (task: Promise<void>): void => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  const scheduleNext = (url: string, headers: Record<string, string>) => {
    if (closed || scheduled.has(url)) {
      return;
    }
    scheduled.add(url);
    const followup = (async () => {
      try {
        const response = await context.request.get(url, { headers });
        await processResponse({
          response,
          source: 'followup',
          requestMeta: { method: 'GET', headers: buildHeaderEntriesFromObject(headers) },
          symbol,
          followupHeaders: headers,
          scheduleNext,
        });
      } catch (error) {
        console.warn('[discovery-items] Error al seguir paginación:', { url, error });
      } finally {
        scheduled.delete(url);
      }
    })();
    runTask(followup);
  };

  const handleResponse = async (response: Response) => {
    if (!isDiscoveryItemsUrl(response.url())) {
      return;
    }
    const requestMeta = await getRequestInfo(response.request());
    runTask(
      processResponse({
        response,
        source: 'network',
        requestMeta,
        symbol,
        followupHeaders: buildFollowupHeaders(requestMeta?.headers ?? []),
        scheduleNext,
      }),
    );
  };

  page.on('response', handleResponse);

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    page.off('response', handleResponse);
    await Promise.allSettled([...pending]);
  };

  return { close };
};
