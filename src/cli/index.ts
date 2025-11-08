#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import 'dotenv/config';
import { Command } from 'commander';

import { attachHelp } from './help.js';
import { registerSessionCommand } from './commands/session.js';
import { registerStartCommand } from './commands/start.js';
import { registerStopCommand } from './commands/stop.js';
import { registerStatusCommand } from './commands/status.js';
import { registerRunConfigCommand } from './commands/run-config.js';
import { ProcessManager } from '../orchestrator/processManager.js';
import type { CommandContext, GlobalOptions, ProcessManagerLike } from './commands/shared.js';

const OUTPUT_STATE: GlobalOptions = { json: false, dryRun: false };

let signalsBound = false;
let loggingBound = false;

function waitForIdle(manager: ProcessManagerLike): Promise<void> {
  if (manager.list().length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const check = () => {
      if (manager.list().length === 0) {
        manager.off('stopped', check);
        manager.off('failed', check);
        manager.off('exit', check);
        resolve();
      }
    };

    manager.on('stopped', check);
    manager.on('failed', check);
    manager.on('exit', check);
    check();
  });
}

function ensureSignalHandlers(manager: ProcessManagerLike): void {
  if (signalsBound) {
    return;
  }
  signalsBound = true;

  const handleSignal = (signal: NodeJS.Signals) => {
    if (!OUTPUT_STATE.json) {
      console.log(`Recibida señal ${signal}. Solicitando cierre gracioso.`);
    }
    manager.broadcast({ type: 'graceful-exit' });
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

function ensureLogging(manager: ProcessManagerLike): void {
  if (loggingBound) {
    return;
  }
  loggingBound = true;

  manager.on('started', ({ ctxId, ref }) => {
    if (OUTPUT_STATE.json) {
      console.log(
        JSON.stringify(
          {
            event: 'started',
            ctxId,
            module: ref.module,
            action: ref.action,
            pid: ref.child?.pid ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `[orchestrator] started ctx=${ctxId} module=${ref.module} action=${ref.action} pid=${ref.child?.pid ?? 'n/a'}`,
    );
  });

  manager.on('ready', ({ ctxId, ref }) => {
    if (OUTPUT_STATE.json) {
      console.log(
        JSON.stringify(
          {
            event: 'ready',
            ctxId,
            module: ref.module,
            action: ref.action,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`[orchestrator] ready ctx=${ctxId} module=${ref.module} action=${ref.action}`);
  });

  manager.on('message', ({ ctxId, message }) => {
    if (OUTPUT_STATE.json) {
      console.log(
        JSON.stringify(
          {
            event: 'message',
            ctxId,
            payload: message,
          },
          null,
          2,
        ),
      );
      return;
    }

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
    if (OUTPUT_STATE.json) {
      console.log(
        JSON.stringify(
          {
            event: 'stopped',
            ctxId,
            module: ref.module,
            action: ref.action,
            exit,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(
      `[orchestrator] stopped ctx=${ctxId} module=${ref.module} action=${ref.action} exit=${exit.code ?? 'null'}/${exit.signal ?? 'null'}`,
    );
  });

  manager.on('failed', ({ ctxId, ref, exit }) => {
    if (OUTPUT_STATE.json) {
      console.error(
        JSON.stringify(
          {
            event: 'failed',
            ctxId,
            module: ref.module,
            action: ref.action,
            exit,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.error(
      `[orchestrator] failed ctx=${ctxId} module=${ref.module} action=${ref.action} exit=${exit.code ?? 'null'}/${exit.signal ?? 'null'}`,
    );
  });

  manager.on('error', ({ ctxId, error }) => {
    if (OUTPUT_STATE.json) {
      console.error(
        JSON.stringify(
          {
            event: 'error',
            ctxId,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      );
      return;
    }
    console.error(`[orchestrator] error ctx=${ctxId}:`, error);
  });

  manager.on('heartbeatTimeout', ({ ctxId, ref }) => {
    if (OUTPUT_STATE.json) {
      console.error(
        JSON.stringify(
          {
            event: 'heartbeat-timeout',
            ctxId,
            module: ref.module,
            action: ref.action,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.error(
      `[orchestrator] heartbeat-timeout ctx=${ctxId} module=${ref.module} action=${ref.action}`,
    );
  });
}

function buildProgram(manager: ProcessManager): Command {
  const program = new Command('trade-api');
  program
    .option('--json', 'Imprime los resultados en formato JSON')
    .option('--dry-run', 'Muestra las acciones sin ejecutarlas');

  program.showHelpAfterError('(usa --help para más detalles)');
  program.allowExcessArguments(false);

  const context: CommandContext = {
    manager,
    resolveGlobals: (command: Command) => {
      const root = command.parent ?? command;
      const opts = root.opts<{ json?: boolean; dryRun?: boolean }>();
      const resolved: GlobalOptions = { json: Boolean(opts.json), dryRun: Boolean(opts.dryRun) };
      OUTPUT_STATE.json = resolved.json;
      OUTPUT_STATE.dryRun = resolved.dryRun;
      return resolved;
    },
    env: process.env,
    waitForIdle: () => waitForIdle(manager),
  };

  registerSessionCommand(program, context);
  registerStartCommand(program, context);
  registerStopCommand(program, context);
  registerStatusCommand(program, context);
  registerRunConfigCommand(program, context);

  attachHelp(program);

  program.hook('preAction', (_thisCommand, actionCommand) => {
    const root = actionCommand.parent ?? program;
    const opts = root.opts<{ json?: boolean; dryRun?: boolean }>();
    OUTPUT_STATE.json = Boolean(opts.json);
    OUTPUT_STATE.dryRun = Boolean(opts.dryRun);
    ensureLogging(manager);
    if (!OUTPUT_STATE.dryRun) {
      ensureSignalHandlers(manager);
    }
  });

  return program;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const manager = new ProcessManager();
  const program = buildProgram(manager);

  try {
    await program.parseAsync(['node', 'trade-api', ...argv]);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'commander.helpDisplayed') {
      return;
    }
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
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
  await runCli();
}
