import type { Frame } from 'playwright';

/**
 * Allowed Robinhood origins that should receive socket hook instrumentation.
 * These patterns operate on the frame origin (scheme + host + optional port).
 */
export const ROBINHOOD_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/(?:[^./]+\.)*robinhood\.com(?::\d+)?$/i,
];

const isAllowedOrigin = (origin: string): boolean =>
  ROBINHOOD_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));

const extractOrigin = (url: string): string | null => {
  try {
    const { origin } = new URL(url);
    return origin;
  } catch {
    return null;
  }
};

export function isHookableFrame(frame: Frame): boolean {
  const url = frame.url();
  if (!url) {
    return false;
  }

  const origin = extractOrigin(url);
  if (!origin) {
    return false;
  }

  return isAllowedOrigin(origin);
}
