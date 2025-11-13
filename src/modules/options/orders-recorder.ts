import type { APIResponse, Page, Response } from 'playwright';

import { RotatingWriter } from '../../modulos/rotating-writer.js';
import { dataPath } from '../../io/paths.js';

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

  const processPayload = (payload: OrdersPayload, url: string, source: ResponseSource, status: number) => {
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

    processPayload(payload, url, source, status);
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
