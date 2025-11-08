import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  assertChildMessage,
  type ChildToParent,
  type ParentToChild,
  type ModuleArgs,
  type Metrics,
} from './messages.js';

const DEFAULTS = {
  maxRestarts: 5,
  backoffInitialMs: 1_000,
  backoffMaxMs: 30_000,
  heartbeatIntervalMs: 30_000,
  heartbeatTimeoutMs: 90_000,
  shutdownTimeoutMs: 10_000,
};

type DesiredState = 'running' | 'stopped';

type ChildStatus = 'starting' | 'running' | 'stopping' | 'restarting' | 'stopped' | 'failed';

export type ChildRef = {
  readonly ctxId: string;
  readonly moduleName: string;
  readonly action: string;
  readonly args: ModuleArgs;
  child: ChildProcess | null;
  desiredState: DesiredState;
  status: ChildStatus;
  restarts: number;
  lastStartAt: number | null;
  lastReadyAt: number | null;
  lastHeartbeatAt: number | null;
  lastExit?: { code: number | null; signal: NodeJS.Signals | null };
  metrics?: Metrics;
  heartbeatTimer: NodeJS.Timeout | null;
  restartTimer: NodeJS.Timeout | null;
  shutdownTimer: NodeJS.Timeout | null;
};

export type ProcessSnapshot = {
  readonly ctxId: string;
  readonly moduleName: string;
  readonly action: string;
  readonly pid: number | null;
  readonly status: ChildStatus;
  readonly desiredState: DesiredState;
  readonly restarts: number;
  readonly lastStartAt: number | null;
  readonly lastReadyAt: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly lastExit?: { code: number | null; signal: NodeJS.Signals | null };
  readonly metrics?: Metrics;
};

type ProcessManagerOptions = {
  readonly rootDir?: string;
  readonly bundleRoot?: string;
  readonly maxRestarts?: number;
  readonly backoffInitialMs?: number;
  readonly backoffMaxMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
};

type ExitInfo = { code: number | null; signal: NodeJS.Signals | null };

type RestartContext = {
  readonly reason: string;
  readonly delay: number;
};

type ManagerEvents = {
  started: { ctxId: string; ref: ChildRef };
  ready: { ctxId: string; ref: ChildRef };
  message: { ctxId: string; ref: ChildRef; message: ChildToParent };
  exit: { ctxId: string; ref: ChildRef; exit: ExitInfo };
  restarting: { ctxId: string; ref: ChildRef; restart: RestartContext };
  stopped: { ctxId: string; ref: ChildRef; exit: ExitInfo };
  failed: { ctxId: string; ref: ChildRef; exit: ExitInfo };
  error: { ctxId: string; ref: ChildRef; error: Error };
  heartbeatTimeout: { ctxId: string; ref: ChildRef };
};

function toBundlePath(bundleRoot: string, moduleName: string): string {
  return path.join(bundleRoot, moduleName, 'runner.js');
}

function now(): number {
  return Date.now();
}

export class ProcessManager extends EventEmitter {
  private readonly options: Required<ProcessManagerOptions>;

  private readonly bundleRoot: string;

  private readonly children = new Map<string, ChildRef>();

  constructor(options: ProcessManagerOptions = {}) {
    super();

    const rootDir = options.rootDir ?? process.cwd();
    this.bundleRoot = options.bundleRoot ?? path.join(rootDir, 'dist', 'modules');

    this.options = {
      rootDir,
      bundleRoot: this.bundleRoot,
      maxRestarts: options.maxRestarts ?? DEFAULTS.maxRestarts,
      backoffInitialMs: options.backoffInitialMs ?? DEFAULTS.backoffInitialMs,
      backoffMaxMs: options.backoffMaxMs ?? DEFAULTS.backoffMaxMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? DEFAULTS.heartbeatTimeoutMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULTS.shutdownTimeoutMs,
    };
  }

