import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';

import { launchPersistentBrowser, type LaunchMode } from './browser.js';
import { ensureLoggedIn } from './login.js';
import { navigateToPortfolio, navigateToWatchlist } from './nav.js';
import { openModuleTabs } from './modules.js';
import { ROBINHOOD_URL, ROBINHOOD_HOME_URL, SessionState } from './config.js';

async function run(): Promise<void> {
  const storageStatePath = join(process.cwd(), 'state.json');
  const mode: LaunchMode = existsSync(storageStatePath) ? 'reuse' : 'bootstrap';

  const { context, close } = await launchPersistentBrowser({ mode, storageStatePath });
  const page = context.pages()[0] ?? (await context.newPage());

  attachPageObservers(page);
  context.on('page', attachPageObservers);

  try {
    if (mode === 'reuse') {
      await verifyStoredSession(page);
    }

    const sessionState = await ensureLoggedIn(page);
    if (sessionState !== SessionState.Authenticated) {
      throw new Error(`Unable to confirm authenticated session (state: ${sessionState}).`);
    }

    if (mode === 'bootstrap') {
      await context.storageState({ path: storageStatePath });
    }

    await openModuleTabs(context);

    await navigateToPortfolio(page);
    await navigateToWatchlist(page);
    await openModuleTabs(context);

    /* eslint-disable no-console */
    console.log('Navigation complete. The browser will remain open until you close it manually.');
    /* eslint-enable no-console */

    await page.waitForEvent('close');
  } catch (error) {
    await handleError(error);
  } finally {
    await close();
  }
}

async function handleError(error: unknown): Promise<void> {
  /* eslint-disable no-console */
  console.error('Automation encountered an error.');
  console.error(error);
  console.error('The browser context will now close. Review artifacts/trace-*.zip for debugging.');
  /* eslint-enable no-console */
}

function attachPageObservers(page: Page): void {
  page.on('requestfailed', (request) => {
    /* eslint-disable no-console */
    console.warn(`Request failed [${request.failure()?.errorText ?? 'unknown'}]: ${request.url()}`);
    /* eslint-enable no-console */
  });
}

async function verifyStoredSession(page: Page): Promise<void> {
  const dashboardUrl = new URL('/dashboard', ROBINHOOD_URL).toString();
  const homeUrl = new URL('/home', ROBINHOOD_URL).toString();
  const expectedUrls = [dashboardUrl, homeUrl, ROBINHOOD_HOME_URL];

  await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
  let currentUrl = page.url();

  if (!expectedUrls.some((expected) => currentUrl.startsWith(expected))) {
    await page.goto(homeUrl, { waitUntil: 'domcontentloaded' });
    currentUrl = page.url();
  }

  if (!expectedUrls.some((expected) => currentUrl.startsWith(expected))) {
    throw new Error(
      `El estado almacenado redirigió a una URL inesperada (${currentUrl}). Refresca state.json manualmente.`,
    );
  }
}

await run();
