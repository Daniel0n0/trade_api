import type { Page } from 'playwright';

import { ROBINHOOD_URL, SESSION_MARKERS, SessionState, WAIT_FOR_NETWORK_IDLE } from './config.js';

export async function ensureLoggedIn(page: Page): Promise<SessionState> {
  const currentState = await detectSessionState(page);
  if (currentState === SessionState.Authenticated) {
    return currentState;
  }

  await page.goto(ROBINHOOD_URL, { waitUntil: 'domcontentloaded' });

  if ((await detectSessionState(page)) === SessionState.Authenticated) {
    return SessionState.Authenticated;
  }

  await promptForManualLogin(page);
  await page.waitForTimeout(WAIT_FOR_NETWORK_IDLE);
  return detectSessionState(page);
}

export async function detectSessionState(page: Page): Promise<SessionState> {
  const loginButton = page.locator(SESSION_MARKERS.loginButton);
  if (await loginButton.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return SessionState.RequiresLogin;
  }

  const dashboardLocator = page.locator(SESSION_MARKERS.dashboard);
  if (await dashboardLocator.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return SessionState.Authenticated;
  }

  return SessionState.Unknown;
}

async function promptForManualLogin(page: Page): Promise<void> {
  /* eslint-disable no-console */
  console.log('\nManual login required.');
  console.log('1. Complete the credentials and any MFA prompts in the visible browser window.');
  console.log('2. Press Enter here once the dashboard is visible to continue.');
  /* eslint-enable no-console */

  await page.waitForTimeout(1_000);
  await waitForEnterKey();
}

async function waitForEnterKey(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}
