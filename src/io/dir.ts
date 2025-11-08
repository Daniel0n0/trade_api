import { mkdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_STRIKE_FILENAME = 'UNKNOWN-STRIKE';

function normaliseDirectory(directory: string | null | undefined): string | null {
  if (directory === null || directory === undefined) {
    return null;
  }
  const trimmed = directory.trim();
  if (!trimmed || trimmed === '.') {
    return null;
  }
  return trimmed;
}

export function ensureDirectorySync(directory: string | null | undefined): string | null {
  const normalised = normaliseDirectory(directory);
  if (!normalised) {
    return null;
  }
  mkdirSync(normalised, { recursive: true });
  return normalised;
}

export async function ensureDirectory(directory: string | null | undefined): Promise<string | null> {
  const normalised = normaliseDirectory(directory);
  if (!normalised) {
    return null;
  }
  await mkdir(normalised, { recursive: true });
  return normalised;
}

export function ensureDirectoryForFileSync(filePath: string): string | null {
  const directory = dirname(filePath);
  return ensureDirectorySync(directory);
}

export async function ensureDirectoryForFile(filePath: string): Promise<string | null> {
  const directory = dirname(filePath);
  return ensureDirectory(directory);
}

const INVALID_STRIKE_CHARACTERS = /[^0-9A-Za-z_-]+/g;
const DASH_TRIM = /^-+|-+$/g;
const DASH_DUPLICATES = /-{2,}/g;

function normaliseStrikeInput(strike: number | string): string {
  if (typeof strike === 'number') {
    if (!Number.isFinite(strike)) {
      return DEFAULT_STRIKE_FILENAME;
    }
    return strike.toString();
  }
  return String(strike);
}

export function formatStrikeForFilename(strike: number | string | null | undefined): string {
  if (strike === null || strike === undefined) {
    return DEFAULT_STRIKE_FILENAME;
  }
  const raw = normaliseStrikeInput(strike).trim();
  if (!raw) {
    return DEFAULT_STRIKE_FILENAME;
  }
  const replaced = raw.replace(/,/g, '').replace(/\s+/g, '-').replace(/\./g, 'p');
  const sanitised = replaced.replace(INVALID_STRIKE_CHARACTERS, '-').replace(DASH_DUPLICATES, '-').replace(DASH_TRIM, '');
  return sanitised || DEFAULT_STRIKE_FILENAME;
}
