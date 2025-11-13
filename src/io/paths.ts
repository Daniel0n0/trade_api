import path from 'node:path';
import {
  ensureDirectoryForFileSync,
  ensureDirectorySync,
  formatStrikeForFilename,
} from './dir.js';

const DEFAULT_SYMBOL = 'GENERAL';
const DEFAULT_ASSET_CLASS = 'general';

export type AssetPathInput =
  | string
  | undefined
  | {
      readonly assetClass?: string;
      readonly symbol?: string;
      readonly date?: string | Date;
    };

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

const sanitizeAssetClass = (input: string | undefined): string => {
  const sanitized = sanitizeSegment(input).toLowerCase();
  const normalized = sanitized || DEFAULT_ASSET_CLASS;
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

export function ensureSymbolDateDir(input?: AssetPathInput): string {
  const { assetClass, symbol, date } = normalizeAssetPathInput(input);
  const base = path.join(process.cwd(), 'data', assetClass, symbol, date);
  ensureDirectorySync(base);
  return base;
}

export function dataPath(input: AssetPathInput, ...segments: string[]): string {
  const baseDir = ensureSymbolDateDir(input);
  if (segments.length === 0) {
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
