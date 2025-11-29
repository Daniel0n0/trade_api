import { appendFile, readFile } from 'node:fs/promises';

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
    const typedKey = key as T[number];
    const value = values[index];
    if (value !== undefined && value !== '') {
      row[typedKey] = value;
    }
  });
  return row;
};

const readExistingRows = async <T extends readonly string[]>(
  filePath: string,
  header: T,
  keyFn: (row: CsvRowInput<T>) => string,
): Promise<{ rows: Map<string, CsvRowInput<T>>; content: string }> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
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
      rows.set(key, row);
    }
    return { rows, content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rows: new Map(), content: '' };
    }
    throw error;
  }
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
    const { rows: existingRows, content } = await readExistingRows(filePath, header, keyFn);

    const newLines: string[] = [];
    const headerLine = header.join(',');
    const hasContent = content.length > 0;

    if (!hasContent) {
      newLines.push(headerLine);
    }

    for (const row of rows) {
      const key = keyFn(row);
      const previousRow = existingRows.get(key);
      if (!previousRow || toCsvLine(header, previousRow) !== toCsvLine(header, row)) {
        newLines.push(toCsvLine(header, row));
      }
      existingRows.set(key, row);
    }

    if (!newLines.length) {
      return;
    }

    const needsNewline = hasContent && !content.endsWith('\n');
    const payload = `${needsNewline ? '\n' : ''}${newLines.join('\n')}\n`;
    await appendFile(filePath, payload, 'utf8');
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
