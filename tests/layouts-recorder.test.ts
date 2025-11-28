import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { __test__ } from '../src/modules/layouts/layouts-recorder.js';
import { getDataRoot } from '../src/io/paths.js';

const { toLayoutsIndexRows, toWidgetRows, processLayoutsPayload } = __test__;

test('toLayoutsIndexRows returns compact layout metadata', () => {
  const snapshot = { snapshotTsMs: 1721100000000, snapshotDateUtc: '2024-07-16' };
  const rows = toLayoutsIndexRows(
    [
      { id: 'layout-1', version: 'v1', name: 'Main', icon: 'chart', widgets: [{ id: 'w-1' }, { id: 'w-2' }] },
      { id: 'layout-2', version: 'v2', name: 'Secondary', icon: null, widgets: [] },
    ],
    snapshot,
  );

  assert.deepEqual(rows, [
    {
      snapshot_ts_ms: snapshot.snapshotTsMs,
      snapshot_date_utc: snapshot.snapshotDateUtc,
      layout_id: 'layout-1',
      version: 'v1',
      name: 'Main',
      icon: 'chart',
      widget_count: 2,
    },
    {
      snapshot_ts_ms: snapshot.snapshotTsMs,
      snapshot_date_utc: snapshot.snapshotDateUtc,
      layout_id: 'layout-2',
      version: 'v2',
      name: 'Secondary',
      icon: undefined,
      widget_count: 0,
    },
  ]);
});

test('toWidgetRows flattens each widget with geometry', () => {
  const snapshot = { snapshotTsMs: 1721100000000, snapshotDateUtc: '2024-07-16' };
  const rows = toWidgetRows(
    [
      {
        id: 'layout-1',
        name: 'Main',
        widgets: [
          {
            id: 'widget-1',
            widgetType: 'chart',
            typeSlot: 1,
            position: { x: 0, y: 1 },
            size: { height: 10, width: 12 },
          },
          { id: 123 },
        ],
      },
    ],
    snapshot,
  );

  assert.deepEqual(rows, [
    {
      snapshot_ts_ms: snapshot.snapshotTsMs,
      snapshot_date_utc: snapshot.snapshotDateUtc,
      layout_id: 'layout-1',
      layout_name: 'Main',
      widget_id: 'widget-1',
      widgetType: 'chart',
      typeSlot: 1,
      pos_x: 0,
      pos_y: 1,
      size_height: 10,
      size_width: 12,
    },
  ]);
});

test('processLayoutsPayload writes all expected artifacts', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-layouts-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const clock = { now: () => 1721107200000 }; // 2024-07-16T02:00:00Z
    const payload = {
      layouts: [
        {
          id: 'layout-1',
          version: 'v1',
          name: 'Main',
          icon: 'chart',
          widgets: [
            { id: 'widget-1', widgetType: 'chart', typeSlot: 1, position: { x: 0, y: 0 }, size: { height: 8, width: 12 } },
            { id: 'widget-2', widgetType: 'list', typeSlot: 2 },
          ],
        },
      ],
    };

    const result = await processLayoutsPayload(payload, clock);
    assert.ok(result);
    assert.equal(result?.snapshot.snapshotDateUtc, '2024-07-16');
    assert.equal(result?.layoutCount, 1);
    assert.equal(result?.widgetCount, 2);

    const basePath = path.join(getDataRoot(workspace), 'app', 'layouts', '2024-07-16');
    const rawFile = path.join(basePath, 'raw', `hippo_bw_layouts_${result?.snapshot.snapshotTsMs}.json`);
    const jsonlFile = path.join(basePath, 'layouts.jsonl');
    const layoutsIndex = path.join(basePath, 'layouts_index.csv');
    const widgetsCsv = path.join(basePath, 'widgets.csv');

    const rawPayload = JSON.parse(readFileSync(rawFile, 'utf-8'));
    assert.deepEqual(rawPayload, payload);

    const jsonlLines = readFileSync(jsonlFile, 'utf-8')
      .trim()
      .split('\n');
    assert.equal(jsonlLines.length, 1);
    assert.equal(JSON.parse(jsonlLines[0]).id, 'layout-1');

    const layoutsCsvContent = readFileSync(layoutsIndex, 'utf-8').trim().split('\n');
    assert.equal(layoutsCsvContent[0], 'snapshot_ts_ms,snapshot_date_utc,layout_id,version,name,icon,widget_count');
    assert.equal(layoutsCsvContent[1].includes('layout-1'), true);

    const widgetsContent = readFileSync(widgetsCsv, 'utf-8').trim().split('\n');
    assert.equal(widgetsContent[0], 'snapshot_ts_ms,snapshot_date_utc,layout_id,layout_name,widget_id,widgetType,typeSlot,pos_x,pos_y,size_height,size_width');
    assert.equal(widgetsContent.length, 3); // header + two widgets
  } finally {
    process.chdir(previousCwd);
  }
});
