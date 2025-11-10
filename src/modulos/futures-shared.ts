import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Response } from 'playwright';

import { ensureDirectoryForFileSync } from '../io/dir.js';
import {
  FUTURES_CONTRACTS_BY_SYMBOL_PATTERN,
  FUTURES_CONTRACTS_PATTERN,
  FUTURES_FUNDAMENTALS_PATTERN,
  FUTURES_HISTORICAL_PATTERN,
  FUTURES_MARKET_HOURS_PATTERN,
  FUTURES_SNAPSHOT_PATTERN,
  FUTURES_TRADING_SESSIONS_PATTERN,
} from '../modules/futures/interceptor.js';
import { safeJsonParse } from '../utils/payload.js';

const FUTURES_CONTRACT_CODE_PATTERN = /^[A-Z]{1,5}[FGHJKMNQUVXZ][0-9]{1,2}$/;
const DISCOVERY_LISTS_SAFE_SEGMENT =
  'discovery\\/lists(?!\\/(?:historicals|snapshots))(?:\\/(?!historicals(?:\\/|$)|snapshots(?:\\/|$))[^?#]*)*';

const FUTURES_DISCOVERY_SEGMENTS = [
  'futures',
  'contract',
  'marketdata',
  'phoenix',
  'instruments',
  DISCOVERY_LISTS_SAFE_SEGMENT,
] as const;

const FUTURES_DISCOVERY_URL_PATTERN = new RegExp(
  `(?:${FUTURES_DISCOVERY_SEGMENTS.join('|')})`,
  'i',
);
const CACHE_PATH = path.join(process.cwd(), 'state', 'futures', 'known-contracts.json');
const JSON_INDENT = 2;
const MAX_SCAN_NODES = 10_000;

export type FuturesContractCache = {
  readonly updatedAt: string;
  readonly symbols: readonly string[];
};

let inMemoryCache: FuturesContractCache | null = null;

const normalizeContractCode = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toUpperCase();
  return FUTURES_CONTRACT_CODE_PATTERN.test(normalized) ? normalized : null;
};

const normaliseCacheSymbols = (symbols: unknown): string[] => {
  if (!Array.isArray(symbols)) {
    return [];
  }
  const unique = new Set<string>();
  for (const candidate of symbols) {
    const normalized = normalizeContractCode(candidate);
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return Array.from(unique).sort();
};

const readCacheFromDisk = async (): Promise<FuturesContractCache> => {
  if (inMemoryCache) {
    return inMemoryCache;
  }

  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (parsed) {
      const symbols = normaliseCacheSymbols(parsed.symbols);
      const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString();
      inMemoryCache = { updatedAt, symbols };
      return inMemoryCache;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[futures-contracts] No se pudo leer la caché de contratos:', error);
    }
  }

  inMemoryCache = { updatedAt: new Date(0).toISOString(), symbols: [] };
  return inMemoryCache;
};

const writeCacheToDisk = async (symbols: readonly string[]): Promise<FuturesContractCache> => {
  const payload: FuturesContractCache = {
    updatedAt: new Date().toISOString(),
    symbols: Array.from(symbols).sort(),
  };

  ensureDirectoryForFileSync(CACHE_PATH);
  await writeFile(CACHE_PATH, `${JSON.stringify(payload, null, JSON_INDENT)}\n`, 'utf8');
  inMemoryCache = payload;
  return payload;
};

export const getFuturesContractCachePath = (): string => CACHE_PATH;

export const loadFuturesContractCache = async (): Promise<FuturesContractCache> => {
  const cache = await readCacheFromDisk();
  return { updatedAt: cache.updatedAt, symbols: [...cache.symbols] };
};

export const rememberFuturesContractCodes = async (
  codes: Iterable<string>,
): Promise<{ added: string[]; cache: FuturesContractCache; path: string }> => {
  const cache = await readCacheFromDisk();
  const known = new Set(cache.symbols);
  const additions: string[] = [];

  for (const candidate of codes) {
    const normalized = normalizeContractCode(candidate);
    if (!normalized || known.has(normalized)) {
      continue;
    }
    known.add(normalized);
    additions.push(normalized);
  }

  if (additions.length === 0) {
    return { added: [], cache, path: CACHE_PATH };
  }

  const nextCache = await writeCacheToDisk(known);
  return { added: additions, cache: nextCache, path: CACHE_PATH };
};

