import type { Page } from 'playwright';
import { chromium } from 'playwright';

import { ensureLoggedInByUrlFlow } from './sessionFlow.js';
import { openModuleTabs } from './modules.js';

async function run(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  attachPageObservers(page);
  context.on('page', attachPageObservers);

  try {
    const loggedIn = await ensureLoggedInByUrlFlow(page);

    if (loggedIn) {
      await openModuleTabs(context);
      /* eslint-disable no-console */
      console.log('Sesión detectada. Los módulos se ejecutan en nuevas pestañas.');
      /* eslint-enable no-console */
      await page.waitForEvent('close');
    } else {
      /* eslint-disable no-console */
      console.error('No se detectó login después de 3 comprobaciones de 10 segundos.');
      /* eslint-enable no-console */
    }
  } catch (error) {
    await handleError(error);
  } finally {
    await browser.close();
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

await run();
