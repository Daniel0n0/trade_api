import process from 'node:process';

export type ModuleAction = string;

export type ModuleArgs = {
  readonly moduleName: string;
  readonly action: ModuleAction;
  readonly startAt?: string;
  readonly endAt?: string;
  readonly persistCookies?: boolean;
  readonly persistIndexedDb?: boolean;
  readonly storageStatePath?: string;
  readonly indexedDbSeed?: string;
  readonly indexedDbProfile?: string;
};

export type Metrics = {
  readonly counters?: Record<string, number>;
  readonly gauges?: Record<string, number>;
  readonly timers?: Record<string, number>;
};

export type ParentToChild =
  | { readonly type: 'start'; readonly args: ModuleArgs }
  | { readonly type: 'shutdown' }
  | { readonly type: 'ping'; readonly id: string };

export type ChildToParent =
  | { readonly type: 'ready'; readonly module: string; readonly action: ModuleAction }
  | { readonly type: 'metrics'; readonly metrics: Metrics }
  | { readonly type: 'log'; readonly level: 'info' | 'warn' | 'error'; readonly message: string; readonly data?: unknown }
  | { readonly type: 'error'; readonly error: string; readonly stack?: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item));
}

export function isMetrics(payload: unknown): payload is Metrics {
  if (!isPlainObject(payload)) {
    return false;
  }

  const { counters, gauges, timers } = payload;

  if (counters !== undefined && !isRecordOfNumbers(counters)) {
    return false;
  }

  if (gauges !== undefined && !isRecordOfNumbers(gauges)) {
    return false;
  }

  if (timers !== undefined && !isRecordOfNumbers(timers)) {
    return false;
  }

  return true;
}

export function isModuleArgs(payload: unknown): payload is ModuleArgs {
  if (!isPlainObject(payload)) {
    return false;
  }

  const {
    moduleName,
    action,
    startAt,
    endAt,
    persistCookies,
    persistIndexedDb,
    storageStatePath,
    indexedDbSeed,
    indexedDbProfile,
  } = payload;

  if (typeof moduleName !== 'string' || moduleName.length === 0) {
    return false;
  }

  if (typeof action !== 'string' || action.length === 0) {
    return false;
  }

  if (startAt !== undefined && typeof startAt !== 'string') {
    return false;
  }

  if (endAt !== undefined && typeof endAt !== 'string') {
    return false;
  }

  if (persistCookies !== undefined && typeof persistCookies !== 'boolean') {
    return false;
  }

  if (persistIndexedDb !== undefined && typeof persistIndexedDb !== 'boolean') {
    return false;
  }

  if (storageStatePath !== undefined && typeof storageStatePath !== 'string') {
    return false;
  }

  if (indexedDbSeed !== undefined && typeof indexedDbSeed !== 'string') {
    return false;
  }

  if (indexedDbProfile !== undefined && typeof indexedDbProfile !== 'string') {
    return false;
  }

  return true;
}

export function isParentMessage(payload: unknown): payload is ParentToChild {
  if (!isPlainObject(payload) || typeof payload.type !== 'string') {
    return false;
  }

  if (payload.type === 'start') {
    return isModuleArgs(payload.args);
  }

  if (payload.type === 'shutdown') {
    return true;
  }

  if (payload.type === 'ping') {
    return typeof payload.id === 'string' && payload.id.length > 0;
  }

  return false;
}

export function isChildMessage(payload: unknown): payload is ChildToParent {
  if (!isPlainObject(payload) || typeof payload.type !== 'string') {
    return false;
  }

  switch (payload.type) {
    case 'ready':
      return (
        typeof payload.module === 'string' &&
        payload.module.length > 0 &&
        typeof payload.action === 'string' &&
        payload.action.length > 0
      );
    case 'metrics':
      return isMetrics(payload.metrics);
    case 'log':
      return (
        (payload.level === 'info' || payload.level === 'warn' || payload.level === 'error') &&
        typeof payload.message === 'string'
      );
    case 'error':
      return (
        typeof payload.error === 'string' &&
        (payload.stack === undefined || typeof payload.stack === 'string')
      );
    default:
      return false;
  }
}

export function assertParentMessage(payload: unknown): asserts payload is ParentToChild {
  if (!isParentMessage(payload)) {
    throw new Error('Mensaje no válido recibido desde el proceso padre.');
  }
}

export function assertChildMessage(payload: unknown): asserts payload is ChildToParent {
  if (!isChildMessage(payload)) {
    throw new Error('Mensaje no válido recibido desde un subproceso.');
  }
}

export function sendToParent(message: ChildToParent): void {
  if (typeof process.send !== 'function') {
    return;
  }

  process.send(message);
}
