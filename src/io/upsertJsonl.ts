import { readFile } from 'node:fs/promises';

import { ensureDirectoryForFileSync } from './dir.js';
import { writeFileAtomic } from './writeFileAtomic.js';

type JsonlUpsertEntry = {
  readonly key: string;
  readonly value: string;
};

type JsonlUpsertOperation = 'insert' | 'update';

type JsonlUpsertResult = Map<string, JsonlUpsertOperation>;

const jsonlLocks = new Map<string, Promise<void>>();

const extractOrderIdFromLine = (line: string): string | null => {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const orderId = record?.order_id ?? record?.id;
    if (typeof orderId === 'string' && orderId.trim()) {
      return orderId;
    }
  } catch {
    // ignore malformed lines
  }
  return null;
};

const readExistingEntries = async (filePath: string): Promise<{ order: string[]; rows: Map<string, string> }> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const order: string[] = [];
    const rows = new Map<string, string>();
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const key = extractOrderIdFromLine(line);
      if (!key) {
        continue;
      }
      if (!rows.has(key)) {
        order.push(key);
      }
      rows.set(key, line);
    }
    return { order, rows };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { order: [], rows: new Map() };
    }
    throw error;
  }
};

const formatLines = (order: readonly string[], rows: Map<string, string>): string => {
  const lines: string[] = [];
  for (const key of order) {
    const line = rows.get(key);
    if (!line) {
      continue;
    }
    lines.push(line);
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
};

export async function upsertJsonl(filePath: string, entries: readonly JsonlUpsertEntry[]): Promise<JsonlUpsertResult> {
  if (!entries.length) {
    return new Map();
  }

  const previous = jsonlLocks.get(filePath) ?? Promise.resolve();
  const task = previous.then(async () => {
    ensureDirectoryForFileSync(filePath);
    const { order, rows } = await readExistingEntries(filePath);
    const operations: JsonlUpsertResult = new Map();

    for (const entry of entries) {
      const { key, value } = entry;
      if (!rows.has(key)) {
        order.push(key);
        operations.set(key, 'insert');
      } else {
        operations.set(key, 'update');
      }
      rows.set(key, value);
    }

    const payload = formatLines(order, rows);
    await writeFileAtomic(filePath, payload);

    return operations;
  });

  const lockPromise = task.then(() => undefined, () => undefined);
  jsonlLocks.set(filePath, lockPromise);

  try {
    return await task;
  } finally {
    if (jsonlLocks.get(filePath) === lockPromise) {
      jsonlLocks.delete(filePath);
    }
  }
}
