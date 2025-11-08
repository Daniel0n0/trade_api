import path from 'node:path';
import process from 'node:process';

import { DateTime } from 'luxon';

import { ModuleArgsSchema, type ModuleArgsInput } from './schema.js';
import type { ModuleArgs } from '../orchestrator/messages.js';

const BOOLEAN_TRUE = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE = new Set(['0', 'false', 'no', 'off']);

export function parseSymbols(input: unknown): string[] | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }

  const toParts = (value: unknown): string[] => {
    if (value === undefined || value === null) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap(toParts);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        return [];
      }
      return trimmed
        .split(/[\s,;]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    throw new Error('Las listas de símbolos deben ser cadenas o arreglos.');
  };

  const parts = toParts(input);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const symbol of parts) {
    const normalized = symbol.toUpperCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result.length > 0 ? result : undefined;
}

export function coerceBool(value: unknown, label = 'valor'): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') {
      return undefined;
    }
    if (BOOLEAN_TRUE.has(normalized)) {
      return true;
    }
    if (BOOLEAN_FALSE.has(normalized)) {
      return false;
    }
  }

  throw new Error(`El ${label} debe ser booleano. Usa true/false, yes/no, on/off o 1/0.`);
}

export function coerceISO(
  value: unknown,
  { label = 'valor', zone = 'utc' }: { label?: string; zone?: string } = {},
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const toDateTime = (raw: unknown): DateTime | null => {
    if (DateTime.isDateTime(raw)) {
      return raw as DateTime;
    }

    if (raw instanceof Date) {
      return DateTime.fromJSDate(raw);
    }

    if (typeof raw === 'number') {
      return DateTime.fromMillis(raw);
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed === '') {
        return null;
      }

      const parsed = DateTime.fromISO(trimmed, { zone });
      if (parsed.isValid) {
        return parsed;
      }

      const fromMillis = Number.parseFloat(trimmed);
      if (Number.isFinite(fromMillis)) {
        return DateTime.fromMillis(fromMillis);
      }
    }

    return null;
  };

  const dt = toDateTime(value);
  if (!dt || !dt.isValid) {
    throw new Error(`El ${label} debe ser una fecha en formato ISO 8601.`);
  }

  return dt.toUTC().toISO({ suppressMilliseconds: true });
}

function sanitizeToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9._-]+/gu, '-');
}

export function deriveOutPrefix({
  moduleName,
  action,
  symbols,
  timestamp,
  baseDir,
}: {
  moduleName: string;
  action?: string;
  symbols?: readonly string[];
  timestamp?: unknown;
  baseDir?: string;
}): string {
  const dtIso = coerceISO(timestamp ?? DateTime.utc(), { label: 'timestamp' });
  const dt = dtIso ? DateTime.fromISO(dtIso, { zone: 'utc' }) : DateTime.utc();
  const stamp = dt.toFormat('yyyyLLdd-HHmmss');
  const safeModule = sanitizeToken(moduleName);
  const safeAction = sanitizeToken(action ?? 'run');
  const symbolPart = symbols && symbols.length > 0 ? symbols.map(sanitizeToken).join('+') : null;
  const segments = [safeModule, safeAction, stamp];
  if (symbolPart) {
    segments.push(symbolPart);
  }
  const filename = segments.filter((part) => part.length > 0).join('-');
  return baseDir ? path.join(baseDir, filename) : filename;
}

type EnvMapping<T> = {
  [K in keyof T]?:
    | string
    | readonly string[]
    | { readonly key: string; readonly transform?: (value: string) => unknown }
    | readonly { readonly key: string; readonly transform?: (value: string) => unknown }[];
};

export function mapEnvFallbacks<T extends Record<string, unknown>>(
  source: T,
  mapping: EnvMapping<T>,
  env: NodeJS.ProcessEnv = process.env,
): T {
  const result: Record<string, unknown> = { ...source };

  for (const [property, descriptor] of Object.entries(mapping) as [keyof T, EnvMapping<T>[keyof T]][]) {
    const current = result[property as string];
    if (current !== undefined && current !== null && current !== '') {
      continue;
    }

    const entries = Array.isArray(descriptor) ? descriptor : [descriptor];
    for (const entry of entries) {
      if (!entry) {
        continue;
      }

      if (typeof entry === 'string') {
        const raw = env[entry];
        if (raw !== undefined) {
          result[property as string] = raw;
          break;
        }
        continue;
      }

      const raw = env[entry.key];
      if (raw === undefined) {
        continue;
      }
      result[property as string] = entry.transform ? entry.transform(raw) : raw;
      break;
    }
  }

  return result as T;
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  return String(value);
}

export function normalizeModuleArgs(input: Partial<ModuleArgsInput>): ModuleArgs {
  const normalized = {
    moduleName: toOptionalString(input.moduleName),
    action: toOptionalString(input.action) ?? 'now',
    startAt: coerceISO(input.startAt, { label: 'startAt' }),
    endAt: coerceISO(input.endAt, { label: 'endAt' }),
    persistCookies: coerceBool(input.persistCookies, 'persistCookies'),
    persistIndexedDb: coerceBool(input.persistIndexedDb, 'persistIndexedDb'),
    storageStatePath: toOptionalString(input.storageStatePath),
    indexedDbSeed: toOptionalString(input.indexedDbSeed),
    indexedDbProfile: toOptionalString(input.indexedDbProfile),
  } satisfies ModuleArgsInput;

  return ModuleArgsSchema.parse(normalized);
}

export function mergeArgChain(
  ...sources: ReadonlyArray<Partial<ModuleArgsInput> | undefined>
): Partial<ModuleArgsInput> {
  const target: Partial<ModuleArgsInput> = {};
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source) as [keyof ModuleArgsInput, unknown][]) {
      if (value === undefined) {
        continue;
      }
      target[key] = value as ModuleArgsInput[typeof key];
    }
  }
  return target;
}
