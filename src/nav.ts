import type { Locator, Page } from 'playwright';

import { PORTFOLIO_PATH, SESSION_MARKERS, WATCHLIST_PATH } from './config.js';

const LOADING_INDICATOR_SELECTORS = [
  '[data-testid="loading-indicator"]',
  '[data-testid="loadingIndicator"]',
  '[data-testid="legend-card-loader"]',
  '[role="progressbar"]',
  '[aria-busy="true"]',
] as const;

function loadingWatchers(page: Page, timeout: number): Promise<unknown>[] {
  return LOADING_INDICATOR_SELECTORS.map((selector) =>
    page.locator(selector).waitFor({ state: 'visible', timeout }).catch(() => null),
  );
}

async function openAccountMenu(page: Page, timeout: number): Promise<void> {
  const accountMenu = page.getByRole('link', { name: /Account/i }).first();

  const waitForMenu = accountMenu.waitFor({ state: 'visible', timeout });
  await Promise.race([waitForMenu, ...loadingWatchers(page, timeout)]);
  await waitForMenu;

  await accountMenu.click();
}

async function clickMenuOption(
  page: Page,
  option: Locator,
  timeout: number,
  description: string,
): Promise<void> {
  const waitForOption = option.waitFor({ state: 'visible', timeout });
  await Promise.race([waitForOption, ...loadingWatchers(page, timeout)]);
  await waitForOption;

  if (!(await option.isVisible())) {
    throw new Error(`The ${description} option never became visible.`);
  }

  await option.click();
}

async function validateDestination(
  page: Page,
  expectedPath: string,
  heading: Locator,
  timeout: number,
  description: string,
): Promise<void> {
  const waitForUrl = page.waitForURL((url) => url.pathname.includes(expectedPath), { timeout });
  await Promise.race([waitForUrl, ...loadingWatchers(page, timeout)]);
  await waitForUrl;

  const url = new URL(page.url());
  if (!url.pathname.includes(expectedPath)) {
    throw new Error(`Unexpected URL after navigating to ${description}: ${url.href}`);
  }

  await heading.first().waitFor({ state: 'visible', timeout });

  const headingCount = await heading.count();
  if (headingCount !== 1) {
    throw new Error(`Expected a single ${description} heading, but found ${headingCount}.`);
  }
}

export async function navigateToPortfolio(page: Page): Promise<void> {
  const timeout = 45_000;
  await openAccountMenu(page, timeout);

  const portfolioLink = page.getByRole('link', { name: /Portfolio/i }).first();
  await clickMenuOption(page, portfolioLink, timeout, 'portfolio');

  await validateDestination(
    page,
    PORTFOLIO_PATH,
    page.getByRole('heading', SESSION_MARKERS.portfolioHeadingRole),
    timeout,
    'portfolio',
  );
}

export async function navigateToWatchlist(page: Page): Promise<void> {
  const timeout = 45_000;
  await openAccountMenu(page, timeout);

  const watchlistLink = page.getByRole('link', { name: /Watchlist|Lists/i }).first();
  await clickMenuOption(page, watchlistLink, timeout, 'watchlist');

  await validateDestination(
    page,
    WATCHLIST_PATH,
    page.getByRole('heading', SESSION_MARKERS.watchlistHeadingRole),
    timeout,
    'watchlist',
  );
}
