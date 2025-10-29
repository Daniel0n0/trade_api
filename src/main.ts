import type { BrowserContext, Page } from 'playwright';
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
      const modulePages = await openModuleTabs(context);
      /* eslint-disable no-console */
      console.log('Sesión detectada. Los módulos se ejecutan en nuevas pestañas.');
      /* eslint-enable no-console */
      await waitForModuleLifecycle(modulePages);
    } else {
      /* eslint-disable no-console */
      console.error('No se detectó login después de 3 comprobaciones de 10 segundos.');
      /* eslint-enable no-console */
    }
  } catch (error) {
    await handleError(error);
  } finally {
    await closeAllPages(context);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
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

async function waitForModuleLifecycle(modulePages: readonly Page[]): Promise<void> {
  const closings = modulePages.map(
    (modulePage) =>
      new Promise<void>((resolve) => {
        modulePage.once('close', () => resolve());
      }),
  );

  const { promise: signalPromise, cleanup } = createSignalPromise();

  try {
    if (closings.length === 0) {
      await signalPromise;
      return;
    }

    await Promise.race([Promise.all(closings), signalPromise]);
  } finally {
    cleanup();
  }
}

function createSignalPromise(): { promise: Promise<void>; cleanup: () => void } {
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  };

  const resolveSignal = (signal: NodeJS.Signals): void => {
    /* eslint-disable no-console */
    console.log(`Se recibió la señal ${signal}. Cerrando módulos...`);
    /* eslint-enable no-console */
    cleanup();
    signalResolve();
  };

  let signalResolve: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    signalResolve = resolve;
  });

  const onSigint = (): void => {
    resolveSignal('SIGINT');
  };
  const onSigterm = (): void => {
    resolveSignal('SIGTERM');
  };

  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  return { promise, cleanup };
}

async function closeAllPages(context: BrowserContext): Promise<void> {
  const pages = context.pages();
  await Promise.all(
    pages.map(async (openPage) => {
      if (openPage.isClosed()) {
        return;
      }
      try {
        await openPage.close({ runBeforeUnload: true });
      } catch (error) {
        /* eslint-disable no-console */
        console.warn('No se pudo cerrar una pestaña del módulo limpiamente.', error);
        /* eslint-enable no-console */
      }
    }),
  );
}

await run();
