import process from 'node:process';

import type { ModuleArgs } from '../orchestrator/messages.js';
import { isModuleArgs } from '../orchestrator/messages.js';

export type RunnerModule = 'spot' | 'options' | 'futures';

export type RunnerStatus =
  | 'idle'
  | 'launching-browser'
  | 'navigating'
  | 'sniffing'
  | 'flushing'
  | 'stopping'
  | 'stopped'
  | 'error';

export type RunnerInfo = Record<string, unknown>;

export type RunnerStartPayload = {
  readonly url?: string;
  readonly symbols?: readonly string[];
  readonly logPrefix?: string;
  readonly startAt?: string;
  readonly endAt?: string;
};

export type ParentMessage =
  | { readonly type: 'start'; readonly args: ModuleArgs; readonly payload?: RunnerStartPayload }
  | { readonly type: 'flush' }
  | { readonly type: 'graceful-exit' }
  | { readonly type: 'status-request'; readonly requestId?: string };

export type EndReason = 'graceful-exit' | 'error' | 'shutdown';

export type ChildMessage =
  | { readonly type: 'ready'; readonly module: RunnerModule; readonly status: RunnerStatus; readonly info?: RunnerInfo }
  | {
      readonly type: 'status';
      readonly module: RunnerModule;
      readonly status: RunnerStatus;
      readonly info?: RunnerInfo;
      readonly requestId?: string;
    }
  | {
      readonly type: 'ended';
      readonly module: RunnerModule;
      readonly status: RunnerStatus;
      readonly reason: EndReason;
      readonly info?: RunnerInfo;
      readonly error?: string;
      readonly stack?: string;
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRunnerModule(value: unknown): value is RunnerModule {
  return value === 'spot' || value === 'options' || value === 'futures';
}

function isRunnerStatus(value: unknown): value is RunnerStatus {
  return (
    value === 'idle' ||
    value === 'launching-browser' ||
    value === 'navigating' ||
    value === 'sniffing' ||
    value === 'flushing' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'error'
  );
}

function isRunnerStartPayload(value: unknown): value is RunnerStartPayload {
  if (!isPlainObject(value)) {
    return false;
  }

  const { url, symbols, logPrefix, startAt, endAt } = value;

  if (url !== undefined && typeof url !== 'string') {
    return false;
  }

  if (symbols !== undefined && !isStringArray(symbols)) {
    return false;
  }

  if (logPrefix !== undefined && typeof logPrefix !== 'string') {
    return false;
  }

  if (startAt !== undefined && typeof startAt !== 'string') {
    return false;
  }

  if (endAt !== undefined && typeof endAt !== 'string') {
    return false;
  }

  return true;
}

export function isParentMessage(payload: unknown): payload is ParentMessage {
  if (!isPlainObject(payload) || typeof payload.type !== 'string') {
    return false;
  }

  switch (payload.type) {
    case 'start':
      return isModuleArgs(payload.args) && (payload.payload === undefined || isRunnerStartPayload(payload.payload));
    case 'flush':
      return true;
    case 'graceful-exit':
      return true;
    case 'status-request':
      return payload.requestId === undefined || typeof payload.requestId === 'string';
    default:
      return false;
  }
}

export function assertParentMessage(payload: unknown): asserts payload is ParentMessage {
  if (!isParentMessage(payload)) {
    throw new Error('Mensaje no válido recibido desde el proceso padre.');
  }
}

export function isChildMessage(payload: unknown): payload is ChildMessage {
  if (!isPlainObject(payload) || typeof payload.type !== 'string') {
    return false;
  }

  if (!isRunnerModule(payload.module) || !isRunnerStatus(payload.status)) {
    return false;
  }

  if (payload.info !== undefined && !isPlainObject(payload.info)) {
    return false;
  }

  switch (payload.type) {
    case 'ready':
      return true;
    case 'status':
      return payload.requestId === undefined || typeof payload.requestId === 'string';
    case 'ended':
      return (
        (payload.reason === 'graceful-exit' || payload.reason === 'error' || payload.reason === 'shutdown') &&
        (payload.error === undefined || typeof payload.error === 'string') &&
        (payload.stack === undefined || typeof payload.stack === 'string')
      );
    default:
      return false;
  }
}

export function assertChildMessage(payload: unknown): asserts payload is ChildMessage {
  if (!isChildMessage(payload)) {
    throw new Error('Mensaje no válido para enviar al proceso padre.');
  }
}

export function sendToParent(message: ChildMessage): void {
  if (typeof process.send !== 'function') {
    return;
  }

  assertChildMessage(message);
  process.send(message);
}
