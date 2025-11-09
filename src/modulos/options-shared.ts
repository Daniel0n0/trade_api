import { registerCloser } from '../bootstrap/signals.js';
import type { ModuleRunner } from '../orchestrator/types.js';
import { runSocketSniffer, type SocketSnifferHandle } from './socket-sniffer.js';
import {
  installOptionsResponseRecorder,
  type OptionsRecorderHandle,
} from '../modules/options/interceptor.js';

export type OptionsModuleResult = {
  readonly logPattern: string;
  readonly optionsPrimaryExpiration?: string;
};

const toSymbols = (fallback: readonly string[] | undefined, provided?: readonly string[]): readonly string[] => {
  if (provided && provided.length > 0) {
    return provided;
  }
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return [];
};

const safeRegisterRecorderCloser = (handle: OptionsRecorderHandle): void => {
  registerCloser(() => handle.close().catch((error) => {
    /* eslint-disable no-console */
    console.warn('[options-module] Error al cerrar el interceptor de opciones:', error);
    /* eslint-enable no-console */
  }));
};

const registerSnifferCloser = (handle: SocketSnifferHandle): void => {
  registerCloser(() => {
    try {
      handle.close();
    } catch (error) {
      /* eslint-disable no-console */
      console.warn('[options-module] Error al cerrar el sniffer de sockets:', error);
      /* eslint-enable no-console */
    }
  });
};

export const createOptionsModuleRunner = (
  defaults: readonly string[] | undefined,
): ModuleRunner => {
  return async (args, { page }) => {
    const symbols = toSymbols(defaults, args.symbols);
    const logPrefix = args.outPrefix ?? args.module;

    const optionsRecorder = installOptionsResponseRecorder({
      page,
      logPrefix,
      symbols,
      optionsDate: args.optionsDate,
      horizonDays: args.optionsHorizon,
      urlMode: args.urlMode,
    });

    safeRegisterRecorderCloser(optionsRecorder);

    const sniffer = await runSocketSniffer(page, {
      symbols,
      logPrefix,
      start: args.start,
      end: args.end,
    });

    registerSnifferCloser(sniffer);

    return {
      logPattern: sniffer.logPattern,
      optionsPrimaryExpiration: optionsRecorder.getPrimaryExpiration(),
    } satisfies OptionsModuleResult;
  };
};
