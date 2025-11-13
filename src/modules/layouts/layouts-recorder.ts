import path from 'node:path';
import { appendFile, writeFile } from 'node:fs/promises';
import type { BrowserContext, Page, Response } from 'playwright';

import { ensureDirectoryForFileSync, ensureDirectorySync } from '../../io/dir.js';
import { upsertCsv, type CsvRowInput } from '../../io/upsertCsv.js';

const LAYOUTS_ENDPOINT = new URL('https://api.robinhood.com/hippo/bw/layouts');
const LAYOUTS_ENDPOINT_KEY = `${LAYOUTS_ENDPOINT.origin}${LAYOUTS_ENDPOINT.pathname.replace(/\/+$/, '')}`;
const JSON_MIME_PATTERN = /^application\/json/i;

const LAYOUTS_INDEX_HEADER = [
  'snapshot_ts_ms',
  'snapshot_date_utc',
  'layout_id',
  'version',
  'name',
  'icon',
  'widget_count',
] as const;

const WIDGETS_HEADER = [
  'snapshot_ts_ms',
  'snapshot_date_utc',
  'layout_id',
  'layout_name',
  'widget_id',
  'widgetType',
  'typeSlot',
  'pos_x',
  'pos_y',
  'size_height',
  'size_width',
] as const;

export type LayoutsRecorderClock = { now: () => number };
export type LayoutsRecorderLogEntry = Record<string, unknown> & { readonly kind: string };
export type LayoutsRecorderLogger = { writeGeneral: (entry: LayoutsRecorderLogEntry) => void };
export type LayoutsRecorderTarget = Page | BrowserContext;

export type LayoutsRecorderHandle = { unregister: () => void };

type SnapshotInfo = { snapshotTsMs: number; snapshotDateUtc: string };

type RawWidget = Record<string, unknown> & {
  readonly id?: unknown;
  readonly widgetType?: unknown;
  readonly typeSlot?: unknown;
  readonly position?: { readonly x?: unknown; readonly y?: unknown };
  readonly size?: { readonly height?: unknown; readonly width?: unknown };
};

type RawLayout = Record<string, unknown> & {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly name?: unknown;
  readonly icon?: unknown;
  readonly widgets?: unknown;
};

