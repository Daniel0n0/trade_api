import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

import { Command } from 'commander';
import { chromium } from 'playwright';

import { FLAGS } from '../../bootstrap/env.js';
import { createProcessLogger } from '../../bootstrap/logger.js';
import { bindProcessSignals, registerCloser } from '../../bootstrap/signals.js';
import { bindContextDebugObservers, attachPageDebugObservers } from '../../debugging.js';
import { openModuleTabs } from '../../modules.js';
import { ensureLoggedInByUrlFlow } from '../../sessionFlow.js';
import type { CommandContext, GlobalOptions } from './shared.js';

type SessionOutcome = 'ready' | 'missing' | 'error';

async function ensureDirectoryForFile(filePath: string): Promise<void> {
  const directory = dirname(filePath);
  if (!directory || directory === '.' || directory === '') {
    return;
  }

  await mkdir(directory, { recursive: true });
}

async function runInteractiveSession(globals: GlobalOptions): Promise<SessionOutcome> {
  const json = globals.json;

  const { waitForShutdown } = bindProcessSignals();
  const processLogger = createProcessLogger({ name: 'main' });
  registerCloser(() => processLogger.close());

  const heartbeat = setInterval(() => {
    processLogger.info('heartbeat', { pid: process.pid, command: 'main' });
  }, 30_000);
  heartbeat.unref?.();
  registerCloser(() => clearInterval(heartbeat));

  processLogger.info('boot', { command: 'main' });
  processLogger.info('launch', {
    headless: FLAGS.headless,
    devtools: FLAGS.devtools,
    debugNetwork: FLAGS.debugNetwork,
    debugConsole: FLAGS.debugConsole,
  });

  let outcome: SessionOutcome = 'error';

  try {
    const browser = await chromium.launch({
      headless: FLAGS.headless,
      devtools: FLAGS.devtools,
      args: FLAGS.headless ? undefined : ['--start-maximized', '--auto-open-devtools-for-tabs'],
    });

    registerCloser(async () => {
      try {
        await browser.close();
      } catch (error) {
        if (!json) {
          // eslint-disable-next-line no-console
          console.error('Error al cerrar el navegador durante el apagado controlado:', error);
        }
      }
    });

    const context = await browser.newContext({ viewport: null });
    registerCloser(async () => {
      try {
        await context.close();
      } catch (error) {
        if (!json) {
          // eslint-disable-next-line no-console
          console.error('Error al cerrar el contexto del navegador:', error);
        }
      }
    });

    bindContextDebugObservers(context);
    const page = await context.newPage();

    if (FLAGS.debugNetwork || FLAGS.debugConsole) {
      attachPageDebugObservers(page);
    }

    try {
      const loggedIn = await ensureLoggedInByUrlFlow(page);

      if (loggedIn) {
        outcome = 'ready';
        processLogger.info('session-detected');

        const storageStatePath = FLAGS.storageStatePath;
        try {
          await ensureDirectoryForFile(storageStatePath);
          await context.storageState({ path: storageStatePath });
        } catch (error) {
          processLogger.warn('storage-state-failed', {
            message: error instanceof Error ? error.message : String(error),
          });
          if (!json) {
            // eslint-disable-next-line no-console
            console.warn(`No se pudo guardar el estado de sesión en ${storageStatePath}:`, error);
          }
        }

        if (json) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              {
                ok: true,
                event: 'session-detected',
                storageState: storageStatePath,
              },
              null,
              2,
            ),
          );
        } else {
          // eslint-disable-next-line no-console
          console.log(
            'Sesión detectada. El módulo 5m-1m queda abierto sin automatización para inspección manual.',
          );
          // eslint-disable-next-line no-console
          console.log('El navegador permanecerá abierto hasta que detengas el proceso manualmente.');
        }

        await openModuleTabs(context);
      } else {
        outcome = 'missing';
        processLogger.warn('session-missing');

        if (json) {
          // eslint-disable-next-line no-console
          console.error(
            JSON.stringify(
              {
                ok: false,
                event: 'session-missing',
              },
              null,
              2,
            ),
          );
        } else {
          // eslint-disable-next-line no-console
          console.error('No se detectó login después de 3 comprobaciones de 10 segundos.');
        }
      }
    } catch (error) {
      outcome = 'error';
      const message = error instanceof Error ? error.message : String(error);
      processLogger.error('unhandled-error', { message });

      if (json) {
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify(
            {
              ok: false,
              event: 'error',
              error: message,
            },
            null,
            2,
          ),
        );
      } else {
        // eslint-disable-next-line no-console
        console.error('Automation encountered an error.');
        // eslint-disable-next-line no-console
        console.error(error);
        // eslint-disable-next-line no-console
        console.error('El navegador permanecerá abierto para que puedas revisar el estado manualmente.');
      }
    }

    if (json) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            ok: true,
            event: 'waiting-for-shutdown',
          },
          null,
          2,
        ),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log('Depuración activa. Presiona Ctrl+C (SIGINT) o envía SIGTERM cuando quieras finalizar la sesión.');
    }

    await waitForShutdown();
  } catch (error) {
    outcome = 'error';
    const message = error instanceof Error ? error.message : String(error);
    processLogger.error('startup-error', { message });

    if (json) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify(
          {
            ok: false,
            event: 'startup-error',
            error: message,
          },
          null,
          2,
        ),
      );
    } else {
      // eslint-disable-next-line no-console
      console.error('No se pudo iniciar la sesión interactiva:', error);
    }
  }

  return outcome;
}

export function registerSessionCommand(program: Command, context: CommandContext): Command {
  return program
    .command('session')
    .description('Inicia la sesión interactiva estándar.')
    .action(async function action(this: Command) {
      const globals = context.resolveGlobals(this);

      if (globals.dryRun) {
        if (globals.json) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              {
                ok: true,
                dryRun: true,
                command: 'session',
              },
              null,
              2,
            ),
          );
        } else {
          // eslint-disable-next-line no-console
          console.log('[dry-run] trade-api session');
        }
        return;
      }

      const outcome = await runInteractiveSession(globals);

      if (outcome !== 'ready' && !process.exitCode) {
        process.exitCode = 1;
      }
    });
}
