import process from 'node:process';

import { Command } from 'commander';

import { CommandContext } from './shared.js';

type StopOptions = { ctx?: string };

type StopArgs = [ctxId?: string, options?: StopOptions, command?: Command];

function extractCtxId(ctxId: string | undefined, options: StopOptions): string | undefined {
  return ctxId ?? options.ctx;
}

function printStopResult(json: boolean, payload: Record<string, unknown>): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const { ctxId, dryRun, stopped } = payload as { ctxId?: string; dryRun?: boolean; stopped?: boolean };
  if (dryRun) {
    console.log(`[dry-run] trade-api stop ctx=${ctxId ?? '<desconocido>'}`);
    return;
  }

  if (stopped) {
    console.log(`Se solicitó la detención de ctx=${ctxId ?? '<desconocido>'}.`);
  } else {
    console.error(`No existe un runner con ctx=${ctxId ?? '<desconocido>'}.`);
  }
}

export function registerStopCommand(program: Command, context: CommandContext): Command {
  return program
    .command('stop')
    .description('Detiene un runner administrado por el orquestador.')
    .argument('<ctxId>', 'Identificador de contexto que se desea detener.')
    .option('--ctx <id>', 'Identificador de contexto (alternativa a la posición).')
    .action((...args: StopArgs) => {
      const [ctxIdArg, options = {}, command] = args;
      const globals = command ? context.resolveGlobals(command) : { json: false, dryRun: false };
      const ctxId = extractCtxId(ctxIdArg, options);
      if (!ctxId) {
        throw new Error('Debes indicar el ctxId del runner a detener.');
      }

      if (globals.dryRun) {
        printStopResult(globals.json, { ctxId, dryRun: true });
        return;
      }

      const stopped = context.manager.stop(ctxId);
      printStopResult(globals.json, { ctxId, stopped });
      if (!stopped) {
        process.exitCode = 1;
      }
    });
}