type ProcessResult = {
  readonly snapshot: SnapshotInfo;
  readonly layoutCount: number;
  readonly widgetCount: number;
  readonly rawPath: string;
  readonly jsonlPath: string;
  readonly layoutsIndexPath: string;
  readonly widgetsPath: string;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const normaliseUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const normalisedPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${normalisedPath}`;
  } catch {
    return null;
  }
};

export const shouldProcessLayoutsUrl = (url: string): boolean => {
  if (typeof url !== 'string' || !url) {
    return false;
  }
  const normalised = normaliseUrl(url);
  if (!normalised) {
    return false;
  }
  return normalised === LAYOUTS_ENDPOINT_KEY;
};

const getContentType = (response: Response): string | undefined => {
  const headers = response.headers();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') {
      return value;
    }
  }
  return undefined;
};

const toSnapshot = (clock: LayoutsRecorderClock): SnapshotInfo => {
  const snapshotTsMs = Math.trunc(clock.now());
  const snapshotDateUtc = new Date(snapshotTsMs).toISOString().slice(0, 10);
  return { snapshotTsMs, snapshotDateUtc };
};

const ensureSnapshotDirs = (snapshot: SnapshotInfo) => {
  const baseDir = path.join(process.cwd(), 'data', 'app', 'layouts', snapshot.snapshotDateUtc);
  ensureDirectorySync(baseDir);
  ensureDirectorySync(path.join(baseDir, 'raw'));
  return baseDir;
};

const appendJsonLines = async (filePath: string, layouts: readonly RawLayout[]): Promise<void> => {
  if (!layouts.length) {
    return;
  }
  ensureDirectoryForFileSync(filePath);
  const payload = layouts.map((layout) => JSON.stringify(layout)).join('\n');
  await appendFile(filePath, `${payload}\n`);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRawLayout = (value: unknown): value is RawLayout => {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.id === 'string' && value.id.trim().length > 0;
};

const isRawWidget = (value: unknown): value is RawWidget => {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.id === 'string' && value.id.trim().length > 0;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

const toStringValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const buildLayoutRows = (
  layouts: readonly RawLayout[],
  snapshot: SnapshotInfo,
): CsvRowInput<typeof LAYOUTS_INDEX_HEADER>[] => {
  return layouts.map((layout) => ({
    snapshot_ts_ms: snapshot.snapshotTsMs,
    snapshot_date_utc: snapshot.snapshotDateUtc,
    layout_id: toStringValue(layout.id),
    version: toStringValue(layout.version),
    name: toStringValue(layout.name),
    icon: toStringValue(layout.icon),
    widget_count: Array.isArray(layout.widgets) ? (layout.widgets as unknown[]).length : 0,
  }));
};

const buildWidgetRows = (
  layouts: readonly RawLayout[],
  snapshot: SnapshotInfo,
): CsvRowInput<typeof WIDGETS_HEADER>[] => {
  const rows: CsvRowInput<typeof WIDGETS_HEADER>[] = [];
  for (const layout of layouts) {
    const widgets = Array.isArray(layout.widgets)
      ? (layout.widgets as unknown[]).filter(isRawWidget)
      : [];
    for (const widget of widgets) {
      rows.push({
        snapshot_ts_ms: snapshot.snapshotTsMs,
        snapshot_date_utc: snapshot.snapshotDateUtc,
        layout_id: toStringValue(layout.id),
        layout_name: toStringValue(layout.name),
        widget_id: toStringValue(widget.id),
        widgetType: toStringValue(widget.widgetType),
        typeSlot: toNumber(widget.typeSlot),
        pos_x: toNumber(widget.position?.x),
        pos_y: toNumber(widget.position?.y),
        size_height: toNumber(widget.size?.height),
        size_width: toNumber(widget.size?.width),
      });
    }
  }
  return rows;
};

const keyLayoutsIndexRow = (row: CsvRowInput<typeof LAYOUTS_INDEX_HEADER>): string =>
  `${row.snapshot_ts_ms ?? 'unknown'}:${row.layout_id ?? 'unknown'}`;

const keyWidgetRow = (row: CsvRowInput<typeof WIDGETS_HEADER>): string =>
  `${row.snapshot_ts_ms ?? 'unknown'}:${row.layout_id ?? 'unknown'}:${row.widget_id ?? 'unknown'}`;

const processLayoutsPayload = async (
  payload: unknown,
  clock: LayoutsRecorderClock,
  logger: LayoutsRecorderLogger,
): Promise<ProcessResult | null> => {
  if (!isPlainObject(payload) || !Array.isArray(payload.layouts)) {
    logger.writeGeneral({ kind: 'layouts-snapshot-invalid', reason: 'missing-layouts-array' });
    return null;
  }

  const rawLayouts = payload.layouts;
  const layouts = rawLayouts.filter(isRawLayout);
  if (rawLayouts.length > 0 && layouts.length === 0) {
    logger.writeGeneral({ kind: 'layouts-snapshot-invalid', reason: 'no-valid-layouts' });
    return null;
  }

  const snapshot = toSnapshot(clock);
  const baseDir = ensureSnapshotDirs(snapshot);

  const rawPath = path.join(baseDir, 'raw', `hippo_bw_layouts_${snapshot.snapshotTsMs}.json`);
  const jsonlPath = path.join(baseDir, 'layouts.jsonl');
  const layoutsIndexPath = path.join(baseDir, 'layouts_index.csv');
  const widgetsPath = path.join(baseDir, 'widgets.csv');

  await writeFile(rawPath, `${JSON.stringify(payload, null, 2)}\n`);
  await appendJsonLines(jsonlPath, layouts);

  const layoutRows = buildLayoutRows(layouts, snapshot);
  const widgetRows = buildWidgetRows(layouts, snapshot);

  await upsertCsv(layoutsIndexPath, LAYOUTS_INDEX_HEADER, layoutRows, keyLayoutsIndexRow);
  await upsertCsv(widgetsPath, WIDGETS_HEADER, widgetRows, keyWidgetRow);

  return {
    snapshot,
    layoutCount: layouts.length,
    widgetCount: widgetRows.length,
    rawPath,
    jsonlPath,
    layoutsIndexPath,
    widgetsPath,
  };
};

export function registerLayoutsRecorder(
  target: LayoutsRecorderTarget,
  clock: LayoutsRecorderClock,
  logger: LayoutsRecorderLogger,
): LayoutsRecorderHandle {
  const handleResponse = async (response: Response): Promise<void> => {
    const url = response.url();
    if (!shouldProcessLayoutsUrl(url)) {
      return;
    }

    const status = response.status();
    const contentType = getContentType(response);

    if (status >= 400) {
      logger.writeGeneral({ kind: 'layouts-snapshot-skip', reason: 'http-error', url, status });
      return;
    }

    if (!contentType || !JSON_MIME_PATTERN.test(contentType)) {
      logger.writeGeneral({
        kind: 'layouts-snapshot-skip',
        reason: 'non-json',
        url,
        status,
        contentType,
      });
      return;
    }

    logger.writeGeneral({ kind: 'layouts-snapshot-detected', url, status, contentType });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      logger.writeGeneral({
        kind: 'layouts-snapshot-error',
        reason: 'json-parse',
        url,
        status,
        error: toErrorMessage(error),
      });
      return;
    }

    try {
      const result = await processLayoutsPayload(payload, clock, logger);
      if (!result) {
        return;
      }
      logger.writeGeneral({
        kind: 'layouts-snapshot-written',
        url,
        status,
        snapshot_ts_ms: result.snapshot.snapshotTsMs,
        snapshot_date_utc: result.snapshot.snapshotDateUtc,
        layout_count: result.layoutCount,
        widget_count: result.widgetCount,
        raw_path: result.rawPath,
        jsonl_path: result.jsonlPath,
        layouts_index_path: result.layoutsIndexPath,
        widgets_path: result.widgetsPath,
      });
    } catch (error) {
      logger.writeGeneral({
        kind: 'layouts-snapshot-error',
        reason: 'persist-failed',
        url,
        status,
        error: toErrorMessage(error),
      });
    }
  };

  const listener = (response: Response) => {
    void handleResponse(response);
  };

  target.on('response', listener);

  return {
    unregister: () => {
      target.off('response', listener);
    },
  };
}
