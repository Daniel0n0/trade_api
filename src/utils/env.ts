export const ENV = {
  HEADLESS: process.env.HEADLESS === '1',
  DEBUG_NETWORK: process.env.DEBUG_NETWORK === '1',
  WS_ONLY: process.env.WS_ONLY === '1',
  PERSIST_COOKIES: process.env.PERSIST_COOKIES === '1',
  USE_INDEXEDDB_CLONE: process.env.USE_INDEXEDDB_CLONE === '1',
} as const;

export type EnvFlags = typeof ENV;
