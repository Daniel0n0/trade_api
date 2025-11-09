import type { Page } from 'playwright';

import { buildLegendLayoutUrl, MODULE_URL_CODES } from './config.js';

const HOME_URL = 'https://robinhood.com/us/en/';
const LOGIN_URL = 'https://robinhood.com/login/';

const LEGEND_CANDIDATES = new Set<string>([
  buildLegendLayoutUrl(MODULE_URL_CODES['spy-5m-1m']),
  'https://robinhood.com/legend/layout',
]);

const isRobinhoodUrl = (url: string): boolean => url.startsWith('https://robinhood.com/');

const isLoginUrl = (url: string): boolean => /\/login\/?$/i.test(url);

const looksLoggedInByUrl = (url: string): boolean => {
  if (LEGEND_CANDIDATES.has(url)) {
    return true;
  }

  if (!isRobinhoodUrl(url)) {
    return false;
  }

  return !isLoginUrl(url);
};

/**
 * Opens the Robinhood home page, waits for an automatic redirect, and if none occurs navigates
 * to the login page and polls for a manual login to complete based on URL changes.
 *
 * @returns `true` if the session appears to be authenticated based on the page URL.
 */
export async function ensureLoggedInByUrlFlow(page: Page): Promise<boolean> {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });

  const initialUrl = page.url();

  await page.waitForTimeout(2_000);
  const redirectedUrl = page.url();

  if (redirectedUrl !== initialUrl && looksLoggedInByUrl(redirectedUrl)) {
    return true;
  }

  if (!isLoginUrl(redirectedUrl)) {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  }

  const ATTEMPTS = 3;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    await page.waitForTimeout(10_000);
    const currentUrl = page.url();

    if (looksLoggedInByUrl(currentUrl)) {
      return true;
    }
  }

  return false;
}

export const sessionFlowTestables = {
  isRobinhoodUrl,
  isLoginUrl,
  looksLoggedInByUrl,
};
