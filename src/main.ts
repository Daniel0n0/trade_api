import { launchPersistentBrowser } from './browser.js';
import { ensureLoggedIn } from './login.js';
import { navigateToPortfolio, navigateToWatchlist } from './nav.js';
import { openModuleTabs } from './modules.js';
import { SessionState } from './config.js';

async function run(): Promise<void> {
  const { context, close } = await launchPersistentBrowser();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const sessionState = await ensureLoggedIn(page);
    if (sessionState !== SessionState.Authenticated) {
      throw new Error(`Unable to confirm authenticated session (state: ${sessionState}).`);
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

await run();
