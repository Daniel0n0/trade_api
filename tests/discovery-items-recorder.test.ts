import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import path from 'node:path';
import { readdir, readFile, rm } from 'node:fs/promises';

import {
  extractListId,
  isDiscoveryItemsUrl,
  persistDiscoveryItemsPayload,
} from '../src/modules/discovery/discovery-items-recorder.js';

describe('discovery items recorder', () => {
  beforeEach(async () => {
    await rm(path.join(process.cwd(), 'data'), { recursive: true, force: true });
  });

  it('detecta la URL de discovery items', () => {
    const targetUrl =
      'https://api.robinhood.com/discovery/lists/v2/609ddf55-2da1-4d85-8f23-501ccbdf76eb/items/?owner_type=robinhood';
    assert.ok(isDiscoveryItemsUrl(targetUrl));
    assert.equal(extractListId(targetUrl), '609ddf55-2da1-4d85-8f23-501ccbdf76eb');
    assert.equal(isDiscoveryItemsUrl('https://api.robinhood.com/discovery/lists/items/'), false);
    assert.equal(
      isDiscoveryItemsUrl(
        'https://api.robinhood.com/discovery/lists/v2/609ddf55-2da1-4d85-8f23-501ccbdf76eb/items/?owner_type=other',
      ),
      false,
    );
  });

  it('persiste raw, summary, request_meta e items.jsonl', async () => {
    const timestampMs = Date.UTC(2024, 0, 15, 12, 30, 0);
    const listId = '609ddf55-2da1-4d85-8f23-501ccbdf76eb';
    const ownerType = 'robinhood';
    const symbol = 'SPY';
    const payload = {
      results: [
        { id: 'abc', type: 'instrument', symbol: 'NVDA', name: 'NVIDIA', item_data: [] },
        { id: 'def', type: 'instrument', symbol: 'TSLA', name: 'Tesla', item_data: [] },
      ],
      returned_all_items: true,
    };
    await persistDiscoveryItemsPayload({
      payload,
      rawText: JSON.stringify(payload),
      listId,
      ownerType,
      symbol,
      timestampMs,
      status: 200,
      url: `https://api.robinhood.com/discovery/lists/v2/${listId}/items/?owner_type=${ownerType}`,
      querystring: `owner_type=${ownerType}`,
      requestMeta: {
        method: 'GET',
        headers: [
          { name: 'user-agent', value: 'Playwright' },
          { name: 'authorization', value: 'Bearer secret' },
          { name: 'accept', value: 'application/json' },
        ],
      },
    });

    const baseDir = path.join(
      process.cwd(),
      'data',
      'stocks',
      symbol,
      '2024-01-15',
      'discovery',
      'lists',
      listId,
    );
    const itemsPath = path.join(baseDir, 'items.jsonl');
    const summaryPath = path.join(baseDir, 'summary.json');
    const baseEntries = await readdir(baseDir);
    const metaFile = baseEntries.find((entry) => entry.startsWith('request_meta_') && entry.endsWith('.txt'));
    assert.ok(metaFile, 'request_meta file should exist');
    const metaPath = path.join(baseDir, metaFile);

    const rawDir = path.join(baseDir, 'raw');
    const rawEntries = await readdir(rawDir);
    const rawFile = rawEntries.find((entry) => entry.startsWith('response_') && entry.endsWith('.json'));
    assert.ok(rawFile, 'raw response file should exist');
    const rawPath = path.join(rawDir, rawFile);

    const itemsContent = await readFile(itemsPath, 'utf8');
    const lines = itemsContent
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], payload.results?.[0]);
    assert.deepEqual(lines[1], payload.results?.[1]);

    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    assert.deepEqual(summary, {
      list_id: listId,
      owner_type: ownerType,
      returned_all_items: true,
    });

    const requestMeta = await readFile(metaPath, 'utf8');
    assert.match(requestMeta, /url: https:\/\/api\.robinhood\.com/);
    assert.match(requestMeta, /method: GET/);
    assert.match(requestMeta, /status_code: 200/);
    assert.match(requestMeta, new RegExp(`timestamp_ms: ${timestampMs}`));
    assert.match(requestMeta, /querystring: owner_type=robinhood/);
    assert.match(requestMeta, /user-agent: Playwright/);
    assert.match(requestMeta, /accept: application\/json/);
    assert.doesNotMatch(requestMeta, /authorization/i);

    const rawContent = await readFile(rawPath, 'utf8');
    assert.equal(rawContent.trim(), JSON.stringify(payload));
  });

  it('genera sufijos únicos cuando se persisten dos respuestas en el mismo milisegundo', async () => {
    const timestampMs = Date.UTC(2024, 0, 15, 12, 45, 0);
    const listId = '609ddf55-2da1-4d85-8f23-501ccbdf76eb';
    const ownerType = 'robinhood';
    const symbol = 'SPY';
    const payload = { results: [{ id: 'abc' }] };
    const baseParams = {
      payload,
      rawText: JSON.stringify(payload),
      listId,
      ownerType,
      symbol,
      timestampMs,
      status: 200,
      url: `https://api.robinhood.com/discovery/lists/v2/${listId}/items/?owner_type=${ownerType}`,
      querystring: `owner_type=${ownerType}`,
      requestMeta: { method: 'GET', headers: [] },
    } as const;

    await persistDiscoveryItemsPayload(baseParams);
    await persistDiscoveryItemsPayload(baseParams);

    const baseDir = path.join(
      process.cwd(),
      'data',
      'stocks',
      symbol,
      '2024-01-15',
      'discovery',
      'lists',
      listId,
    );

    const metaFiles = (await readdir(baseDir)).filter(
      (entry) => entry.startsWith('request_meta_') && entry.endsWith('.txt'),
    );
    assert.equal(metaFiles.length, 2);
    assert.equal(new Set(metaFiles).size, 2);

    const rawDir = path.join(baseDir, 'raw');
    const rawFiles = (await readdir(rawDir)).filter(
      (entry) => entry.startsWith('response_') && entry.endsWith('.json'),
    );
    assert.equal(rawFiles.length, 2);
    assert.equal(new Set(rawFiles).size, 2);
  });
});
