import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ensureDirectoryForFileSync,
  ensureDirectorySync,
  formatStrikeForFilename,
} from './dir.js';

const DEFAULT_SYMBOL = 'GENERAL';
const DEFAULT_ASSET_CLASS = 'stocks';

export type AssetPathInput =
  | string
  | undefined
  | {
      readonly assetClass?: string;
      readonly symbol?: string;
      readonly date?: string | Date;
    };

type AppPathInput = { readonly kind: 'app'; readonly segments?: readonly string[] };

type DataPathInput = AssetPathInput | AppPathInput;

const resolveDataRoot = (baseDir: string): string => {
  const override = process.env.DATA_ROOT?.trim();
  if (override) {
    const absolute = path.isAbsolute(override) ? override : path.resolve(baseDir, override);
    ensureDirectorySync(absolute);
    return absolute;
  }

  const target = path.join(baseDir, 'debug_results', 'data');
  const legacyRoots = [path.join(baseDir, 'debug_results', '_data'), path.join(baseDir, 'data')];

  // Legacy locations must be manually cleared to avoid mixing sessions.
  const foundLegacyRoots = legacyRoots.filter((legacy) => legacy !== target && existsSync(legacy));
  if (foundLegacyRoots.length > 0) {
    throw new Error(
      [
        'Legacy data directories detected. Please delete or archive them before starting a new session.',
        `Found: ${foundLegacyRoots.join(', ')}`,
        `Expected clean data root at: ${target}`,
      ].join('\n'),
    );
  }

  ensureDirectorySync(target);
  return target;
};

export const getDataRoot = (baseDir: string = process.cwd()): string => resolveDataRoot(baseDir);

const sanitizeSegment = (input: string | undefined): string => {
  if (!input) {
    return DEFAULT_SYMBOL;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_SYMBOL;
  }
  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120) || DEFAULT_SYMBOL;
};

const currentDateFolder = (): string => {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const ASSET_CLASS_ALIASES: Record<string, string> = {
  stock: 'stocks',
  stocks: 'stocks',
  equity: 'stocks',
  option: 'stocks',
  options: 'stocks',
  future: 'futures',
  futures: 'futures',
};

export const sanitizeAssetClass = (input: string | undefined): string => {
  const sanitized = sanitizeSegment(input);
  if (input === undefined || sanitized === DEFAULT_SYMBOL) {
    return DEFAULT_ASSET_CLASS;
  }
  const normalized = sanitized.toLowerCase() || DEFAULT_ASSET_CLASS;
  return ASSET_CLASS_ALIASES[normalized] ?? normalized;
};

const sanitizeDateSegment = (input: string | Date | undefined): string => {
  if (input instanceof Date) {
    const year = String(input.getFullYear());
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const day = String(input.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
      }
      if (/^\d{4}\d{2}\d{2}$/.test(trimmed)) {
        const year = trimmed.slice(0, 4);
        const month = trimmed.slice(4, 6);
        const day = trimmed.slice(6, 8);
        return `${year}-${month}-${day}`;
      }
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return sanitizeDateSegment(parsed);
      }
    }
  }

  return currentDateFolder();
};

const normalizeAssetPathInput = (input: AssetPathInput): { assetClass: string; symbol: string; date: string } => {
  if (typeof input === 'string' || input === undefined) {
    return {
      assetClass: DEFAULT_ASSET_CLASS,
      symbol: sanitizeSegment(typeof input === 'string' ? input : undefined),
      date: currentDateFolder(),
    };
  }

  return {
    assetClass: sanitizeAssetClass(input.assetClass),
    symbol: sanitizeSegment(input.symbol),
    date: sanitizeDateSegment(input.date),
  };
};

const isAppPathInput = (input: DataPathInput): input is AppPathInput =>
  typeof input === 'object' && input !== null && (input as { kind?: string }).kind === 'app';

const sanitizeAppSegments = (segments: readonly string[] | undefined): string[] => {
  if (!segments || segments.length === 0) {
    return [];
  }
  return segments
    .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
    .filter((segment): segment is string => segment.length > 0);
};

const ensureAppDir = (segments: readonly string[]): string => {
  const baseDir = path.join(getDataRoot(), 'app', ...segments);
  ensureDirectorySync(baseDir);
  return baseDir;
};

export function ensureSymbolDateDir(input?: AssetPathInput): string {
  const { assetClass, symbol, date } = normalizeAssetPathInput(input);
  const base = path.join(getDataRoot(), assetClass, symbol, date);
  ensureDirectorySync(base);
  return base;
}

export function dataPath(input: DataPathInput, ...segments: string[]): string {
  if (isAppPathInput(input)) {
    const baseDir = ensureAppDir(sanitizeAppSegments(input.segments));
    if (segments.length === 0) {
      return baseDir;
    }
    const target = path.join(baseDir, ...segments);
    ensureDirectoryForFileSync(target);
    return target;
  }

  const baseDir = ensureSymbolDateDir(input);
  if (segments.length === 0) {
    return baseDir;
  }
  const target = path.join(baseDir, ...segments);
  ensureDirectoryForFileSync(target);
  return target;
}

export function marketDataPath(input: AssetPathInput, ...segments: string[]): string {
  const { assetClass, symbol, date } = normalizeAssetPathInput(input);
  const baseDir = path.join(getDataRoot(), 'marketdata', assetClass, symbol, date);

  if (segments.length === 0) {
    ensureDirectorySync(baseDir);
    return baseDir;
  }

  const target = path.join(baseDir, ...segments);
  ensureDirectoryForFileSync(target);
  return target;
}

export function strikeDataPath(
  input: AssetPathInput,
  strike: number | string | null | undefined,
  ...segments: string[]
): string {
  const strikeSegment = formatStrikeForFilename(strike);
  return dataPath(input, strikeSegment, ...segments);
}
