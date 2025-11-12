import type { Page, WaitUntilState } from 'playwright';

import { ENV } from './env.js';

export interface SafeGotoOptions {
  attempts?: number;
  initialWaitUntil?: WaitUntilState;
  finalWaitUntil?: WaitUntilState;
  initialTimeoutMs?: number;
  finalTimeoutMs?: number;
  waitBetweenAttemptsMs?: number;
}

export const DEFAULT_SAFE_GOTO_OPTIONS: Required<Omit<SafeGotoOptions, 'attempts'>> & {
  attempts: number;
} = {
  attempts: ENV.SAFE_GOTO_ATTEMPTS,
  initialWaitUntil: 'domcontentloaded',
  finalWaitUntil: 'load',
  initialTimeoutMs: ENV.SAFE_GOTO_INITIAL_TIMEOUT_MS,
  finalTimeoutMs: ENV.SAFE_GOTO_FINAL_TIMEOUT_MS,
  waitBetweenAttemptsMs: ENV.SAFE_GOTO_WAIT_BETWEEN_ATTEMPTS_MS,
};

const isFirstAttempt = (index: number): boolean => index === 0;

export async function safeGoto(page: Page, url: string, options?: SafeGotoOptions): Promise<void> {
  const resolvedOptions = {
    ...DEFAULT_SAFE_GOTO_OPTIONS,
    ...options,
    attempts: Math.max(options?.attempts ?? DEFAULT_SAFE_GOTO_OPTIONS.attempts, 1),
  } as const;

  let lastError: unknown;

  for (let attempt = 0; attempt < resolvedOptions.attempts; attempt++) {
    const waitUntil = isFirstAttempt(attempt)
      ? resolvedOptions.initialWaitUntil
      : resolvedOptions.finalWaitUntil;
    const timeout = isFirstAttempt(attempt)
      ? resolvedOptions.initialTimeoutMs
      : resolvedOptions.finalTimeoutMs;

    if (!isFirstAttempt(attempt) && resolvedOptions.waitBetweenAttemptsMs > 0) {
      await page.waitForTimeout(resolvedOptions.waitBetweenAttemptsMs);
    }

    try {
      await page.goto(url, {
        waitUntil,
        timeout,
      });
      lastError = undefined;

      // Avoid performing more attempts once one has succeeded.
      if (waitUntil === resolvedOptions.finalWaitUntil || attempt === resolvedOptions.attempts - 1) {
        return;
      }
    } catch (error) {
      lastError = error;
      if (attempt === resolvedOptions.attempts - 1) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown navigation error');
}
