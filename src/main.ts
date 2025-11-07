import type { Page } from 'playwright';
import { chromium } from 'playwright';

import { FLAGS } from './bootstrap/env.js';
import { createProcessLogger } from './bootstrap/logger.js';
import { bindProcessSignals, registerCloser } from './bootstrap/signals.js';

import { ensureLoggedInByUrlFlow } from './sessionFlow.js';
import { openModuleTabs } from './modules.js';

const { waitForShutdown } = bindProcessSignals();
const processLogger = createProcessLogger({ name: 'main' });
registerCloser(() => processLogger.close());

async function run(): Promise<void> {
  const browser = await chromium.launch({
    headless: FLAGS.headless,
    devtools: FLAGS.devtools,
    args: FLAGS.headless ? undefined : ['--start-maximized', '--auto-open-devtools-for-tabs'],
  });
  registerCloser(async () => {
    try {
      await browser.close();
    } catch (error) {
      /* eslint-disable no-console */
      console.error('Error al cerrar el navegador durante el apagado controlado:', error);
      /* eslint-enable no-console */
    }
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  if (FLAGS.debugNetwork || FLAGS.debugConsole) {
    attachPageObservers(page);
    context.on('page', attachPageObservers);
  }

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

}

async function handleError(error: unknown): Promise<void> {
  /* eslint-disable no-console */
  console.error('Automation encountered an error.');
  console.error(error);
  console.error('El navegador permanecerá abierto para que puedas revisar el estado manualmente.');
  /* eslint-enable no-console */
}

function attachPageObservers(page: Page): void {
  if (FLAGS.debugNetwork) {
    page.on('requestfailed', (req) => {
      const url = req.url();
      const err = req.failure()?.errorText ?? '';
      // Ignora abortos y bloqueos esperados
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

      if (benign) return;
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
await run();

/* eslint-disable no-console */
console.log('Depuración activa. Presiona Ctrl+C (SIGINT) o envía SIGTERM cuando quieras finalizar la sesión.');
/* eslint-enable no-console */

await waitForShutdown();
