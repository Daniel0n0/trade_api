import type { BrowserContext, Page } from 'playwright';

import { FLAGS } from './bootstrap/env.js';

export function attachPageDebugObservers(page: Page): void {
  if (FLAGS.debugNetwork) {
    page.on('requestfailed', (req) => {
      const url = req.url();
      const err = req.failure()?.errorText ?? '';

      const benign =
        err.includes('ERR_ABORTED') ||
        err.includes('ERR_BLOCKED_BY_RESPONSE') ||
        err.includes('ERR_BLOCKED_BY_ORB') ||
        url.includes('usercentrics') ||
        url.includes('googletagmanager') ||
        url.includes('google-analytics') ||
        url.includes('sentry') ||
        url.includes('crumbs.robinhood') ||
        url.includes('nummus.robinhood');

      if (benign) {
        return;
      }

      // eslint-disable-next-line no-console
      console.warn(`Request failed [${err}]: ${url}`);
    });
  }

  if (FLAGS.debugConsole) {
    page.on('console', (message) => {
      /* eslint-disable no-console */
      console.log(`[console:${message.type()}] ${message.text()}`);
      /* eslint-enable no-console */
    });
  }
}

export function bindContextDebugObservers(context: BrowserContext): void {
  if (!FLAGS.debugNetwork && !FLAGS.debugConsole) {
    return;
  }

  for (const page of context.pages()) {
    attachPageDebugObservers(page);
  }

  context.on('page', attachPageDebugObservers);
}
