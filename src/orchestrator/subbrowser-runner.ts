import process from 'node:process';

import type { ModuleArgs } from './messages.js';
import { runSpotRunner } from '../modules/spot/runner.js';
import { runOptionsRunner } from '../modules/options/runner.js';
import { runFuturesRunner } from '../modules/futures/runner.js';

const RUNNERS: Record<string, (args: ModuleArgs) => Promise<void>> = {
  spot: runSpotRunner,
  'spy-5m-1m': runSpotRunner,
  options: runOptionsRunner,
  'spy-options-chain': runOptionsRunner,
  'spx-options-chain': runOptionsRunner,
  futures: runFuturesRunner,
};

export async function runSubBrowser(args: ModuleArgs): Promise<void> {
  const runner = RUNNERS[args.module];
  if (!runner) {
    /* eslint-disable no-console */
    console.error(`No existe un runner registrado para el módulo "${args.module}".`);
    /* eslint-enable no-console */
    process.exitCode = 1;
    return;
  }

  try {
    await runner(args);
  } catch (error) {
    /* eslint-disable no-console */
    console.error(`Error no controlado en el runner "${args.module}":`, error);
    /* eslint-enable no-console */
    process.exitCode = 1;
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(String(error));
  }
}
