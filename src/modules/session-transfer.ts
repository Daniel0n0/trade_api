import fs from 'node:fs/promises';
import path from 'node:path';

import type { BrowserContext, Page } from 'playwright';

// Define StorageState type if not using @playwright/test
type StorageState = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins?: Array<{
    origin: string;
    localStorage?: Array<{ name: string; value: string }>;
  }>;
};

import { FLAGS } from '../bootstrap/env.js';

const INDEXED_DB_SEEDS_DIR = path.join(process.cwd(), 'state', 'indexeddb-seeds');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type IndexedDbRecordSeed = {
  readonly key?: unknown;
  readonly value: unknown;
};

type IndexedDbIndexSeed = {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly options?: { readonly unique?: boolean; readonly multiEntry?: boolean; readonly locale?: string };
};

type IndexedDbObjectStoreSeed = {
  readonly name: string;
  readonly options?: { readonly keyPath?: string | readonly string[]; readonly autoIncrement?: boolean };
  readonly indexes?: readonly IndexedDbIndexSeed[];
  readonly records?: readonly IndexedDbRecordSeed[];
};

type IndexedDbDatabaseSeed = {
  readonly name: string;
  readonly version?: number;
  readonly objectStores: readonly IndexedDbObjectStoreSeed[];
};

type IndexedDbSeed = {
  readonly origin: string;
  readonly databases: readonly IndexedDbDatabaseSeed[];
};

type ExtendedStorageState = StorageState & { readonly indexedDb?: readonly IndexedDbSeed[] };

export type HydrationOutcome = {
  readonly ok: boolean;
  readonly cookiesApplied: number;
  readonly localStorageApplied: number;
  readonly indexedDbApplied: number;
  readonly warnings: readonly string[];
};

function isIndexedDbRecordSeed(value: unknown): value is IndexedDbRecordSeed {
  if (!isRecord(value)) {
    return false;
  }

  return 'value' in value;
}

function isIndexedDbIndexSeed(value: unknown): value is IndexedDbIndexSeed {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.name === 'string' &&
    (typeof value.keyPath === 'string' || (Array.isArray(value.keyPath) && value.keyPath.every((item) => typeof item === 'string')));
}

function isIndexedDbObjectStoreSeed(value: unknown): value is IndexedDbObjectStoreSeed {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.name !== 'string') {
    return false;
  }

  if (value.options !== undefined && !isRecord(value.options)) {
    return false;
  }

  if (
    value.indexes !== undefined &&
    (!Array.isArray(value.indexes) || !value.indexes.every((item) => isIndexedDbIndexSeed(item)))
  ) {
    return false;
  }

  if (
    value.records !== undefined &&
    (!Array.isArray(value.records) || !value.records.every((item) => isIndexedDbRecordSeed(item)))
  ) {
    return false;
  }

  return true;
}

function isIndexedDbDatabaseSeed(value: unknown): value is IndexedDbDatabaseSeed {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.name !== 'string') {
    return false;
  }

  if (value.version !== undefined && typeof value.version !== 'number') {
    return false;
  }

  if (!Array.isArray(value.objectStores) || !value.objectStores.every((item) => isIndexedDbObjectStoreSeed(item))) {
    return false;
  }

  return true;
}

function isIndexedDbSeed(value: unknown): value is IndexedDbSeed {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.origin !== 'string') {
    return false;
  }

  if (!Array.isArray(value.databases) || !value.databases.every((item) => isIndexedDbDatabaseSeed(item))) {
    return false;
  }

  return true;
}

function normaliseIndexedDbSeeds(value: unknown): readonly IndexedDbSeed[] | null {
  if (Array.isArray(value) && value.every((item) => isIndexedDbSeed(item))) {
    return value;
  }

  if (isRecord(value)) {
    if (Array.isArray(value.seeds) && value.seeds.every((item) => isIndexedDbSeed(item))) {
      return value.seeds;
    }

    if (Array.isArray(value.indexedDb) && value.indexedDb.every((item) => isIndexedDbSeed(item))) {
      return value.indexedDb;
    }
  }

  return null;
}

