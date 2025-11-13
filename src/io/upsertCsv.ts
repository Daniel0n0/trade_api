import { readFile, writeFile } from 'node:fs/promises';

import { ensureDirectoryForFileSync } from './dir.js';
import { toCsvLine } from './row.js';

type CsvValue = string | number | boolean | null | undefined;

export type CsvRowInput<T extends readonly string[]> = Partial<Record<T[number], CsvValue>>;

const csvLocks = new Map<string, Promise<void>>();

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
};

const buildRowFromValues = <T extends readonly string[]>(header: T, values: string[]): CsvRowInput<T> => {
  const row: CsvRowInput<T> = {};
  header.forEach((key, index) => {
    const value = values[index];
    if (value !== undefined && value !== '') {
      row[key] = value;
    }
  });
  return row;
};

const readExistingRows = async <T extends readonly string[]>(
  filePath: string,
  header: T,
  keyFn: (row: CsvRowInput<T>) => string,
): Promise<{ order: string[]; rows: Map<string, CsvRowInput<T>> }> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const order: string[] = [];
    const rows = new Map<string, CsvRowInput<T>>();
    for (let index = 1; index < lines.length; index += 1) {
      const rawLine = lines[index];
      if (!rawLine) {
        continue;
      }
      const line = rawLine.replace(/\r$/, '');
      if (!line) {
        continue;
      }
      const values = parseCsvLine(line);
      const row = buildRowFromValues(header, values);
      const key = keyFn(row);
      if (!rows.has(key)) {
        order.push(key);
      }
      rows.set(key, row);
    }
    return { order, rows };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { order: [], rows: new Map() };
    }
    throw error;
  }
};

const formatRows = <T extends readonly string[]>(
  header: T,
  order: readonly string[],
  rows: Map<string, CsvRowInput<T>>,
): string => {
  const lines: string[] = [header.join(',')];
  for (const key of order) {
    const row = rows.get(key) ?? {};
    lines.push(toCsvLine(header, row));
  }
  return `${lines.join('\n')}\n`;
};

export async function upsertCsv<T extends readonly string[]>(
  filePath: string,
  header: T,
  rows: readonly CsvRowInput<T>[],
  keyFn: (row: CsvRowInput<T>) => string,
): Promise<void> {
  if (!rows.length) {
    return;
  }

  const previous = csvLocks.get(filePath) ?? Promise.resolve();
  const task = previous.then(async () => {
    ensureDirectoryForFileSync(filePath);
    const existing = await readExistingRows(filePath, header, keyFn);
    const order = existing.order;
    const rowMap = existing.rows;

    for (const row of rows) {
      const key = keyFn(row);
      if (!rowMap.has(key)) {
        order.push(key);
      }
      rowMap.set(key, row);
    }

    const payload = formatRows(header, order, rowMap);
    await writeFile(filePath, payload);
  });

  csvLocks.set(filePath, task.catch(() => {}));

  try {
    await task;
  } finally {
    if (csvLocks.get(filePath) === task) {
      csvLocks.delete(filePath);
    }
  }
}
