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
    const altNewsFeature = createNewsFeature('QQQ');

    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument/abc123'),
      'Dora instrument feeds should be accepted',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument/'),
      'Dora feeds without a symbol suffix should be accepted',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument'),
      'Dora feeds without trailing slash must also be accepted',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument/?cursor=next-page'),
      'Dora feeds con parámetros de paginación deben aceptarse',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument?cursor=next-page'),
      'Query parameters must be detected even when the path lacks a trailing slash',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument#section'),
      'Fragments should not prevent Dora feeds from being detected',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument:urn'),
      'Feeds con identificadores después de dos puntos deben aceptarse',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument%3Aurn'),
      'Feeds Dora con identificadores codificados con %3A deben aceptarse',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('HTTPS://DORA.ROBINHOOD.COM/FEED/INSTRUMENT/ABC123'),
      'Dora feeds should be detected even with uppercase URL components',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https:\\/\\/dora.robinhood.com\/feed\/instrument\/abc123'),
      'Escaped Dora feed URLs must be accepted even when the ticker is ausente',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('/feed/instrument/abc123'),
      'Relative Dora feed paths should also be accepted',
    );
    assert.ok(
      newsFeature.shouldProcessUrl('https://dora.robinhood.com/api/v1/news?next=/feed/instrument/abc123'),
      'Feeds proxied through query parameters should still be recognized',
    );
    assert.ok(
      newsFeature.shouldProcessUrl(
        'https://dora.robinhood.com/api/v1/news?next=https%3A%2F%2Fdora.robinhood.com%2Ffeed%2Finstrument%2Fabc123',
      ),
      'Encoded Dora feed references should be recognized even without symbol hints',
    );
    assert.ok(
      altNewsFeature.shouldProcessUrl('https://dora.robinhood.com/feed/instrument/'),
      'Dora feeds must be captured even when the requested symbol differs from the module symbol',
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
    await altNewsFeature.close();

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

test('createNewsFeature captures Dora feed payloads without symbol hints', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-news-dora-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const newsFeature = createNewsFeature('SPY');

    const payloadPath = new URL('./fixtures/dora-feed.json', import.meta.url);
    const payload = JSON.parse(readFileSync(payloadPath, 'utf-8'));
    const meta = { transport: 'http', source: 'https://dora.robinhood.com/feed/instrument/' } as const;

    newsFeature.processPayload(payload, meta);
    await newsFeature.close();

    const csvLines = readFileSync(newsFeature.result.csvPath, 'utf-8').trim().split('\n');
    assert.equal(csvLines.length, 3, 'Deben persistirse el encabezado y dos artículos de Dora');
    const csvIds = csvLines.slice(1).map((line) => line.split(',')[2]);
    assert.deepEqual(csvIds.sort(), ['spy-001', 'spy-002']);

    const jsonDir = path.dirname(newsFeature.result.jsonlPath);
    const jsonFiles = readdirSync(jsonDir).filter((name) => name.startsWith('news-') && name.endsWith('.jsonl'));
    assert.equal(jsonFiles.length, 1, 'Se espera un archivo jsonl con datos de Dora');
    const jsonLines = readFileSync(path.join(jsonDir, jsonFiles[0]), 'utf-8')
      .trim()
      .split('\n');
    assert.equal(jsonLines.length, 2, 'Solo los artículos del feed de Dora deben registrarse');
    const parsedItems = jsonLines.map((line) => JSON.parse(line));
    assert.deepEqual(
      parsedItems.map((item) => item.id).sort(),
      ['spy-001', 'spy-002'],
    );
  } finally {
    process.chdir(previousCwd);
  }
});
