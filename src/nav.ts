import type { Page } from 'playwright';

import { PORTFOLIO_PATH, ROBINHOOD_URL, SESSION_MARKERS, WATCHLIST_PATH } from './config.js';
import { waitForAny } from './waitForAny.js';

export async function navigateToPortfolio(page: Page): Promise<void> {
  await page.goto(`${ROBINHOOD_URL}${PORTFOLIO_PATH}`, { waitUntil: 'domcontentloaded' });
  await waitForAny(
    page.getByRole('heading', SESSION_MARKERS.portfolioHeadingRole).first(),
    page.getByText(SESSION_MARKERS.accountValueText, { exact: false }).first(),
  );
}

export async function navigateToWatchlist(page: Page): Promise<void> {
  await page.goto(`${ROBINHOOD_URL}${WATCHLIST_PATH}`, { waitUntil: 'domcontentloaded' });
  await waitForAny(
    page.getByRole('heading', SESSION_MARKERS.watchlistHeadingRole).first(),
    page.getByText(SESSION_MARKERS.watchlistText, { exact: false }).first(),
  );
}
