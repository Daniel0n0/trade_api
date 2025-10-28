import type { Locator } from 'playwright';

export interface WaitForAnyOptions {
  readonly timeout?: number;
  readonly state?: Parameters<Locator['waitFor']>[0]['state'];
}

export async function waitForAny(
  locatorA: Locator,
  locatorB: Locator,
  options: WaitForAnyOptions = {},
): Promise<Locator> {
  const { timeout = 45_000, state = 'visible' } = options;

  const watchers = [
    locatorA.waitFor({ timeout, state }).then(() => locatorA).catch(() => null),
    locatorB.waitFor({ timeout, state }).then(() => locatorB).catch(() => null),
  ] as const;

  const winner = await Promise.race(watchers);
  if (winner) {
    return winner;
  }

  const [resolvedA, resolvedB] = await Promise.all(watchers);
  const resolved = resolvedA ?? resolvedB;
  if (resolved) {
    return resolved;
  }

  throw new Error('Neither locator became visible before the timeout elapsed.');
}
