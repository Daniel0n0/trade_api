const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return fallback;
};

export const ENV = {
  HEADLESS: process.env.HEADLESS === '1',
  DEBUG_NETWORK: process.env.DEBUG_NETWORK === '1',
  WS_ONLY: process.env.WS_ONLY === '1',
  PERSIST_COOKIES: process.env.PERSIST_COOKIES === '1',
  USE_INDEXEDDB_CLONE: process.env.USE_INDEXEDDB_CLONE === '1',
  SAFE_GOTO_INITIAL_TIMEOUT_MS: toNumber(process.env.SAFE_GOTO_INITIAL_TIMEOUT_MS, 30_000),
  SAFE_GOTO_FINAL_TIMEOUT_MS: toNumber(process.env.SAFE_GOTO_FINAL_TIMEOUT_MS, 45_000),
  SAFE_GOTO_WAIT_BETWEEN_ATTEMPTS_MS: toNumber(
    process.env.SAFE_GOTO_WAIT_BETWEEN_ATTEMPTS_MS,
    500,
  ),
  SAFE_GOTO_ATTEMPTS: Math.max(
    1,
    Math.trunc(toNumber(process.env.SAFE_GOTO_ATTEMPTS, 2)),
  ),
} as const;

export type EnvFlags = typeof ENV;
