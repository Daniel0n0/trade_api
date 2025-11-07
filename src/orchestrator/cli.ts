import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { chromium } from 'playwright';

import { FLAGS } from '../bootstrap/env.js';
import { createProcessLogger } from '../bootstrap/logger.js';
import { bindProcessSignals, registerCloser } from '../bootstrap/signals.js';
import { bindContextDebugObservers, attachPageDebugObservers } from '../debugging.js';
import { ensureLoggedInByUrlFlow } from '../sessionFlow.js';
import { openModuleTabs } from '../modules.js';
import { getModule, listModules } from './modules.js';
import type { OrchestratorModule, SubBrowserArgs } from './types.js';

const SUBBROWSER_ENTRY = fileURLToPath(new URL('./subbrowser.entry.ts', import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);

type ParsedCommand =
  | { kind: 'session' }
  | { kind: 'sub'; args: SubBrowserArgs }
  | { kind: 'help'; message?: string };

type RawParseResult = {
  readonly positionals: readonly string[];
  readonly flags: Record<string, string>;
};

function parseRawArgs(argv: readonly string[]): RawParseResult {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const keyValue = token.slice(2);
    if (keyValue.startsWith('no-')) {
      flags[keyValue.slice(3)] = 'false';
      continue;
    }

    let key: string;
    let value: string;
    const separatorIndex = keyValue.indexOf('=');
    if (separatorIndex >= 0) {
      key = keyValue.slice(0, separatorIndex);
      value = keyValue.slice(separatorIndex + 1);
    } else {
      key = keyValue;
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        value = next;
        index += 1;
      } else {
        value = 'true';
      }
    }

    flags[key] = value;
  }

  return { positionals, flags };
}

function coerceBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function toSubArgs(raw: RawParseResult): ParsedCommand {
  const [first, second, third] = raw.positionals;

  if (!first) {
    return { kind: 'help', message: 'Debes indicar un módulo.' };
  }

  if (first === 'session') {
    return { kind: 'session' };
  }

  if (first === 'list') {
    return { kind: 'help' };
  }

  if (first === 'sub' || first === 'module') {
    const moduleName = raw.flags.module ?? second;
    const action = raw.flags.action ?? third ?? 'now';
    if (!moduleName) {
      return { kind: 'help', message: 'Falta el nombre del módulo (--module o argumento).' };
    }
    return {
      kind: 'sub',
      args: buildSubArgs(moduleName, action, raw.flags),
    };
  }

  if (first.startsWith('sub:')) {
    const [, moduleName, actionRaw] = first.split(':');
    const action = actionRaw && actionRaw.length > 0 ? actionRaw : 'now';
    if (!moduleName) {
      return { kind: 'help', message: 'El comando sub:<modulo>:<accion> es inválido.' };
    }
    return {
      kind: 'sub',
      args: buildSubArgs(moduleName, action, raw.flags),
    };
  }

  return { kind: 'help', message: `Comando desconocido: ${first}` };
}

function buildSubArgs(moduleName: string, action: string, flags: Record<string, string>): SubBrowserArgs {
  const startAt = flags.startAt ?? flags['start-at'];
  const endAt = flags.endAt ?? flags['end-at'];
  const persistCookies = coerceBoolean(flags.persistCookies ?? flags['persist-cookies']);
  const persistIndexedDb = coerceBoolean(flags.persistIndexedDb ?? flags['persist-indexeddb']);

  const args: SubBrowserArgs = {
    moduleName,
    action,
    startAt: startAt || undefined,
    endAt: endAt || undefined,
    persistCookies,
    persistIndexedDb,
    storageStatePath: flags.storageStatePath ?? flags['storage-state'],
    indexedDbSeed: flags.indexedDbSeed ?? flags['indexeddb-seed'],
    indexedDbProfile: flags.indexedDbProfile ?? flags['indexeddb-profile'],
  };

  return args;
}

