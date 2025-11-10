import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createNewsFeature } from '../src/modulos/stock-daily-shared.js';

test('createNewsFeature deduplicates items and writes csv/jsonl outputs', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-news-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const newsFeature = createNewsFeature('TSLA');

    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument/abc123'),
      'Dora instrument feeds should be accepted',
    );

    const meta = { transport: 'http', source: 'https://dora.robinhood.com/feed/instrument/abc123' } as const;
    const baseItem = {
      id: 'story-1',
      title: 'Primer titular',
      article_url: 'https://dora.robinhood.com/news/story-1',
      published_at: '2024-07-15T12:00:00Z',
      summary: 'Resumen inicial',
    };
    const secondItem = {
      id: 'story-2',
      title: 'Segundo titular',
      article_url: 'https://dora.robinhood.com/news/story-2',
      published_at: '2024-07-15T13:30:00Z',
      summary: 'Otro resumen',
    };

    newsFeature.processPayload([baseItem], meta);
    newsFeature.processPayload([baseItem, secondItem], meta);

    await newsFeature.close();

    const csvLines = readFileSync(newsFeature.result.csvPath, 'utf-8').trim().split('\n');
    assert.equal(csvLines.length, 3, 'Debe existir encabezado más dos filas únicas');
    assert.ok(csvLines[1].includes('story-1'));
    assert.ok(csvLines[2].includes('story-2'));

    const jsonDir = path.dirname(newsFeature.result.jsonlPath);
    const jsonFiles = readdirSync(jsonDir).filter((name) => name.startsWith('news-') && name.endsWith('.jsonl'));
    assert.equal(jsonFiles.length, 1, 'Se espera un archivo jsonl rotado');
    const jsonLines = readFileSync(path.join(jsonDir, jsonFiles[0]), 'utf-8')
      .trim()
      .split('\n');
    assert.equal(jsonLines.length, 2, 'Solo dos artículos únicos deben persistirse');
    const parsedItems = jsonLines.map((line) => JSON.parse(line));
    assert.deepEqual(
      parsedItems.map((item) => item.id).sort(),
      ['story-1', 'story-2'],
    );
  } finally {
    process.chdir(previousCwd);
  }
});
