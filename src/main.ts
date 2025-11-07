import { chromium } from 'playwright';

import { FLAGS } from './bootstrap/env.js';
import { createProcessLogger } from './bootstrap/logger.js';
import { bindProcessSignals, registerCloser } from './bootstrap/signals.js';

import { bindContextDebugObservers, attachPageDebugObservers } from './debugging.js';
import { ensureLoggedInByUrlFlow } from './sessionFlow.js';
import { openModuleTabs } from './modules.js';

const { waitForShutdown } = bindProcessSignals();
const processLogger = createProcessLogger({ name: 'main' });
registerCloser(() => processLogger.close());

const heartbeat = setInterval(() => {
  processLogger.info('heartbeat', { pid: process.pid, command: 'main' });
}, 30_000);
heartbeat.unref?.();
registerCloser(() => clearInterval(heartbeat));

processLogger.info('boot', { command: 'main' });

async function run(): Promise<void> {
  processLogger.info('launch', {
    headless: FLAGS.headless,
    devtools: FLAGS.devtools,
    debugNetwork: FLAGS.debugNetwork,
    debugConsole: FLAGS.debugConsole,
  });

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
  bindContextDebugObservers(context);
  const page = await context.newPage();

  if (FLAGS.debugNetwork || FLAGS.debugConsole) {
    attachPageDebugObservers(page);
  }

  try {
    const loggedIn = await ensureLoggedInByUrlFlow(page);

    if (loggedIn) {
      await openModuleTabs(context);
      processLogger.info('session-detected');
      /* eslint-disable no-console */
      console.log(
        'Sesión detectada. El módulo 5m-1m queda abierto sin automatización para inspección manual.',
      );
      console.log('El navegador permanecerá abierto hasta que detengas el proceso manualmente.');
      /* eslint-enable no-console */
    } else {
      processLogger.warn('session-missing');
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
  processLogger.error('unhandled-error', {
    message: error instanceof Error ? error.message : String(error),
  });
}

await run();

/* eslint-disable no-console */
console.log('Depuración activa. Presiona Ctrl+C (SIGINT) o envía SIGTERM cuando quieras finalizar la sesión.');
/* eslint-enable no-console */

await waitForShutdown();