export const resetFuturesContractCacheForTesting = async (): Promise<void> => {
  inMemoryCache = null;
  await rm(CACHE_PATH, { force: true }).catch(() => undefined);
};

export const createContractUpdater = (label: string) => {
  return async (symbols: readonly string[]): Promise<void> => {
    if (!symbols || symbols.length === 0) {
      return;
    }

    try {
      const { added } = await rememberFuturesContractCodes(symbols);
      if (added.length > 0) {
        console.info(`[${label}] Nuevos contratos detectados: ${added.join(', ')}`);
      }
    } catch (error) {
      console.warn(`[${label}] No se pudo actualizar la caché de contratos:`, error);
    }
  };
};

type ContractTrackerOptions = {
  readonly onSymbols?: (symbols: readonly string[]) => void;
};

export type FuturesContractTrackerHandle = {
  readonly close: () => void;
};

const extractContractCodes = (payload: unknown): string[] => {
  const results = new Set<string>();
  const queue: unknown[] = [payload];
  let processed = 0;

  while (queue.length > 0 && processed < MAX_SCAN_NODES) {
    const current = queue.pop();
    processed += 1;

    if (typeof current === 'string') {
      const normalized = normalizeContractCode(current);
      if (normalized) {
        results.add(normalized);
      }
      continue;
    }

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === 'string') {
        const normalized = normalizeContractCode(value);
        if (normalized) {
          results.add(normalized);
          continue;
        }
      }
      if (typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return Array.from(results);
};

const shouldInspectResponse = (response: Response): boolean => {
  if (response.status() >= 400) {
    return false;
  }
  const url = response.url();
  if (FUTURES_HISTORICAL_PATTERN.test(url) || FUTURES_SNAPSHOT_PATTERN.test(url)) {
    // Estos endpoints ya están cubiertos por el interceptor principal.
    return false;
  }
  if (!FUTURES_DISCOVERY_URL_PATTERN.test(url)) {
    return false;
  }
  const headers = response.headers();
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  return typeof contentType === 'string' ? /json/i.test(contentType) : false;
};

export const installFuturesContractTracker = (
  page: Page,
  options: ContractTrackerOptions = {},
): FuturesContractTrackerHandle => {
  const seen = new Set<string>();

  const handleResponse = async (response: Response) => {
    if (!shouldInspectResponse(response)) {
      return;
    }

    let parsed: unknown;
    try {
      const body = await response.body();
      parsed = safeJsonParse<unknown>(body.toString('utf8'));
    } catch (error) {
      console.warn('[futures-contracts] No se pudo analizar una respuesta JSON:', error);
      return;
    }

    if (!parsed) {
      return;
    }

    const discovered = extractContractCodes(parsed).filter((symbol) => !seen.has(symbol));
    if (discovered.length === 0) {
      return;
    }

    for (const symbol of discovered) {
      seen.add(symbol);
    }

    if (options.onSymbols) {
      try {
        options.onSymbols(discovered);
      } catch (error) {
        console.warn('[futures-contracts] Error al notificar símbolos detectados:', error);
      }
    } else {
      void rememberFuturesContractCodes(discovered).catch((error) => {
        console.warn('[futures-contracts] No se pudo persistir símbolos detectados:', error);
      });
    }
  };

  page.on('response', handleResponse);

  return {
    close: () => {
      page.off('response', handleResponse);
    },
  } satisfies FuturesContractTrackerHandle;
};

export const waitForFuturesData = async (page: Page, timeoutMs = 15_000): Promise<boolean> => {
  try {
    await page.waitForResponse(
      (response) => {
        if (response.status() >= 400) {
          return false;
        }
        const url = response.url();
        return (
          FUTURES_HISTORICAL_PATTERN.test(url) ||
          FUTURES_SNAPSHOT_PATTERN.test(url) ||
          FUTURES_FUNDAMENTALS_PATTERN.test(url) ||
          FUTURES_MARKET_HOURS_PATTERN.test(url) ||
          FUTURES_CONTRACTS_PATTERN.test(url) ||
          FUTURES_CONTRACTS_BY_SYMBOL_PATTERN.test(url) ||
          FUTURES_TRADING_SESSIONS_PATTERN.test(url) ||
          FUTURES_DISCOVERY_URL_PATTERN.test(url)
        );
      },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
};
