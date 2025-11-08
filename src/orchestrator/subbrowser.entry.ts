import process from 'node:process';

import { runSubBrowser } from './subbrowser-runner.js';
import { assertModuleArgs, type ModuleArgs } from './messages.js';

function parseArgs(argv: readonly string[]): ModuleArgs {
  const payload = argv[2];
  if (!payload) {
    throw new Error('Missing serialized arguments for subbrowser entry.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `Could not parse subbrowser arguments. Payload="${payload}". ${(error as Error).message}`,
    );
  }

  assertModuleArgs(parsed);

  const args = parsed satisfies ModuleArgs;

  return args;
}

const argv = process.argv;

async function main(): Promise<void> {
  const args = parseArgs(argv);
  await runSubBrowser(args);
}

await main().catch((error: unknown) => {
  /* eslint-disable no-console */
  console.error('Unhandled error in subbrowser entry:', error);
  /* eslint-enable no-console */
  process.exitCode = 1;
});
