import path from 'node:path';
import process from 'node:process';

import { DateTime } from 'luxon';

import {
  ModuleArgsSchema,
  DATA_SINK_VALUES,
  LOGIN_MODE_VALUES,
  CREDENTIAL_SOURCE_VALUES,
  URL_MODE_VALUES,
  type ModuleArgsInput,
} from './schema.js';
import type { ModuleArgs } from '../orchestrator/messages.js';
import { getModuleUrlCode } from '../config.js';

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

  return dt.toUTC().toISO({ suppressMilliseconds: true }) ?? undefined;
}

function sanitizeToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9._-]+/gu, '-');
}

export function deriveOutPrefix({
  module,
  action,
  symbols,
  timestamp,
  baseDir,
}: {
  module: string;
  action?: string;
  symbols?: readonly string[];
  timestamp?: unknown;
  baseDir?: string;
}): string {
  const dtIso = coerceISO(timestamp ?? DateTime.utc(), { label: 'timestamp' });
  const dt = dtIso ? DateTime.fromISO(dtIso, { zone: 'utc' }) : DateTime.utc();
  const stamp = dt.toFormat('yyyyLLdd-HHmmss');
  const safeModule = sanitizeToken(module);
  const safeAction = sanitizeToken(action ?? 'run');
  const symbolPart = symbols && symbols.length > 0 ? symbols.map(sanitizeToken).join('+') : null;
  const segments = [safeModule, safeAction, stamp];
  if (symbolPart) {
    segments.push(symbolPart);
  }
  const filename = segments.filter((part) => part.length > 0).join('-');
  return baseDir ? path.join(baseDir, filename) : filename;
}

type EnvMapping<T extends object> = {
  [K in keyof T]?:
    | string
    | readonly string[]
    | { readonly key: string; readonly transform?: (value: string) => unknown }
    | readonly { readonly key: string; readonly transform?: (value: string) => unknown }[];
};

export function mapEnvFallbacks<T extends object>(
  source: T,
  mapping: EnvMapping<T>,
  env: NodeJS.ProcessEnv = process.env,
): T {
  const result = { ...(source as Record<string, unknown>) } as Record<string, unknown>;

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

function toOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`El ${label} debe ser numérico.`);
}

function normalizeEnumValue<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
  mapper?: (input: string) => string,
): T | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const asString = typeof value === 'string' ? value : String(value);
  const candidate = mapper ? mapper(asString) : asString;
  const match = allowed.find((item) => item === candidate);
  if (!match) {
    throw new Error(`El ${label} debe ser uno de: ${allowed.join(', ')}.`);
  }

  return match;
}

export function normalizeModuleArgs(input: Partial<ModuleArgsInput>): ModuleArgs {
  const moduleName = toOptionalString(input.module);
  const normalized = {
    module: moduleName,
    action: toOptionalString(input.action) ?? 'now',
    symbols: parseSymbols(input.symbols),
    headless: coerceBool(input.headless, 'headless'),
    start: coerceISO(input.start, { label: 'start' }),
    end: coerceISO(input.end, { label: 'end' }),
    closeOnFinish: coerceBool(input.closeOnFinish, 'closeOnFinish'),
    outPrefix: toOptionalString(input.outPrefix),
    dataSink: normalizeEnumValue(input.dataSink, 'dataSink', DATA_SINK_VALUES, (raw) =>
      raw.trim().toLowerCase(),
    ),
    parentId: toOptionalString(input.parentId),
    loginMode: normalizeEnumValue(input.loginMode, 'loginMode', LOGIN_MODE_VALUES, (raw) =>
      raw.trim().toLowerCase(),
    ),
    credSource: normalizeEnumValue(input.credSource, 'credSource', CREDENTIAL_SOURCE_VALUES, (raw) =>
      raw.trim().toLowerCase(),
    ),
    optionsDate: coerceISO(input.optionsDate, { label: 'optionsDate' }),
    optionsHorizon: toOptionalNumber(input.optionsHorizon, 'optionsHorizon'),
    urlMode: normalizeEnumValue(input.urlMode, 'urlMode', URL_MODE_VALUES, (raw) => raw.trim().toLowerCase()),
    urlCode: toOptionalString(input.urlCode) ?? (moduleName ? getModuleUrlCode(moduleName) : undefined),
    persistCookies: coerceBool(input.persistCookies, 'persistCookies'),
    persistIndexedDb: coerceBool(input.persistIndexedDb, 'persistIndexedDb'),
    storageStatePath: toOptionalString(input.storageStatePath),
    indexedDbSeed: toOptionalString(input.indexedDbSeed),
    indexedDbProfile: toOptionalString(input.indexedDbProfile),
  } satisfies Partial<ModuleArgsInput>;

  return ModuleArgsSchema.parse(normalized as ModuleArgsInput);
}

export function mergeArgChain(
  ...sources: ReadonlyArray<Partial<ModuleArgsInput> | ModuleArgs | undefined>
): Partial<ModuleArgsInput> {
  const target: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const [key, value] of Object.entries(source) as [keyof ModuleArgsInput, unknown][]) {
      if (value === undefined) {
        continue;
      }
      target[key as string] = value;
    }
  }
  return target as Partial<ModuleArgsInput>;
}
