import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { closeAllWriters, getCsvWriter } from '../src/io/csvWriter.js';

const createTempFile = (name: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-writer-'));
  return path.join(dir, name);
};

test('getCsvWriter writes headers only when file is created', { concurrency: false }, async () => {
  const filePath = createTempFile('headers.csv');
  const writer = getCsvWriter(filePath, ['one', 'two']);
  writer.write('1,2\n');

  await closeAllWriters();

  const contents = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
  assert.deepEqual(contents, ['one,two', '1,2']);
});

test('getCsvWriter reuses the same stream per path', { concurrency: false }, async () => {
  const filePath = createTempFile('reuse.csv');
  const writerA = getCsvWriter(filePath, ['a']);
  const writerB = getCsvWriter(filePath, ['a']);

  assert.strictEqual(writerA, writerB);

  writerA.write('value\n');
  await closeAllWriters();

  const contents = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
  assert.deepEqual(contents, ['a', 'value']);
});

test('existing files keep their headers without duplication', { concurrency: false }, async () => {
  const filePath = createTempFile('existing.csv');
  const first = getCsvWriter(filePath, 'foo,bar');
  first.write('1,2\n');
  await closeAllWriters();

  const second = getCsvWriter(filePath, 'foo,bar');
  second.write('3,4\n');
  await closeAllWriters();

  const contents = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
  assert.deepEqual(contents, ['foo,bar', '1,2', '3,4']);
});
