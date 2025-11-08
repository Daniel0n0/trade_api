import path from 'node:path';

import { Command } from 'commander';

import { loadRunConfig } from '../../orchestrator/config.js';
import type { ModuleArgsInput } from '../schema.js';
import { deriveOutPrefix, mapEnvFallbacks, mergeArgChain, normalizeModuleArgs, parseSymbols } from '../normalize.js';
import type { RunConfigJob } from '../../orchestrator/config.js';
import { CommandContext, resolveEnv } from './shared.js';

const DEFAULT_CONFIG = 'orchestrator.yaml';

const ENV_MAPPING: Record<keyof ModuleArgsInput, string | readonly string[]> = {
  moduleName: ['TRADE_API_MODULE', 'ORCHESTRATOR_MODULE'],
  action: ['TRADE_API_ACTION', 'ORCHESTRATOR_ACTION'],
  startAt: ['TRADE_API_START_AT', 'ORCHESTRATOR_START_AT'],
  endAt: ['TRADE_API_END_AT', 'ORCHESTRATOR_END_AT'],
  persistCookies: ['TRADE_API_PERSIST_COOKIES', 'ORCHESTRATOR_PERSIST_COOKIES'],
  persistIndexedDb: ['TRADE_API_PERSIST_INDEXEDDB', 'ORCHESTRATOR_PERSIST_INDEXEDDB'],
  storageStatePath: ['TRADE_API_STORAGE_STATE_PATH', 'ORCHESTRATOR_STORAGE_STATE_PATH'],
  indexedDbSeed: ['TRADE_API_INDEXEDDB_SEED', 'ORCHESTRATOR_INDEXEDDB_SEED'],
  indexedDbProfile: ['TRADE_API_INDEXEDDB_PROFILE', 'ORCHESTRATOR_INDEXEDDB_PROFILE'],
};

type RunConfigOptions = {
  config?: string;
  action?: string;
  startAt?: string;
  endAt?: string;
  persistCookies?: string | boolean;
  persistIndexeddb?: string | boolean;
  storageState?: string;
  indexeddbSeed?: string;
  indexeddbProfile?: string;
  module?: string;
  symbols?: string | string[];
};

type RunConfigArgs = [configPath?: string, options?: RunConfigOptions, command?: Command];

function buildOverrides(options: RunConfigOptions): Partial<ModuleArgsInput> {
  const overrides: Partial<ModuleArgsInput> = {};

  if (options.action !== undefined) {
    overrides.action = options.action;
  }

  if (options.startAt !== undefined) {
    overrides.startAt = options.startAt;
  }

  if (options.endAt !== undefined) {
    overrides.endAt = options.endAt;
  }

  if (options.persistCookies !== undefined) {
    overrides.persistCookies = options.persistCookies as ModuleArgsInput['persistCookies'];
  }

  if (options.persistIndexeddb !== undefined) {
    overrides.persistIndexedDb = options.persistIndexeddb as ModuleArgsInput['persistIndexedDb'];
  }

  if (options.storageState !== undefined) {
    overrides.storageStatePath = options.storageState;
  }

  if (options.indexeddbSeed !== undefined) {
    overrides.indexedDbSeed = options.indexeddbSeed;
  }

  if (options.indexeddbProfile !== undefined) {
    overrides.indexedDbProfile = options.indexeddbProfile;
  }

  return overrides;
}

function filterJobs(jobs: readonly RunConfigJob[], options: RunConfigOptions): RunConfigJob[] {
  const symbols = parseSymbols(options.symbols);
  const moduleFilter = options.module?.trim();
  if (!symbols && !moduleFilter) {
    return [...jobs];
  }

  const allowedModules = symbols?.map((symbol) => symbol.toLowerCase());
  return jobs.filter((job) => {
    const moduleName = job.args.moduleName.toLowerCase();
    if (moduleFilter && moduleName !== moduleFilter.toLowerCase()) {
      return false;
    }
    if (allowedModules && !allowedModules.includes(moduleName)) {
      return false;
    }
    return true;
  });
}

