import path from 'node:path';

import { Command } from 'commander';

import { loadRunConfig } from '../../orchestrator/config.js';
import type { ModuleArgsInput } from '../schema.js';
import {
  deriveOutPrefix,
  mapEnvFallbacks,
  mergeArgChain,
  normalizeModuleArgs,
  parseSymbols,
} from '../normalize.js';
import type { ModuleArgs } from '../../orchestrator/messages.js';
import { CommandContext, resolveEnv } from './shared.js';

const ENV_MAPPING: Partial<Record<keyof ModuleArgsInput, string | readonly string[]>> = {
  module: ['TRADE_API_MODULE', 'ORCHESTRATOR_MODULE'],
  action: ['TRADE_API_ACTION', 'ORCHESTRATOR_ACTION'],
  start: ['TRADE_API_START', 'ORCHESTRATOR_START', 'TRADE_API_START_AT', 'ORCHESTRATOR_START_AT'],
  end: ['TRADE_API_END', 'ORCHESTRATOR_END', 'TRADE_API_END_AT', 'ORCHESTRATOR_END_AT'],
  persistCookies: ['TRADE_API_PERSIST_COOKIES', 'ORCHESTRATOR_PERSIST_COOKIES'],
  persistIndexedDb: ['TRADE_API_PERSIST_INDEXEDDB', 'ORCHESTRATOR_PERSIST_INDEXEDDB'],
  storageStatePath: ['TRADE_API_STORAGE_STATE_PATH', 'ORCHESTRATOR_STORAGE_STATE_PATH'],
  indexedDbSeed: ['TRADE_API_INDEXEDDB_SEED', 'ORCHESTRATOR_INDEXEDDB_SEED'],
  indexedDbProfile: ['TRADE_API_INDEXEDDB_PROFILE', 'ORCHESTRATOR_INDEXEDDB_PROFILE'],
  symbols: ['TRADE_API_SYMBOLS', 'ORCHESTRATOR_SYMBOLS'],
  optionsDate: ['TRADE_API_OPTIONS_DATE', 'ORCHESTRATOR_OPTIONS_DATE'],
  optionsHorizon: ['TRADE_API_OPTIONS_HORIZON', 'ORCHESTRATOR_OPTIONS_HORIZON'],
  urlMode: ['TRADE_API_URL_MODE', 'ORCHESTRATOR_URL_MODE'],
  urlCode: ['TRADE_API_URL_CODE', 'ORCHESTRATOR_URL_CODE'],
};

type StartOptions = {
  module?: string;
  action?: string;
  start?: string;
  end?: string;
  persistCookies?: string | boolean;
  persistIndexeddb?: string | boolean;
  storageState?: string;
  indexeddbSeed?: string;
  indexeddbProfile?: string;
  config?: string;
  symbols?: string | readonly string[];
  optionsHorizon?: string | number;
  optionsDate?: string;
  urlMode?: string;
  urlCode?: string;
};

type StartCliArgs = [module?: string, action?: string, options?: StartOptions, command?: Command];

function buildCliArgs(
  moduleArg: string | undefined,
  actionArg: string | undefined,
  options: StartOptions,
): Partial<ModuleArgsInput> {
  const result: Partial<ModuleArgsInput> = {};
  const moduleName = options.module ?? moduleArg;
  if (moduleName !== undefined) {
    result.module = moduleName;
  }

  const action = options.action ?? actionArg;
  if (action !== undefined) {
    result.action = action;
  }

  if (options.start !== undefined) {
    result.start = options.start;
  }

  if (options.end !== undefined) {
    result.end = options.end;
  }

  if (options.persistCookies !== undefined) {
    result.persistCookies = options.persistCookies as ModuleArgsInput['persistCookies'];
  }

  if (options.persistIndexeddb !== undefined) {
    result.persistIndexedDb = options.persistIndexeddb as ModuleArgsInput['persistIndexedDb'];
  }

  if (options.storageState !== undefined) {
    result.storageStatePath = options.storageState;
  }

  if (options.indexeddbSeed !== undefined) {
    result.indexedDbSeed = options.indexeddbSeed;
  }

  if (options.indexeddbProfile !== undefined) {
    result.indexedDbProfile = options.indexeddbProfile;
  }

  if (options.symbols !== undefined) {
    const parsed = parseSymbols(options.symbols);
    if (parsed) {
      result.symbols = parsed as ModuleArgsInput['symbols'];
    }
  }

  if (options.optionsHorizon !== undefined) {
    result.optionsHorizon = options.optionsHorizon as ModuleArgsInput['optionsHorizon'];
  }

  if (options.optionsDate !== undefined) {
    result.optionsDate = options.optionsDate;
  }

  if (options.urlMode !== undefined) {
    result.urlMode = options.urlMode as ModuleArgsInput['urlMode'];
  }

  if (options.urlCode !== undefined) {
    result.urlCode = options.urlCode;
  }

  return result;
}

