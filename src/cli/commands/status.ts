import type { Command } from 'commander';

import type { ProcessSnapshot } from '../../orchestrator/processManager.js';
import type { CommandContext } from './shared.js';

function printStatus(json: boolean, snapshots: readonly ProcessSnapshot[]): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          processes: snapshots,
          count: snapshots.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (snapshots.length === 0) {
    console.log('No hay runners gestionados actualmente.');
    return;
  }

  console.log(`Procesos activos (${snapshots.length}):`);
  for (const snapshot of snapshots) {
    const parts = [
      `ctx=${snapshot.ctxId}`,
      `module=${snapshot.module}`,
      `action=${snapshot.action}`,
      `status=${snapshot.status}`,
      `desired=${snapshot.desiredState}`,
    ];
    if (snapshot.pid) {
      parts.push(`pid=${snapshot.pid}`);
    }
    console.log(`- ${parts.join(' ')}`);
  }
}

export function registerStatusCommand(program: Command, context: CommandContext): Command {
  return program
    .command('status')
    .description('Muestra el estado de los procesos administrados.')
    .action((options: Record<string, never>, command: Command) => {
      const globals = context.resolveGlobals(command);
      const snapshots = context.manager.list();
      printStatus(globals.json, snapshots);
    });
}
