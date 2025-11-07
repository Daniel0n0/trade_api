import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { FLAGS } from './bootstrap/env.js';
import { createProcessLogger } from './bootstrap/logger.js';
import { bindProcessSignals, registerCloser } from './bootstrap/signals.js';
import { bindContextDebugObservers, attachPageDebugObservers } from './debugging.js';
import { ensureLoggedInByUrlFlow } from './sessionFlow.js';
import { MODULES } from './config.js';
import { MODULE_RUNNERS } from './modulos/index.js';

const { waitForShutdown } = bindProcessSignals();
const processLogger = createProcessLogger({ name: 'orchestrator' });
registerCloser(() => processLogger.close());

const heartbeat = setInterval(() => {
  processLogger.info('heartbeat', { pid: process.pid, command: 'orchestrator' });
}, 30_000);
heartbeat.unref?.();
registerCloser(() => clearInterval(heartbeat));

processLogger.info('boot', { command: 'orchestrator' });

type OrchestratorCommand = {
  readonly moduleName: string;
  readonly action: string;
};

function parseCommand(argv: readonly string[]): OrchestratorCommand | null {
  const rawCommand = argv[2];
  if (!rawCommand) {
    return null;
  }

  const [kind, moduleName, action] = rawCommand.split(':');
  if (kind !== 'sub' || !moduleName) {
    return null;
  }

  return { moduleName, action: action ?? 'now' };
}

async function launchBrowser(): Promise<BrowserContext> {
  processLogger.info('launch', {
    headless: FLAGS.headless,
    devtools: FLAGS.devtools,
    debugNetwork: FLAGS.debugNetwork,
    debugConsole: FLAGS.debugConsole,
  });

  const browser: Browser = await chromium.launch({
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

  return context;
}

async function ensureSession(context: BrowserContext): Promise<Page | null> {
  const page = await context.newPage();
  if (FLAGS.debugNetwork || FLAGS.debugConsole) {
    attachPageDebugObservers(page);
  }

  const loggedIn = await ensureLoggedInByUrlFlow(page);
  if (!loggedIn) {
    /* eslint-disable no-console */
    console.error('No se pudo validar la sesión de Robinhood.');
    /* eslint-enable no-console */
    processLogger.warn('session-missing');
    return null;
  }

  processLogger.info('session-detected');
  return page;
}

async function runModule(moduleName: string, page: Page): Promise<string | void> {
  const moduleDefinition = MODULES.find((module) => module.name === moduleName);
  if (!moduleDefinition) {
    /* eslint-disable no-console */
    console.error(`No existe un módulo configurado con el nombre "${moduleName}".`);
    /* eslint-enable no-console */
    processLogger.error('module-missing', { moduleName });
    return undefined;
  }

  processLogger.info('module-start', { module: moduleName, url: moduleDefinition.url });

  await page.goto(moduleDefinition.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => page.waitForTimeout(2_000));

  const runner = MODULE_RUNNERS[moduleDefinition.name];
  if (!runner) {
    /* eslint-disable no-console */
    console.warn(`No hay runner asignado para el módulo "${moduleName}". Se dejará abierto para inspección.`);
    /* eslint-enable no-console */
    processLogger.warn('module-runner-missing', { module: moduleName });
    return undefined;
  }

  try {
    const result = await runner(page);
    processLogger.info('module-runner-ready', { module: moduleName, result });
    if (typeof result === 'string') {
      /* eslint-disable no-console */
      console.log(`Capturando datos del módulo "${moduleName}". Archivos en: ${result}`);
      /* eslint-enable no-console */
    }
    return result;
  } catch (error) {
    processLogger.error('module-runner-error', {
      module: moduleName,
      message: error instanceof Error ? error.message : String(error),
    });
    /* eslint-disable no-console */
    console.error(`Error al inicializar el módulo "${moduleName}":`, error);
    /* eslint-enable no-console */
    return undefined;
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv);
  if (!command) {
    /* eslint-disable no-console */
    console.error('Uso: npm run orchestrator -- sub:<modulo>:<accion>');
    console.error('Ejemplo: npm run orchestrator -- sub:spy-5m-1m:now');
    /* eslint-enable no-console */
    processLogger.warn('invalid-command', { argv: process.argv.slice(2) });
    process.exitCode = 1;
    return;
  }

  processLogger.info('command', command);
  /* eslint-disable no-console */
  console.log(`Ejecutando comando: sub:${command.moduleName}:${command.action}`);
  /* eslint-enable no-console */

  const context = await launchBrowser();
  const page = await ensureSession(context);
  if (!page) {
    process.exitCode = 1;
    return;
  }

  await runModule(command.moduleName, page);

  /* eslint-disable no-console */
  console.log('Orquestador en ejecución. Presiona Ctrl+C (SIGINT) o envía SIGTERM para finalizar.');
  /* eslint-enable no-console */

  await waitForShutdown();
}

await main().catch((error: unknown) => {
  processLogger.error('fatal', { message: error instanceof Error ? error.message : String(error) });
  /* eslint-disable no-console */
  console.error('Error no controlado en el orquestador:', error);
  /* eslint-enable no-console */
  process.exitCode = 1;
});