async function loadConfigDefaults(configPath: string): Promise<Partial<ModuleArgsInput>> {
  const resolvedPath = path.resolve(configPath);
  const runConfig = await loadRunConfig(resolvedPath);
  if (runConfig.jobs.length === 0) {
    throw new Error(`No se encontraron trabajos en ${resolvedPath}.`);
  }

  if (runConfig.jobs.length > 1) {
    throw new Error('El archivo de configuración contiene múltiples trabajos. Usa "run-config" para ejecutarlos.');
  }

  return runConfig.jobs[0]?.args ?? {};
}

function printStartResult(json: boolean, payload: Record<string, unknown>): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const { module: moduleName, action, ctxId, dryRun, prefix } = payload as {
    module?: string;
    action?: string;
    ctxId?: string;
    dryRun?: boolean;
    prefix?: string;
  };

  if (dryRun) {
    console.log(`[dry-run] trade-api start module=${moduleName ?? '<desconocido>'} action=${action ?? 'now'}`);
    if (prefix) {
      console.log(`           salida sugerida: ${prefix}`);
    }
    return;
  }

  console.log(`Iniciado ctx=${ctxId ?? '<desconocido>'} module=${moduleName ?? '<desconocido>'} action=${action ?? 'now'}`);
  if (prefix) {
    console.log(`Archivos de salida: ${prefix}.*`);
  }
}

export function registerStartCommand(program: Command, context: CommandContext): Command {
  return program
    .command('start')
    .description('Inicia un runner para el módulo indicado.')
    .argument('[module]', 'Nombre del módulo a ejecutar.')
    .argument('[action]', 'Acción del módulo (por defecto: now).')
    .option('-m, --module <name>', 'Nombre del módulo.')
    .option('-a, --action <name>', 'Acción del módulo.')
    .option('--start <iso>', 'Fecha/hora de inicio en formato ISO 8601.')
    .option('--end <iso>', 'Fecha/hora de fin en formato ISO 8601.')
    .option('--persist-cookies [value]', 'Persistir cookies entre ejecuciones (true/false).')
    .option('--persist-indexeddb [value]', 'Persistir IndexedDB entre ejecuciones (true/false).')
    .option('--storage-state <path>', 'Ruta a un archivo de estado de almacenamiento.')
    .option('--indexeddb-seed <value>', 'Semilla de IndexedDB que se cargará antes de iniciar.')
    .option('--indexeddb-profile <path>', 'Directorio de perfil de IndexedDB.')
    .option('--symbols <lista>', 'Lista de símbolos separados por comas o espacios.')
    .option('--options-horizon <días>', 'Máximo de días hasta la expiración objetivo.')
    .option('--options-date <iso>', 'Expiración principal para opciones (YYYY-MM-DD).')
    .option('--url-mode <modo>', 'Modo de resolución de URL (auto|module|symbol).')
    .option('--url-code <code>', 'Código de layout o plantilla de URL para el módulo.')
    .option('-c, --config <path>', 'Archivo YAML con argumentos por defecto para este comando.')
    .action(async (...args: StartCliArgs) => {
      const [moduleArg, actionArg, options = {}, command] = args;
      const globals = command ? context.resolveGlobals(command) : { json: false, dryRun: false };
      const env = resolveEnv(context);

      const envArgs = mapEnvFallbacks<Partial<ModuleArgsInput>>(
        { action: 'now' } as Partial<ModuleArgsInput>,
        ENV_MAPPING,
        env,
      );
      const configArgs = options.config ? await loadConfigDefaults(options.config) : undefined;
      const cliArgs = buildCliArgs(moduleArg, actionArg, options);

      const merged = mergeArgChain(envArgs, configArgs, cliArgs);
      const moduleArgs = normalizeModuleArgs(merged);

      const prefix = deriveOutPrefix({ module: moduleArgs.module, action: moduleArgs.action });

      if (globals.dryRun) {
        printStartResult(globals.json, {
          dryRun: true,
          module: moduleArgs.module,
          action: moduleArgs.action,
          start: moduleArgs.start,
          end: moduleArgs.end,
          prefix,
        });
        return;
      }

      const ref = context.manager.startRunner(moduleArgs);

      printStartResult(globals.json, {
        ctxId: ref.ctxId,
        module: moduleArgs.module,
        action: moduleArgs.action,
        prefix,
      });

      if (context.waitForIdle) {
        await context.waitForIdle();
      }
    });
}
