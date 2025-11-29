import { appendFile, readFile } from 'node:fs/promises';

import { ensureDirectoryForFileSync } from './dir.js';

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

const readExistingEntries = async (
  filePath: string,
): Promise<{ rows: Map<string, string>; content: string }> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
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
      rows.set(key, line);
    }
    return { rows, content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rows: new Map(), content: '' };
    }
    throw error;
  }
};

export async function upsertJsonl(filePath: string, entries: readonly JsonlUpsertEntry[]): Promise<JsonlUpsertResult> {
  if (!entries.length) {
    return new Map();
  }

  const previous = jsonlLocks.get(filePath) ?? Promise.resolve();
  const task = previous.then(async () => {
    ensureDirectoryForFileSync(filePath);
    const { rows, content } = await readExistingEntries(filePath);
    const operations: JsonlUpsertResult = new Map();

    const linesToAppend: string[] = [];

    for (const entry of entries) {
      const { key, value } = entry;
      if (!rows.has(key)) {
        operations.set(key, 'insert');
      } else if (rows.get(key) !== value) {
        operations.set(key, 'update');
      }
      rows.set(key, value);
      linesToAppend.push(value);
    }

    if (!linesToAppend.length) {
      return operations;
    }

    const needsNewline = content.length > 0 && !content.endsWith('\n');
    const payload = `${needsNewline ? '\n' : ''}${linesToAppend.join('\n')}\n`;
    await appendFile(filePath, payload, 'utf8');

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