async function readJsonFile(filepath: string): Promise<unknown | null> {
  try {
    const content = await fs.readFile(filepath, 'utf8');
    return JSON.parse(content) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function loadStorageState(filepath: string): Promise<ExtendedStorageState | null> {
  const data = await readJsonFile(filepath);
  if (!data) {
    return null;
  }

  return data as ExtendedStorageState;
}

async function loadIndexedDbSeedsFromDisk(seedName: string): Promise<readonly IndexedDbSeed[] | null> {
  const candidates = [
    seedName,
    path.join(INDEXED_DB_SEEDS_DIR, `${seedName}.json`),
    path.join(INDEXED_DB_SEEDS_DIR, seedName, 'indexeddb.json'),
    path.join(INDEXED_DB_SEEDS_DIR, seedName, 'seed.json'),
  ];

  for (const candidate of candidates) {
    const payload = await readJsonFile(candidate);
    if (!payload) {
      continue;
    }

    const seeds = normaliseIndexedDbSeeds(payload);
    if (seeds) {
      return seeds;
    }
  }

  return null;
}

async function resolveIndexedDbSeeds(state: ExtendedStorageState): Promise<readonly IndexedDbSeed[]> {
  if (state.indexedDb && state.indexedDb.length > 0) {
    return state.indexedDb;
  }

  if (FLAGS.indexedDbSeed) {
    const seeds = await loadIndexedDbSeedsFromDisk(FLAGS.indexedDbSeed);
    if (seeds) {
      return seeds;
    }
  }

  return [];
}

export async function hydrateModulePage(context: BrowserContext, page: Page): Promise<HydrationOutcome> {
  const warnings: string[] = [];
  let cookiesApplied = 0;
  let localStorageApplied = 0;
  let indexedDbApplied = 0;
  let ok = true;

  const storageStatePath = FLAGS.storageStatePath;
  let storageState: ExtendedStorageState | null = null;

  try {
    storageState = await loadStorageState(storageStatePath);
  } catch (error) {
    ok = false;
    warnings.push(
      `No se pudo leer el estado de almacenamiento desde ${storageStatePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!storageState) {
    return { ok: false, cookiesApplied, localStorageApplied, indexedDbApplied, warnings };
  }

  const shouldApplyCookies = FLAGS.persistCookies !== false;
  if (shouldApplyCookies && storageState.cookies && storageState.cookies.length > 0) {
    try {
      await context.addCookies(storageState.cookies);
      cookiesApplied = storageState.cookies.length;
    } catch (error) {
      ok = false;
      warnings.push(
        `No se pudieron hidratar las cookies desde ${storageStatePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const localStorageEntries =
    storageState.origins?.flatMap((origin) => {
      if (!origin.localStorage || origin.localStorage.length === 0) {
        return [] as const;
      }

      return [
        {
          origin: origin.origin,
          entries: origin.localStorage.map((item) => ({ name: item.name, value: item.value })),
        },
      ] as const;
    }) ?? [];

  for (const entry of localStorageEntries) {
    try {
      await page.addInitScript(
        ({ targetOrigin, items }) => {
          const global = window as typeof window & { __tradeApiHydratedLocalStorage?: Set<string> };
          global.__tradeApiHydratedLocalStorage ??= new Set<string>();
          if (global.__tradeApiHydratedLocalStorage.has(targetOrigin)) {
            return;
          }

          if (window.location.origin !== targetOrigin) {
            return;
          }

          try {
            for (const item of items) {
              window.localStorage.setItem(item.name, item.value);
            }
            global.__tradeApiHydratedLocalStorage.add(targetOrigin);
          } catch (err) {
            console.warn('[session-transfer] No se pudo hidratar localStorage:', err);
          }
        },
        { targetOrigin: entry.origin, items: entry.entries },
      );
      localStorageApplied += entry.entries.length;
    } catch (error) {
      ok = false;
      warnings.push(
        `No se pudo preparar la hidratación de localStorage para ${entry.origin}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const shouldApplyIndexedDb = FLAGS.persistIndexedDb || FLAGS.indexedDbSeed !== undefined;
  if (shouldApplyIndexedDb) {
    let seeds: readonly IndexedDbSeed[] = [];

    try {
      seeds = await resolveIndexedDbSeeds(storageState);
    } catch (error) {
      warnings.push(
        `No se pudo cargar la semilla de IndexedDB: ${error instanceof Error ? error.message : String(error)}`,
      );
      ok = false;
    }

    if (seeds.length > 0) {
      indexedDbApplied = seeds.length;

      try {
        await page.addInitScript(
          ({ payload }) => {
            const global = window as typeof window & { __tradeApiIndexedDbHydrated?: boolean };
            if (global.__tradeApiIndexedDbHydrated) {
              return;
            }
            global.__tradeApiIndexedDbHydrated = true;

            const seedsForOrigin = payload.filter((item) => item.origin === window.location.origin);
            if (seedsForOrigin.length === 0) {
              return;
            }

            const seedDatabase = (databaseSeed: IndexedDbDatabaseSeed): Promise<void> => {
              return new Promise((resolve, reject) => {
                const request = indexedDB.open(databaseSeed.name, databaseSeed.version);

                request.onerror = () => {
                  reject(request.error ?? new Error('IndexedDB open request failed'));
                };

                request.onupgradeneeded = () => {
                  const db = request.result;
                  const upgradeTx = request.transaction;
                  if (!upgradeTx) {
                    return;
                  }

                  const existingStores = Array.from(db.objectStoreNames);
                  for (const storeName of existingStores) {
                    if (!databaseSeed.objectStores.some((store) => store.name === storeName)) {
                      db.deleteObjectStore(storeName);
                    }
                  }

                  for (const storeSeed of databaseSeed.objectStores) {
                    const hasStore = db.objectStoreNames.contains(storeSeed.name);
                    // Convert readonly keyPath to mutable array if necessary
                    let options = storeSeed.options ? { ...storeSeed.options } : undefined;
                    if (options && Array.isArray(options.keyPath)) {
                      // Always convert to mutable array (string[])
                      options.keyPath = Array.from(options.keyPath);
                    }
                    // Ensure keyPath is mutable or undefined/null
                    if (options && options.keyPath !== undefined && options.keyPath !== null) {
                      if (Array.isArray(options.keyPath)) {
                        options.keyPath = options.keyPath.slice();
                      }
                    }
                    const store = hasStore
                      ? upgradeTx.objectStore(storeSeed.name)
                      : db.createObjectStore(storeSeed.name, options as IDBObjectStoreParameters | undefined);

                    const existingIndexes = Array.from(store.indexNames);
                    if (storeSeed.indexes && storeSeed.indexes.length > 0) {
                      for (const indexName of existingIndexes) {
                        if (!storeSeed.indexes.some((index) => index.name === indexName)) {
                          store.deleteIndex(indexName);
                        }
                      }

                      for (const indexSeed of storeSeed.indexes) {
                        if (!store.indexNames.contains(indexSeed.name)) {
                          store.createIndex(
                            indexSeed.name,
                            indexSeed.keyPath as string | string[],
                            indexSeed.options ?? undefined,
                          );
                        }
                      }
                    } else {
                      for (const indexName of existingIndexes) {
                        store.deleteIndex(indexName);
                      }
                    }
                  }
                };

                request.onsuccess = () => {
                  const db = request.result;
                  const storeNames = databaseSeed.objectStores.map((store) => store.name);
                  if (storeNames.length === 0) {
                    db.close();
                    resolve();
                    return;
                  }

                  const tx = db.transaction(storeNames, 'readwrite');
                  tx.oncomplete = () => {
                    db.close();
                    resolve();
                  };
                  tx.onerror = () => {
                    const error = tx.error ?? new Error('IndexedDB transaction failed');
                    db.close();
                    reject(error);
                  };

                  for (const storeSeed of databaseSeed.objectStores) {
                    const store = tx.objectStore(storeSeed.name);
                    store.clear();
                    if (!storeSeed.records) {
                      continue;
                    }

                    for (const record of storeSeed.records) {
                      try {
                        if (record.key !== undefined) {
                          store.put(record.value, record.key as IDBValidKey);
                        } else {
                          store.put(record.value);
                        }
                      } catch (err) {
                        console.warn('[session-transfer] No se pudo escribir un registro en IndexedDB:', err);
                      }
                    }
                  }
                };
              });
            };

            const run = async () => {
              for (const seed of seedsForOrigin) {
                for (const dbSeed of seed.databases) {
                  await seedDatabase(dbSeed);
                }
              }
            };

            void run().catch((error) => {
              console.warn('[session-transfer] No se pudo hidratar IndexedDB:', error);
            });
          },
          { payload: seeds },
        );
      } catch (error) {
        ok = false;
        warnings.push(
          `No se pudo preparar la hidratación de IndexedDB: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (FLAGS.persistIndexedDb) {
      warnings.push('PersistIndexedDb está habilitado pero no se encontraron semillas de IndexedDB para aplicar.');
    }
  }

  return { ok, cookiesApplied, localStorageApplied, indexedDbApplied, warnings };
}
