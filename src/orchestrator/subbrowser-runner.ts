import { existsSync, mkdirSync } from 'node:fs';
import { cp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';

import { FLAGS } from '../bootstrap/env.js';
import { createProcessLogger } from '../bootstrap/logger.js';
import { bindProcessSignals, registerCloser } from '../bootstrap/signals.js';
import { bindContextDebugObservers, attachPageDebugObservers } from '../debugging.js';
import { ensureLoggedInByUrlFlow } from '../sessionFlow.js';
import { getModule } from './modules.js';
import type { ModuleArgs } from './messages.js';
import type { OrchestratorModule, SubBrowserRuntime } from './types.js';

const { waitForShutdown } = bindProcessSignals();

function resolveStorageStatePath(moduleName: string, override?: string): string {
  if (override) {
    return path.resolve(override);
  }

  return path.join(process.cwd(), 'state', 'storage', `${moduleName}.json`);
}

function resolveProfileDirectory(moduleName: string, override?: string): string {
  if (override) {
    return path.resolve(override);
  }

  return path.join(process.cwd(), 'state', 'profiles', moduleName);
}

async function ensureSeed(profileDir: string, seedName?: string): Promise<void> {
  if (!seedName) {
    return;
  }

  const seedDir = path.join(process.cwd(), 'state', 'indexeddb-seeds', seedName);
  if (!existsSync(seedDir)) {
    return;
  }

  try {
    const entries = await readdir(profileDir).catch(() => []);
    if (entries.length > 0) {
      return;
    }
    await cp(seedDir, profileDir, { recursive: true });
  } catch (error) {
    /* eslint-disable no-console */
    console.warn('[subbrowser] No se pudo copiar la semilla de IndexedDB:', error);
    /* eslint-enable no-console */
  }
}

type ContextBootResult = {
  readonly context: BrowserContext;
  readonly browser: Browser | null;
  readonly persistent: boolean;
  readonly profileDir: string | null;
};

async function launchContext(
  moduleDef: OrchestratorModule,
  args: ModuleArgs,
  loggerName: string,
): Promise<ContextBootResult> {
  const persistIndexedDb = args.persistIndexedDb ?? FLAGS.persistIndexedDb;
  const persistCookies = args.persistCookies ?? FLAGS.persistCookies;
  const wantsPersistentProfile = persistIndexedDb || Boolean(args.indexedDbSeed ?? FLAGS.indexedDbSeed);
  const profileDir = wantsPersistentProfile
    ? resolveProfileDirectory(moduleDef.name, args.indexedDbProfile ?? FLAGS.indexedDbProfile)
    : null;

  const launchArgs = FLAGS.headless ? undefined : ['--start-maximized', '--auto-open-devtools-for-tabs'];

  if (wantsPersistentProfile && profileDir) {
    mkdirSync(profileDir, { recursive: true });
    await ensureSeed(profileDir, args.indexedDbSeed ?? FLAGS.indexedDbSeed);

    const options: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: FLAGS.headless,
      devtools: FLAGS.devtools,
      args: launchArgs,
    };

    const context = await chromium.launchPersistentContext(profileDir, options);
    bindContextDebugObservers(context);

    return { context, browser: null, persistent: true, profileDir };
  }

  const browserLaunchOptions: LaunchOptions = {
    headless: FLAGS.headless,
    devtools: FLAGS.devtools,
    args: launchArgs,
  };

  const browser = await chromium.launch(browserLaunchOptions);

  registerCloser(async () => {
    try {
      await browser.close();
    } catch (error) {
      /* eslint-disable no-console */
      console.error(`[${loggerName}] Error al cerrar el navegador:`, error);
      /* eslint-enable no-console */
    }
  });

  let storageState: string | undefined;
  if (persistCookies) {
    const candidate = resolveStorageStatePath(moduleDef.name, args.storageStatePath ?? FLAGS.storageStatePath);
    if (existsSync(candidate)) {
      storageState = candidate;
    }
  }

  const context = await browser.newContext({ viewport: null, storageState });
  bindContextDebugObservers(context);

  return { context, browser, persistent: false, profileDir: null };
}