function renderHelp(message?: string): void {
  /* eslint-disable no-console */
  if (message) {
    console.error(message);
  }
  console.log('Uso general:');
  console.log('  npm run orchestrator -- --module <nombre> --action <accion> [opciones]');
  console.log('  npm run orchestrator -- sub:<nombre>:<accion> [opciones]');
  console.log('');
  console.log('Comandos disponibles:');
  console.log('  session                Inicia la sesión interactiva estándar.');
  console.log('  sub|module             Lanza un subproceso para el módulo indicado.');
  console.log('  list                   Muestra módulos disponibles.');
  console.log('');
  console.log('Opciones:');
  console.log('  --startAt <ISO>        Fecha/hora de inicio para segmentar capturas.');
  console.log('  --endAt <ISO>          Fecha/hora de término para segmentar capturas.');
  console.log('  --persistCookies=<0|1> Fuerza persistencia de cookies en storageState.');
  console.log('  --persistIndexedDb=<0|1>  Controla si se conserva el perfil entre ejecuciones.');
  console.log('  --storageStatePath <ruta> Ubicación del storageState a reutilizar.');
  console.log('  --indexedDbSeed <nombre>  Copia state/indexeddb-seeds/<nombre> al perfil antes de iniciar.');
  console.log('  --indexedDbProfile <ruta> Usa un directorio de perfil específico.');
  console.log('');
  console.log('Módulos registrados:');
  for (const moduleDef of listModules()) {
    console.log(`  - ${moduleDef.name}: ${moduleDef.description}`);
  }
  /* eslint-enable no-console */
}

async function runInteractiveSession(): Promise<void> {
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
    /* eslint-disable no-console */
    console.error('Automation encountered an error.');
    console.error(error);
    console.error('El navegador permanecerá abierto para que puedas revisar el estado manualmente.');
    /* eslint-enable no-console */
    processLogger.error('unhandled-error', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  /* eslint-disable no-console */
  console.log('Depuración activa. Presiona Ctrl+C (SIGINT) o envía SIGTERM cuando quieras finalizar la sesión.');
  /* eslint-enable no-console */

  await waitForShutdown();
}

async function spawnSubbrowser(args: SubBrowserArgs): Promise<void> {
  const moduleDef: OrchestratorModule | undefined = getModule(args.moduleName);
  if (!moduleDef) {
    renderHelp(`No existe un módulo con el nombre "${args.moduleName}".`);
    process.exitCode = 1;
    return;
  }

  /* eslint-disable no-console */
  console.log(
    `Lanzando subproceso para ${moduleDef.name} con acción "${args.action}" (startAt=${
      args.startAt ?? 'n/a'
    }, endAt=${args.endAt ?? 'n/a'}).`,
  );
  /* eslint-enable no-console */

  const payload = JSON.stringify(args);

  const child = spawn(
    process.execPath,
    ['--loader', 'tsx', SUBBROWSER_ENTRY, payload],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );

  await new Promise<void>((resolve) => {
    child.once('exit', (code) => {
      if (typeof code === 'number' && code !== 0) {
        process.exitCode = code;
      }
      resolve();
    });
    child.once('error', (error) => {
      /* eslint-disable no-console */
      console.error('No se pudo lanzar el subproceso de Playwright:', error);
      /* eslint-enable no-console */
      process.exitCode = 1;
      resolve();
    });
  });
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const raw = parseRawArgs(argv);
  if (raw.positionals[0] === 'list') {
    renderHelp();
    return;
  }

  const parsed = toSubArgs(raw);

  switch (parsed.kind) {
    case 'session':
      await runInteractiveSession();
      return;
    case 'sub':
      await spawnSubbrowser(parsed.args);
      return;
    case 'help':
    default:
      renderHelp(parsed.message);
      if (parsed.kind === 'help' && parsed.message) {
        process.exitCode = 1;
      }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE) {
  await runCli();
}
