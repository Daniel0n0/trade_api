import process from 'node:process';

import type { Command } from 'commander';

import type { EventEmitter } from 'node:events';

import type { ModuleArgs, ParentToChild } from '../../orchestrator/messages.js';
import type { ChildRef, ProcessSnapshot } from '../../orchestrator/processManager.js';

export type ProcessManagerLike = {
  startRunner(args: ModuleArgs): ChildRef;
  stop(ctxId: string): boolean;
  list(): ProcessSnapshot[];
  broadcast(message: ParentToChild): void;
  on: EventEmitter['on'];
  off: EventEmitter['off'];
  once: EventEmitter['once'];
};

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