async function persistState(
  moduleDef: OrchestratorModule,
  context: BrowserContext,
  args: ModuleArgs,
): Promise<void> {
  const persistCookies = args.persistCookies ?? FLAGS.persistCookies;
  if (!persistCookies) {
    return;
  }

  const destination = resolveStorageStatePath(moduleDef.name, args.storageStatePath ?? FLAGS.storageStatePath);
  const dir = path.dirname(destination);
  mkdirSync(dir, { recursive: true });
  try {
    await context.storageState({ path: destination });
  } catch (error) {
    /* eslint-disable no-console */
    console.warn('[subbrowser] No se pudo persistir storageState:', error);
    /* eslint-enable no-console */
  }
}

export async function runSubBrowser(args: ModuleArgs): Promise<void> {
  const moduleDef = getModule(args.moduleName);
  if (!moduleDef) {
    /* eslint-disable no-console */
    console.error(`No existe un módulo registrado con el nombre "${args.moduleName}".`);
    /* eslint-enable no-console */
    process.exitCode = 1;
    return;
  }

  const loggerName = `subbrowser:${moduleDef.name}`;
  const processLogger = createProcessLogger({ name: loggerName });
  registerCloser(() => processLogger.close());

  const heartbeat = setInterval(() => {
    processLogger.info('heartbeat', { module: moduleDef.name, pid: process.pid });
  }, 30_000);
  heartbeat.unref?.();
  registerCloser(() => clearInterval(heartbeat));

  processLogger.info('boot', { module: moduleDef.name, args });

  const keepProfile = args.persistIndexedDb ?? FLAGS.persistIndexedDb;
  const profileOverride = args.indexedDbProfile ?? FLAGS.indexedDbProfile;
  const usingExternalProfile = Boolean(profileOverride);

  let contextBoot: ContextBootResult | null = null;

  try {
    contextBoot = await launchContext(moduleDef, args, loggerName);
  } catch (error) {
    processLogger.error('launch-error', {
      message: error instanceof Error ? error.message : String(error),
    });
    /* eslint-disable no-console */
    console.error('No se pudo iniciar el navegador:', error);
    /* eslint-enable no-console */
    process.exitCode = 1;
    return;
  }

  const { context, persistent, profileDir } = contextBoot;

  registerCloser(async () => {
    await persistState(moduleDef, context, args);
    try {
      await context.close();
    } catch (error) {
      /* eslint-disable no-console */
      console.error(`[${loggerName}] Error al cerrar el contexto:`, error);
      /* eslint-enable no-console */
    }
  });

  if (persistent && profileDir && !keepProfile && !usingExternalProfile) {
    registerCloser(async () => {
      try {
        await rm(profileDir, { recursive: true, force: true });
      } catch (error) {
        /* eslint-disable no-console */
        console.warn(`[${loggerName}] No se pudo eliminar el perfil temporal:`, error);
        /* eslint-enable no-console */
      }
    });
  }

  const page = await context.newPage();
  if (FLAGS.debugNetwork || FLAGS.debugConsole) {
    attachPageDebugObservers(page);
  }

  const loggedIn = await ensureLoggedInByUrlFlow(page);
  if (!loggedIn) {
    processLogger.warn('session-missing');
    /* eslint-disable no-console */
    console.error('No se detectó una sesión válida de Robinhood.');
    /* eslint-enable no-console */
    process.exitCode = 1;
    return;
  }

  if (moduleDef.url) {
    try {
      await page.goto(moduleDef.url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => page.waitForTimeout(2_000));
    } catch (error) {
      processLogger.error('navigation-error', {
        url: moduleDef.url,
        message: error instanceof Error ? error.message : String(error),
      });
      /* eslint-disable no-console */
      console.error(`Error al navegar a ${moduleDef.url}:`, error);
      /* eslint-enable no-console */
    }
  }

  const runtime: SubBrowserRuntime = { context, page };

  try {
    const result = await moduleDef.runner(args, runtime);
    processLogger.info('module-runner-ready', { module: moduleDef.name, result });
    if (typeof result === 'string') {
      /* eslint-disable no-console */
      console.log(`Runner del módulo "${moduleDef.name}" inicializado. Archivos en: ${result}`);
      /* eslint-enable no-console */
    }
  } catch (error) {
    processLogger.error('module-runner-error', {
      message: error instanceof Error ? error.message : String(error),
    });
    /* eslint-disable no-console */
    console.error(`Error al inicializar el módulo "${moduleDef.name}":`, error);
    /* eslint-enable no-console */
  }

  /* eslint-disable no-console */
  console.log('Subproceso activo. Usa Ctrl+C para cerrar.');
  /* eslint-enable no-console */

  await waitForShutdown();
}
