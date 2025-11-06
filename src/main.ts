import type { Page } from 'playwright';
import { chromium } from 'playwright';

import { ensureLoggedInByUrlFlow } from './sessionFlow.js';
import { openModuleTabs } from './modules.js';

async function run(): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    devtools: true,
    args: ['--start-maximized', '--auto-open-devtools-for-tabs'],
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  attachPageObservers(page);
  context.on('page', attachPageObservers);

  try {
    const loggedIn = await ensureLoggedInByUrlFlow(page);

    if (loggedIn) {
      await openModuleTabs(context);
      /* eslint-disable no-console */
      console.log(
        'Sesión detectada. El módulo 5m-1m queda abierto sin automatización para inspección manual.',
      );
      console.log('El navegador permanecerá abierto hasta que detengas el proceso manualmente.');
      /* eslint-enable no-console */
    } else {
      /* eslint-disable no-console */
      console.error('No se detectó login después de 3 comprobaciones de 10 segundos.');
      /* eslint-enable no-console */
    }
  } catch (error) {
    await handleError(error);
  }

  await waitForDebuggerSession();
}

async function handleError(error: unknown): Promise<void> {
  /* eslint-disable no-console */
  console.error('Automation encountered an error.');
  console.error(error);
  console.error('El navegador permanecerá abierto para que puedas revisar el estado manualmente.');
  /* eslint-enable no-console */
}

function attachPageObservers(page: Page): void {
  page.on('requestfailed', (request) => {
    /* eslint-disable no-console */
    console.warn(`Request failed [${request.failure()?.errorText ?? 'unknown'}]: ${request.url()}`);
    /* eslint-enable no-console */
  });
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
    console.log(`Se recibió la señal ${signal}. Finalizando la sesión de depuración...`);
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

async function waitForDebuggerSession(): Promise<void> {
  const { promise, cleanup } = createSignalPromise();

  try {
    /* eslint-disable no-console */
    console.log(
      'Depuración activa. Presiona Ctrl+C (SIGINT) o envía SIGTERM cuando quieras finalizar la sesión.',
    );
    /* eslint-enable no-console */
    await promise;
  } finally {
    cleanup();
  }
}

await run();