function printDryRun(
  json: boolean,
  configPath: string,
  jobs: readonly RunConfigJob[],
  envArgs: Partial<ModuleArgsInput>,
  overrides: Partial<ModuleArgsInput>,
): void {
  if (json) {
    const preview = jobs.map((job) => ({
      label: job.label,
      args: mergeArgChain(envArgs, job.args, overrides),
    }));
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          configPath,
          jobs: preview,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`[dry-run] trade-api run-config ${configPath}`);
  if (jobs.length === 0) {
    console.log('No se ejecutarían trabajos con los filtros aplicados.');
    return;
  }

  for (const job of jobs) {
    const label = job.label ? ` (${job.label})` : '';
    const merged = mergeArgChain(envArgs, job.args, overrides);
    console.log(`- ${job.args.moduleName}${label} -> acción ${merged.action ?? job.args.action}`);
  }
}

function printLaunchResult(
  json: boolean,
  configPath: string,
  started: readonly { ctxId: string; job: RunConfigJob; prefix: string }[],
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          configPath,
          launched: started.map(({ ctxId, job, prefix }) => ({
            ctxId,
            label: job.label,
            moduleName: job.args.moduleName,
            action: job.args.action,
            prefix,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (started.length === 0) {
    console.log(`No se lanzaron trabajos desde ${configPath}.`);
    return;
  }

  console.log(`Se lanzaron ${started.length} trabajo(s) definidos en ${configPath}:`);
  for (const { ctxId, job, prefix } of started) {
    const label = job.label ? ` (${job.label})` : '';
    console.log(`- ctx=${ctxId} module=${job.args.moduleName}${label} action=${job.args.action} -> ${prefix}`);
  }
}

export function registerRunConfigCommand(program: Command, context: CommandContext): Command {
  return program
    .command('run-config')
    .description('Ejecuta los trabajos definidos en un archivo YAML de orquestador.')
    .argument('[path]', 'Ruta al archivo de configuración (por defecto orchestrator.yaml).')
    .option('-c, --config <path>', 'Ruta al archivo de configuración a utilizar.')
    .option('-a, --action <name>', 'Sobrescribe la acción para todos los trabajos.')
    .option('--start-at <iso>', 'Sobrescribe la fecha de inicio en formato ISO 8601.')
    .option('--end-at <iso>', 'Sobrescribe la fecha de fin en formato ISO 8601.')
    .option('--persist-cookies [value]', 'Sobrescribe el flag de persistencia de cookies (true/false).')
    .option('--persist-indexeddb [value]', 'Sobrescribe el flag de persistencia de IndexedDB (true/false).')
    .option('--storage-state <path>', 'Sobrescribe la ruta del storage state.')
    .option('--indexeddb-seed <value>', 'Sobrescribe la semilla de IndexedDB.')
    .option('--indexeddb-profile <path>', 'Sobrescribe el perfil de IndexedDB.')
    .option('--module <name>', 'Filtra por nombre de módulo antes de lanzar.')
    .option('--symbols <list>', 'Filtra por símbolos (lista separada por comas o espacios).')
    .action(async (...args: RunConfigArgs) => {
      const [pathArg, options = {}, command] = args;
      const globals = command ? context.resolveGlobals(command) : { json: false, dryRun: false };
      const env = resolveEnv(context);

      const configPath = options.config ?? pathArg ?? DEFAULT_CONFIG;
      const resolvedPath = path.resolve(configPath);
      const config = await loadRunConfig(resolvedPath);

      const envArgs = mapEnvFallbacks<Partial<ModuleArgsInput>>({ action: 'now' }, ENV_MAPPING, env);
      const overrides = buildOverrides(options);
      const jobs = filterJobs(config.jobs, options);

      if (globals.dryRun) {
        printDryRun(globals.json, resolvedPath, jobs, envArgs, overrides);
        return;
      }

      const started: { ctxId: string; job: RunConfigJob; prefix: string }[] = [];
      for (const job of jobs) {
        const merged = mergeArgChain(envArgs, job.args, overrides);
        const moduleArgs = normalizeModuleArgs(merged);
        const ref = context.manager.startRunner(moduleArgs);
        const prefix = deriveOutPrefix({ moduleName: moduleArgs.moduleName, action: moduleArgs.action });
        started.push({ ctxId: ref.ctxId, job: { ...job, args: moduleArgs }, prefix });
      }

      printLaunchResult(globals.json, resolvedPath, started);
      if (started.length > 0 && context.waitForIdle) {
        await context.waitForIdle();
      }
    });
}
