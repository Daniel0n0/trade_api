import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { Command } from 'commander';

import { registerRunConfigCommand } from '../src/cli/commands/run-config.js';
import { registerSessionCommand } from '../src/cli/commands/session.js';
import { registerStartCommand } from '../src/cli/commands/start.js';
import { registerStatusCommand } from '../src/cli/commands/status.js';
import { registerStopCommand } from '../src/cli/commands/stop.js';
import type { CommandContext, ProcessManagerLike } from '../src/cli/commands/shared.js';
import type { ChildRef, ProcessSnapshot } from '../src/orchestrator/processManager.js';
import type { ModuleArgs, ParentToChild } from '../src/orchestrator/messages.js';

class FakeManager extends EventEmitter {
  public readonly startedArgs: ModuleArgs[] = [];
  public readonly stoppedCtx: string[] = [];
  public readonly broadcastMessages: unknown[] = [];
  public snapshots: ProcessSnapshot[] = [];
  private readonly knownCtx = new Set<string>();
  private counter = 0;

  public startRunner(args: ModuleArgs): ChildRef {
    this.counter += 1;
    const ctxId = `ctx-${this.counter}`;
    this.knownCtx.add(ctxId);
    this.startedArgs.push(args);
    const ref = {
      ctxId,
      module: args.module,
      action: args.action,
      args,
      child: null,
      desiredState: 'running',
      status: 'running',
      restarts: 0,
      lastStartAt: null,
      lastReadyAt: null,
      lastHeartbeatAt: null,
      heartbeatTimer: null,
      restartTimer: null,
      shutdownTimer: null,
    } satisfies ChildRef;
    return ref;
  }

  public stop(ctxId: string): boolean {
    this.stoppedCtx.push(ctxId);
    return this.knownCtx.has(ctxId);
  }

  public list(): ProcessSnapshot[] {
    return this.snapshots;
  }

  public broadcast(message: ParentToChild): void {
    this.broadcastMessages.push(message);
  }
}

function createContext(manager: FakeManager, globals: { json?: boolean; dryRun?: boolean } = {}): CommandContext {
  const resolveGlobals = () => ({ json: Boolean(globals.json), dryRun: Boolean(globals.dryRun) });
  const waitForIdle = async () => {
    /* no-op for tests */
  };
  return {
    manager,
    resolveGlobals: () => resolveGlobals(),
    waitForIdle,
  } satisfies CommandContext;
}

test('start command normalizes argumentos antes de iniciar', async () => {
  const manager = new FakeManager();
  const context = createContext(manager);
  const program = new Command();
  registerStartCommand(program, context);

  const argv = ['node', 'trade-api', 'start', 'quotes', 'stream', '--persist-cookies', 'false'];
  await program.parseAsync(argv);

  assert.strictEqual(manager.startedArgs.length, 1);
  const args = manager.startedArgs[0];
  assert.strictEqual(args.module, 'quotes');
  assert.strictEqual(args.action, 'stream');
  assert.strictEqual(args.persistCookies, false);
});

test('start command respeta el modo dry-run', async () => {
  const manager = new FakeManager();
  const context = createContext(manager, { dryRun: true });
  const program = new Command();
  registerStartCommand(program, context);

  await program.parseAsync(['node', 'trade-api', 'start', 'quotes']);
  assert.strictEqual(manager.startedArgs.length, 0);
});

test('stop command invoca ProcessManager.stop con el ctx indicado', async () => {
  const manager = new FakeManager();
  manager.startRunner({ module: 'quotes', action: 'now' });
  const context = createContext(manager);
  const program = new Command();
  registerStopCommand(program, context);

  await program.parseAsync(['node', 'trade-api', 'stop', 'ctx-1']);
  assert.deepEqual(manager.stoppedCtx, ['ctx-1']);
});

test('status command imprime instantáneas en formato JSON cuando se solicita', async () => {
  const manager = new FakeManager();
  manager.snapshots = [
    {
      ctxId: 'ctx-1',
      module: 'quotes',
      action: 'stream',
      pid: 123,
      status: 'running',
      desiredState: 'running',
      restarts: 0,
      lastStartAt: null,
      lastReadyAt: null,
      lastHeartbeatAt: null,
    },
  ];
  const context = createContext(manager, { json: true });
  const program = new Command();
  registerStatusCommand(program, context);

  let output = '';
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    output += String(message);
  };

  try {
    await program.parseAsync(['node', 'trade-api', 'status']);
  } finally {
    console.log = originalLog;
  }

  assert.match(output, /"count": 1/);
});

test('run-config command aplica filtros y overrides', async () => {
  const manager = new FakeManager();
  const context = createContext(manager);
  const program = new Command();
  registerRunConfigCommand(program, context);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trade-cli-'));
  const configPath = path.join(tmpDir, 'jobs.yaml');
  await fs.writeFile(
    configPath,
    [
      'jobs:',
      '  - label: quotes-now',
      '    module: quotes',
      '    action: now',
      '  - label: trades-stream',
      '    module: trades',
      '    action: stream',
    ].join('\n'),
  );

  const argv = [
    'node',
    'trade-api',
    'run-config',
    configPath,
    '--module',
    'quotes',
    '--action',
    'stream',
    '--start',
    '2024-01-01T00:00:00Z',
  ];

  await program.parseAsync(argv);

  assert.strictEqual(manager.startedArgs.length, 1);
  const [jobArgs] = manager.startedArgs;
  assert.strictEqual(jobArgs.module, 'quotes');
  assert.strictEqual(jobArgs.action, 'stream');
  assert.strictEqual(jobArgs.start, '2024-01-01T00:00:00Z');
});

test('session command respeta el modo dry-run', async () => {
  const manager = new FakeManager();
  const context = createContext(manager, { dryRun: true });
  const program = new Command();
  registerSessionCommand(program, context);

  let output = '';
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    output += `${String(message)}\n`;
  };

  try {
    await program.parseAsync(['node', 'trade-api', 'session']);
  } finally {
    console.log = originalLog;
  }

  assert.match(output, /\[dry-run] trade-api session/);
});
