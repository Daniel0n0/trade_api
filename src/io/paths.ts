import path from 'node:path';
import {
  ensureDirectoryForFileSync,
  ensureDirectorySync,
  formatStrikeForFilename,
} from './dir.js';

const DEFAULT_SYMBOL = 'GENERAL';

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

export function ensureSymbolDateDir(symbol?: string): string {
  const base = path.join(process.cwd(), 'data', sanitizeSegment(symbol), currentDateFolder());
  ensureDirectorySync(base);
  return base;
}

export function dataPath(symbol: string | undefined, ...segments: string[]): string {
  const baseDir = ensureSymbolDateDir(symbol);
  if (segments.length === 0) {
    return baseDir;
  }
  const target = path.join(baseDir, ...segments);
  ensureDirectoryForFileSync(target);
  return target;
}

export function strikeDataPath(
  symbol: string | undefined,
  strike: number | string | null | undefined,
  ...segments: string[]
): string {
  const strikeSegment = formatStrikeForFilename(strike);
  return dataPath(symbol, strikeSegment, ...segments);
}
