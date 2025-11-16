import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import path from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';

import {
  createDiscoverySnapshotId,
  extractListId,
  isDiscoveryItemsUrl,
  persistDiscoveryItemsPayload,
  persistDiscoveryItemsRawArtifacts,
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
    const snapshotId = '1705312200000';
    const payload = {
      results: [
        { id: 'abc', type: 'instrument', symbol: 'NVDA', name: 'NVIDIA', item_data: [] },
        { id: 'def', type: 'instrument', symbol: 'TSLA', name: 'Tesla', item_data: [] },
      ],
      returned_all_items: true,
    };
    const baseParams = {
      rawText: JSON.stringify(payload),
      listId,
      ownerType,
      symbol,
      timestampMs,
      status: 200,
      url: `https://api.robinhood.com/discovery/lists/v2/${listId}/items/?owner_type=${ownerType}`,
      querystring: `owner_type=${ownerType}`,
      snapshotId,
      requestMeta: {
        method: 'GET',
        headers: [
          { name: 'user-agent', value: 'Playwright' },
          { name: 'authorization', value: 'Bearer secret' },
          { name: 'accept', value: 'application/json' },
          { name: 'x-robinhood-device-token', value: 'device-secret' },
          { name: 'Cookie', value: 'session=secret' },
        ],
      },
    };
    await persistDiscoveryItemsRawArtifacts(baseParams);
    await persistDiscoveryItemsPayload({ ...baseParams, payload });

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
    const metaPath = path.join(baseDir, `request_meta_${snapshotId}.txt`);
    const rawPath = path.join(baseDir, 'raw', `response_${snapshotId}.json`);

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
    assert.doesNotMatch(requestMeta, /device-secret/i);
    assert.doesNotMatch(requestMeta, /cookie/i);

    const rawContent = await readFile(rawPath, 'utf8');
    assert.equal(rawContent.trim(), JSON.stringify(payload));
  });

  it('crea raw/request_meta incluso si el JSON es inválido', async () => {
    const timestampMs = Date.UTC(2024, 5, 1, 0, 0, 0);
    const listId = 'list-invalid';
    const ownerType = 'robinhood';
    const symbol = 'SPY';
    const snapshotId = '1717200000000';
    const baseParams = {
      rawText: '{invalid',
      listId,
      ownerType,
      symbol,
      timestampMs,
      status: 200,
      url: `https://api.robinhood.com/discovery/lists/v2/${listId}/items/?owner_type=${ownerType}`,
      querystring: `owner_type=${ownerType}`,
      snapshotId,
      requestMeta: { method: 'GET', headers: [] },
    };
    await persistDiscoveryItemsRawArtifacts(baseParams);

    const baseDir = path.join(
      process.cwd(),
      'data',
      'stocks',
      symbol,
      '2024-06-01',
      'discovery',
      'lists',
      listId,
    );
    const rawPath = path.join(baseDir, 'raw', `response_${snapshotId}.json`);
    const metaPath = path.join(baseDir, `request_meta_${snapshotId}.txt`);
    const summaryPath = path.join(baseDir, 'summary.json');

    const rawContent = await readFile(rawPath, 'utf8');
    assert.equal(rawContent.trim(), '{invalid');
    await readFile(metaPath, 'utf8');
    await assert.rejects(() => readFile(summaryPath, 'utf8'));
  });

  it('genera IDs únicos por snapshot', async () => {
    const timestampMs = Date.UTC(2024, 3, 1, 12, 0, 0);
    const listId = 'list-unique';
    const ownerType = 'robinhood';
    const symbol = 'SPY';
    const baseDir = path.join(
      process.cwd(),
      'data',
      'stocks',
      symbol,
      '2024-04-01',
      'discovery',
      'lists',
      listId,
    );

    const firstId = createDiscoverySnapshotId();
    const secondId = createDiscoverySnapshotId();
    await persistDiscoveryItemsRawArtifacts({
      rawText: '{}',
      listId,
      ownerType,
      symbol,
      timestampMs,
      status: 200,
      url: `https://api.robinhood.com/discovery/lists/v2/${listId}/items/?owner_type=${ownerType}`,
      querystring: `owner_type=${ownerType}`,
      snapshotId: firstId,
      requestMeta: { method: 'GET', headers: [] },
    });
    await persistDiscoveryItemsRawArtifacts({
      rawText: '{}',
      listId,
      ownerType,
      symbol,
      timestampMs,
      status: 200,
      url: `https://api.robinhood.com/discovery/lists/v2/${listId}/items/?owner_type=${ownerType}`,
      querystring: `owner_type=${ownerType}`,
      snapshotId: secondId,
      requestMeta: { method: 'GET', headers: [] },
    });

    const rawFiles = await readdir(path.join(baseDir, 'raw'));
    assert.equal(rawFiles.length, 2);
    assert.notEqual(rawFiles[0], rawFiles[1]);
  });
});
