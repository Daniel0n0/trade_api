#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ProcessManager } from './processManager.js';
import { loadRunConfig } from './config.js';
import type { ModuleArgs } from './messages.js';

const manager = new ProcessManager();
let signalsBound = false;

function printUsage(): void {
  /* eslint-disable no-console */
  console.log('Usage: orchestrator <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  start <module> [action] [options]   Start a runner for the given module.');
  console.log('  stop <ctxId>                        Request a graceful exit for the runner.');
  console.log('  status                              Print the current process list.');
  console.log('  run-config [path]                   Start runners defined in a YAML file.');
  console.log('');
  console.log('Options:');
  console.log('  --module <name>                     Module name (alternative to positional).');
  console.log('  --action <name>                     Module action (default: now).');
  console.log('  --start-at <ISO>                    Optional start timestamp.');
  console.log('  --end-at <ISO>                      Optional end timestamp.');
  console.log('  --persist-cookies <bool>            Persist cookies between runs.');
  console.log('  --persist-indexeddb <bool>          Persist IndexedDB between runs.');
  console.log('  --storage-state <path>              Path to a storage state file.');
  console.log('  --indexeddb-seed <name>             IndexedDB seed to load before running.');
  console.log('  --indexeddb-profile <path>          Path to a profile directory for IndexedDB.');
  console.log('  --config <path>                     Path to a YAML file for run-config.');
  console.log('');
  /* eslint-enable no-console */
}

type RawArgs = {
  readonly positionals: readonly string[];
  readonly flags: Record<string, string>;
};

function parseArgv(argv: readonly string[]): RawArgs {
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

    const separatorIndex = keyValue.indexOf('=');
    if (separatorIndex >= 0) {
      const key = keyValue.slice(0, separatorIndex);
      const value = keyValue.slice(separatorIndex + 1);
      flags[key] = value;
      continue;
    }

    const key = keyValue;
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = 'true';
    }
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

