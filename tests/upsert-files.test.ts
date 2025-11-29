import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { upsertCsv } from '../src/io/upsertCsv.js';
import { upsertJsonl } from '../src/io/upsertJsonl.js';

const debugDataDir = path.resolve('debug_results', 'data');

const createDebugFile = (fileName: string): { directory: string; filePath: string } => {
  const directory = fs.mkdtempSync(path.join(debugDataDir, 'upsert-'));
  const filePath = path.join(directory, fileName);
  return { directory, filePath };
};

test('upsertJsonl appends without truncating previous lines', { concurrency: false }, async () => {
  const { directory, filePath } = createDebugFile('entries.jsonl');

  try {
    const firstLine = JSON.stringify({ order_id: 'alpha', price: 1 });
    const secondLine = JSON.stringify({ order_id: 'beta', price: 2 });
    const updatedFirstLine = JSON.stringify({ order_id: 'alpha', price: 3 });

    await upsertJsonl(filePath, [
      { key: 'alpha', value: firstLine },
      { key: 'beta', value: secondLine },
    ]);

    await upsertJsonl(filePath, [{ key: 'alpha', value: updatedFirstLine }]);

    const contents = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
    assert.deepEqual(contents, [firstLine, secondLine, updatedFirstLine]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('upsertCsv appends rows while preserving existing entries', { concurrency: false }, async () => {
  const { directory, filePath } = createDebugFile('entries.csv');

  try {
    await upsertCsv(
      filePath,
      ['id', 'value'],
      [
        { id: '1', value: 'one' },
        { id: '2', value: 'two' },
      ],
      (row) => String(row.id),
    );

    await upsertCsv(
      filePath,
      ['id', 'value'],
      [{ id: '1', value: 'updated' }],
      (row) => String(row.id),
    );

    const contents = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
    assert.deepEqual(contents, ['id,value', '1,one', '2,two', '1,updated']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
