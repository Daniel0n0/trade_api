import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { upsertCsv } from '../src/io/upsertCsv.js';
import { upsertJsonl } from '../src/io/upsertJsonl.js';

const debugDataDir = path.resolve('debug_results', 'data');

const resetFile = (filePath: string) => {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
};

test('smoke appends keep previous entries in debug_results/data', { concurrency: false }, async () => {
  fs.mkdirSync(debugDataDir, { recursive: true });

  const jsonFile = path.join(debugDataDir, 'upsert-smoke.jsonl');
  const csvFile = path.join(debugDataDir, 'upsert-smoke.csv');

  resetFile(jsonFile);
  resetFile(csvFile);

  const firstJsonLine = JSON.stringify({ id: 'alpha', price: 1 });
  const secondJsonLine = JSON.stringify({ id: 'beta', price: 2 });
  const updatedJsonLine = JSON.stringify({ id: 'alpha', price: 3 });

  await upsertJsonl(jsonFile, [{ key: 'alpha', value: firstJsonLine }]);
  await upsertJsonl(jsonFile, [{ key: 'beta', value: secondJsonLine }]);
  await upsertJsonl(jsonFile, [{ key: 'alpha', value: updatedJsonLine }]);

  const jsonContents = fs.readFileSync(jsonFile, 'utf8').trimEnd().split('\n');
  assert.deepEqual(jsonContents, [firstJsonLine, secondJsonLine, updatedJsonLine]);

  await upsertCsv(
    csvFile,
    ['id', 'value'],
    [
      { id: '1', value: 'one' },
      { id: '2', value: 'two' },
    ],
    (row) => String(row.id),
  );

  await upsertCsv(
    csvFile,
    ['id', 'value'],
    [
      { id: '3', value: 'three' },
      { id: '1', value: 'updated' },
    ],
    (row) => String(row.id),
  );

  const csvContents = fs.readFileSync(csvFile, 'utf8').trimEnd().split('\n');
  assert.deepEqual(csvContents, ['id,value', '1,one', '2,two', '3,three', '1,updated']);
});
