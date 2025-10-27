import type { Page } from 'playwright';

import { PORTFOLIO_PATH, ROBINHOOD_URL, WATCHLIST_PATH, SESSION_MARKERS } from './config.js';

export async function navigateToPortfolio(page: Page): Promise<void> {
  await navigateAndAssert(page, `${ROBINHOOD_URL}${PORTFOLIO_PATH}`, SESSION_MARKERS.dashboard);
}

export async function navigateToWatchlist(page: Page): Promise<void> {
  await navigateAndAssert(page, `${ROBINHOOD_URL}${WATCHLIST_PATH}`, SESSION_MARKERS.watchlist);
}

async function navigateAndAssert(page: Page, url: string, selector: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' });
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
}