  public override on<K extends keyof ManagerEvents>(
    eventName: K,
    listener: (payload: ManagerEvents[K]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  public override once<K extends keyof ManagerEvents>(
    eventName: K,
    listener: (payload: ManagerEvents[K]) => void,
  ): this {
    return super.once(eventName, listener);
  }

  public override off<K extends keyof ManagerEvents>(
    eventName: K,
    listener: (payload: ManagerEvents[K]) => void,
  ): this {
    return super.off(eventName, listener);
  }

  public start(args: ModuleArgs): ChildRef {
    const moduleName = args.moduleName;
    const bundlePath = toBundlePath(this.bundleRoot, moduleName);
    if (!existsSync(bundlePath)) {
      throw new Error(`No se encontró el bundle del módulo "${moduleName}" en ${bundlePath}.`);
    }

    const ctxId = randomUUID();

    const ref: ChildRef = {
      ctxId,
      moduleName,
      action: args.action,
      args,
      child: null,
      desiredState: 'running',
      status: 'starting',
      restarts: 0,
      lastStartAt: null,
      lastReadyAt: null,
      lastHeartbeatAt: null,
      heartbeatTimer: null,
      restartTimer: null,
      shutdownTimer: null,
    };

    this.children.set(ctxId, ref);
    this.spawn(ref);

    return ref;
  }

  public startRunner(args: ModuleArgs): ChildRef {
    return this.start(args);
  }

  public send(ctxId: string, message: ParentToChild): boolean {
    const ref = this.children.get(ctxId);
    if (!ref || !ref.child) {
      return false;
    }

    try {
      ref.child.send(message);
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { ctxId: ref.ctxId, ref, error: err });
      return false;
    }
  }

  public requestGracefulExit(ctxId: string): boolean {
    const ref = this.children.get(ctxId);
    if (!ref) {
      return false;
    }

    ref.desiredState = 'stopped';
    if (ref.status === 'running') {
      ref.status = 'stopping';
    }

    return this.send(ctxId, { type: 'graceful-exit' });
  }

  public broadcast(message: ParentToChild): void {
    for (const ref of this.children.values()) {
      if (!ref.child) {
        continue;
      }

      try {
        ref.child.send(message);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('error', { ctxId: ref.ctxId, ref, error: err });
      }
    }
  }

  public list(): ProcessSnapshot[] {
    const snapshots: ProcessSnapshot[] = [];
    for (const ref of this.children.values()) {
      const pid = ref.child?.pid ?? null;
      snapshots.push({
        ctxId: ref.ctxId,
        moduleName: ref.moduleName,
        action: ref.action,
        pid,
        status: ref.status,
        desiredState: ref.desiredState,
        restarts: ref.restarts,
        lastStartAt: ref.lastStartAt,
        lastReadyAt: ref.lastReadyAt,
        lastHeartbeatAt: ref.lastHeartbeatAt,
        lastExit: ref.lastExit,
        metrics: ref.metrics,
      });
    }

    return snapshots;
  }

  public stop(ctxId: string): boolean {
    const ref = this.children.get(ctxId);
    if (!ref) {
      return false;
    }

    ref.desiredState = 'stopped';
    ref.status = ref.child ? 'stopping' : 'stopped';

    if (ref.restartTimer) {
      clearTimeout(ref.restartTimer);
      ref.restartTimer = null;
    }

    if (!ref.child) {
      this.emit('stopped', { ctxId: ref.ctxId, ref, exit: ref.lastExit ?? { code: 0, signal: null } });
      this.children.delete(ctxId);
      return true;
    }

    try {
      ref.child.send({ type: 'shutdown' });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { ctxId: ref.ctxId, ref, error: err });
      ref.child.kill();
    }

    if (ref.shutdownTimer) {
      clearTimeout(ref.shutdownTimer);
    }

    ref.shutdownTimer = setTimeout(() => {
      if (!ref.child) {
        return;
      }
      ref.child.kill('SIGTERM');
    }, this.options.shutdownTimeoutMs);
    ref.shutdownTimer.unref?.();

    return true;
  }

  public restart(ctxId: string, reason = 'manual'): boolean {
    const ref = this.children.get(ctxId);
    if (!ref) {
      return false;
    }

    ref.desiredState = 'running';
    ref.status = 'restarting';

    if (ref.restartTimer) {
      clearTimeout(ref.restartTimer);
      ref.restartTimer = null;
    }

    if (!ref.child) {
      this.scheduleRestart(ref, reason, { code: ref.lastExit?.code ?? null, signal: ref.lastExit?.signal ?? null });
      return true;
    }

    ref.child.kill('SIGTERM');
    return true;
  }