function getFlag(flags: Record<string, string>, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = flags[key];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function parseBooleanFlag(
  flags: Record<string, string>,
  keys: readonly string[],
  displayName: string,
): boolean | undefined {
  const value = getFlag(flags, ...keys);
  if (value === undefined) {
    return undefined;
  }

  const parsed = coerceBoolean(value);
  if (parsed === undefined) {
    throw new Error(`Invalid boolean value for --${displayName}: ${value}`);
  }

  return parsed;
}

function buildModuleArgs(positionals: readonly string[], flags: Record<string, string>): ModuleArgs {
  const [first, second] = positionals;
  const moduleName = getFlag(flags, 'module', 'module-name') ?? first;
  if (!moduleName) {
    throw new Error('Missing module name. Provide it as a positional argument or with --module.');
  }

  let positionalAction: string | undefined;
  if (moduleName === first) {
    positionalAction = second;
  } else {
    positionalAction = first;
  }

  const action = getFlag(flags, 'action', 'module-action') ?? positionalAction ?? 'now';
  if (!action) {
    throw new Error('Missing module action. Provide it as a positional argument or with --action.');
  }

  const startAt = getFlag(flags, 'start-at', 'startAt');
  const endAt = getFlag(flags, 'end-at', 'endAt');
  const persistCookies = parseBooleanFlag(flags, ['persist-cookies', 'persistCookies'], 'persist-cookies');
  const persistIndexedDb = parseBooleanFlag(
    flags,
    ['persist-indexeddb', 'persistIndexedDb'],
    'persist-indexeddb',
  );
  const storageStatePath = getFlag(flags, 'storage-state', 'storageStatePath');
  const indexedDbSeed = getFlag(flags, 'indexeddb-seed', 'indexedDbSeed');
  const indexedDbProfile = getFlag(flags, 'indexeddb-profile', 'indexedDbProfile');

  return {
    moduleName,
    action,
    startAt: startAt || undefined,
    endAt: endAt || undefined,
    persistCookies,
    persistIndexedDb,
    storageStatePath: storageStatePath || undefined,
    indexedDbSeed: indexedDbSeed || undefined,
    indexedDbProfile: indexedDbProfile || undefined,
  } satisfies ModuleArgs;
}

function logManagerEvents(): void {
  /* eslint-disable no-console */
  manager.on('started', ({ ctxId, ref }) => {
    const pid = ref.child?.pid ?? 'n/a';
    console.log(`[orchestrator] started ctx=${ctxId} module=${ref.moduleName} action=${ref.action} pid=${pid}`);
  });
  manager.on('ready', ({ ctxId, ref }) => {
    console.log(`[orchestrator] ready ctx=${ctxId} module=${ref.moduleName} action=${ref.action}`);
  });
  manager.on('message', ({ ctxId, message }) => {
    if (message.type === 'log') {
      console.log(`[runner:${ctxId}] [${message.level}] ${message.message}`);
      return;
    }
    if (message.type === 'error') {
      console.error(`[runner:${ctxId}] error: ${message.error}`);
      if (message.stack) {
        console.error(message.stack);
      }
      return;
    }
    console.log(`[runner:${ctxId}] message:`, message);
  });
  manager.on('stopped', ({ ctxId, ref, exit }) => {
    console.log(
      `[orchestrator] stopped ctx=${ctxId} module=${ref.moduleName} action=${ref.action} exit=${exit.code ?? 'null'}/${exit.signal ?? 'null'}`,
    );
  });
  manager.on('failed', ({ ctxId, ref, exit }) => {
    console.error(
      `[orchestrator] failed ctx=${ctxId} module=${ref.moduleName} action=${ref.action} exit=${exit.code ?? 'null'}/${exit.signal ?? 'null'}`,
    );
  });
  manager.on('error', ({ ctxId, error }) => {
    console.error(`[orchestrator] error ctx=${ctxId}:`, error);
  });
  /* eslint-enable no-console */
}

function bindSignalHandlers(): void {
  if (signalsBound) {
    return;
  }
  signalsBound = true;

  const handleSignal = (signal: NodeJS.Signals) => {
    /* eslint-disable no-console */
    console.log(`Received ${signal}. Requesting graceful exit for all runners.`);
    /* eslint-enable no-console */
    manager.broadcast({ type: 'graceful-exit' });
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

async function waitForActiveRunners(): Promise<void> {
  if (manager.list().length === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleMaybeDone = () => {
      if (manager.list().length === 0) {
        manager.off('stopped', handleMaybeDone);
        manager.off('failed', handleMaybeDone);
        manager.off('exit', handleMaybeDone);
        resolve();
      }
    };

    manager.on('stopped', handleMaybeDone);
    manager.on('failed', handleMaybeDone);
    manager.on('exit', handleMaybeDone);
    handleMaybeDone();
  });
}

async function handleStart(positionals: readonly string[], flags: Record<string, string>): Promise<void> {
  const moduleArgs = buildModuleArgs(positionals, flags);
  const ref = manager.startRunner(moduleArgs);
  /* eslint-disable no-console */
  console.log(`Started ctx=${ref.ctxId} module=${moduleArgs.moduleName} action=${moduleArgs.action}`);
  /* eslint-enable no-console */
  bindSignalHandlers();
  await waitForActiveRunners();
}

async function handleStop(positionals: readonly string[], flags: Record<string, string>): Promise<void> {
  const ctxId = positionals[0] ?? getFlag(flags, 'ctx', 'ctx-id');
  if (!ctxId) {
    throw new Error('Missing ctxId. Provide it as a positional argument or with --ctx.');
  }

  const success = manager.requestGracefulExit(ctxId);
  if (!success) {
    /* eslint-disable no-console */
    console.error(`No runner with ctxId ${ctxId} is currently managed by this process.`);
    /* eslint-enable no-console */
    process.exitCode = 1;
    return;
  }

  /* eslint-disable no-console */
  console.log(`Sent graceful-exit to ctx=${ctxId}`);
  /* eslint-enable no-console */
}

async function handleStatus(): Promise<void> {
  const snapshots = manager.list();
  /* eslint-disable no-console */
  console.log(JSON.stringify(snapshots, null, 2));
  /* eslint-enable no-console */
}

async function handleRunConfig(positionals: readonly string[], flags: Record<string, string>): Promise<void> {
  const configPath = positionals[0] ?? getFlag(flags, 'config') ?? 'orchestrator.yaml';
  const resolvedPath = path.resolve(process.cwd(), configPath);
  const config = await loadRunConfig(resolvedPath);
  if (config.jobs.length === 0) {
    /* eslint-disable no-console */
    console.log(`No jobs found in ${resolvedPath}.`);
    /* eslint-enable no-console */
    return;
  }

  /* eslint-disable no-console */
  console.log(`Launching ${config.jobs.length} job(s) from ${resolvedPath}`);
  /* eslint-enable no-console */

  for (const job of config.jobs) {
    const ref = manager.startRunner(job.args);
    /* eslint-disable no-console */
    const labelSuffix = job.label ? ` label=${job.label}` : '';
    console.log(
      `Started ctx=${ref.ctxId} module=${job.args.moduleName} action=${job.args.action}${labelSuffix}`,
    );
    /* eslint-enable no-console */
  }

  bindSignalHandlers();
  await waitForActiveRunners();
}

export async function runCli(argv: readonly string[]): Promise<void> {
  logManagerEvents();

  const raw = parseArgv(argv);
  const [command, ...restPositionals] = raw.positionals;

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case 'start':
      await handleStart(restPositionals, raw.flags);
      return;
    case 'stop':
      await handleStop(restPositionals, raw.flags);
      return;
    case 'status':
      await handleStatus();
      return;
    case 'run-config':
      await handleRunConfig(restPositionals, raw.flags);
      return;
    case 'session':
      /* eslint-disable no-console */
      console.error('The "session" command has been replaced. Use "start" or "run-config" instead.');
      /* eslint-enable no-console */
      process.exitCode = 1;
      return;
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    default:
      printUsage();
      throw new Error(`Unknown command: ${command}`);
  }
}

const isDirectExecution = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  await runCli(process.argv.slice(2)).catch((error: unknown) => {
    /* eslint-disable no-console */
    console.error(error instanceof Error ? error.message : error);
    /* eslint-enable no-console */
    process.exitCode = 1;
  });
}
