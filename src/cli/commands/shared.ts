import process from 'node:process';

import type { Command } from 'commander';

import type { ProcessManager } from '../../orchestrator/processManager.js';

export type ProcessManagerLike = Pick<
  ProcessManager,
  'startRunner' | 'stop' | 'list' | 'broadcast' | 'on' | 'off' | 'once'
>;

export type GlobalOptions = { json: boolean; dryRun: boolean };

export type CommandContext = {
  readonly manager: ProcessManagerLike;
  readonly resolveGlobals: (command: Command) => GlobalOptions;
  readonly env?: NodeJS.ProcessEnv;
  readonly waitForIdle?: () => Promise<void>;
};

export function resolveEnv(context: CommandContext): NodeJS.ProcessEnv {
  return context.env ?? process.env;
}