  private spawn(ref: ChildRef): void {
    const bundlePath = toBundlePath(this.bundleRoot, ref.moduleName);
    if (!existsSync(bundlePath)) {
      this.children.delete(ref.ctxId);
      throw new Error(`No se encontró el bundle del módulo "${ref.moduleName}" en ${bundlePath}.`);
    }

    const child = fork(bundlePath, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, ORCHESTRATOR_CTX_ID: ref.ctxId },
    });

    ref.child = child;
    ref.status = 'starting';
    ref.lastStartAt = now();
    ref.lastHeartbeatAt = ref.lastStartAt;

    const messageListener = (payload: unknown) => {
      this.handleMessage(ref, payload);
    };

    child.on('message', messageListener);

    child.once('exit', (code, signal) => {
      child.off('message', messageListener);
      this.onExit(ref, { code, signal });
    });

    child.once('error', (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { ctxId: ref.ctxId, ref, error: err });
    });

    try {
      child.send({ type: 'start', args: ref.args });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { ctxId: ref.ctxId, ref, error: err });
    }

    this.ensureHeartbeat(ref);
    this.emit('started', { ctxId: ref.ctxId, ref });
  }

  private ensureHeartbeat(ref: ChildRef): void {
    if (ref.heartbeatTimer) {
      clearInterval(ref.heartbeatTimer);
    }

    ref.heartbeatTimer = setInterval(() => {
      if (ref.desiredState !== 'running') {
        return;
      }

      if (!ref.child) {
        return;
      }

      const last = ref.lastHeartbeatAt;
      if (last && now() - last > this.options.heartbeatTimeoutMs) {
        this.emit('heartbeatTimeout', { ctxId: ref.ctxId, ref });
        this.restart(ref.ctxId, 'heartbeat-timeout');
        return;
      }

      try {
        ref.child.send({ type: 'ping', id: randomUUID() });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('error', { ctxId: ref.ctxId, ref, error: err });
      }
    }, this.options.heartbeatIntervalMs);
    ref.heartbeatTimer.unref?.();
  }

  private clearHeartbeat(ref: ChildRef): void {
    if (ref.heartbeatTimer) {
      clearInterval(ref.heartbeatTimer);
      ref.heartbeatTimer = null;
    }
  }

  private handleMessage(ref: ChildRef, payload: unknown): void {
    ref.lastHeartbeatAt = now();

    try {
      assertChildMessage(payload);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', { ctxId: ref.ctxId, ref, error: err });
      return;
    }

    switch (payload.type) {
      case 'ready':
        ref.status = 'running';
        ref.lastReadyAt = now();
        this.emit('ready', { ctxId: ref.ctxId, ref });
        break;
      case 'metrics':
        ref.metrics = payload.metrics;
        break;
      case 'error': {
        const err = new Error(payload.error);
        if (payload.stack) {
          err.stack = payload.stack;
        }
        this.emit('error', { ctxId: ref.ctxId, ref, error: err });
        break;
      }
      default:
        break;
    }

    this.emit('message', { ctxId: ref.ctxId, ref, message: payload });
  }

  private onExit(ref: ChildRef, exit: ExitInfo): void {
    this.clearHeartbeat(ref);

    if (ref.shutdownTimer) {
      clearTimeout(ref.shutdownTimer);
      ref.shutdownTimer = null;
    }

    if (ref.restartTimer) {
      clearTimeout(ref.restartTimer);
      ref.restartTimer = null;
    }

    ref.child = null;
    ref.lastExit = exit;

    const shouldRestart =
      ref.desiredState === 'running' && (exit.code === null || exit.code !== 0 || exit.signal !== null);

    this.emit('exit', { ctxId: ref.ctxId, ref, exit });

    if (!shouldRestart) {
      ref.status = ref.desiredState === 'running' ? 'stopped' : 'stopped';
      this.emit('stopped', { ctxId: ref.ctxId, ref, exit });
      this.children.delete(ref.ctxId);
      return;
    }

    this.scheduleRestart(ref, 'exit', exit);
  }

  private scheduleRestart(ref: ChildRef, reason: string, exit: ExitInfo): void {
    if (ref.restarts >= this.options.maxRestarts) {
      ref.status = 'failed';
      this.emit('failed', { ctxId: ref.ctxId, ref, exit });
      this.children.delete(ref.ctxId);
      return;
    }

    const delay = Math.min(
      this.options.backoffInitialMs * 2 ** ref.restarts,
      this.options.backoffMaxMs,
    );

    ref.restarts += 1;
    ref.status = 'restarting';

    if (ref.restartTimer) {
      clearTimeout(ref.restartTimer);
    }

    ref.restartTimer = setTimeout(() => {
      ref.restartTimer = null;
      if (ref.desiredState !== 'running') {
        return;
      }
      this.spawn(ref);
    }, delay);
    ref.restartTimer.unref?.();

    this.emit('restarting', {
      ctxId: ref.ctxId,
      ref,
      restart: { reason, delay },
    });
  }
}
