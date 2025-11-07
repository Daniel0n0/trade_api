import process from 'node:process';

import { runSubBrowser } from './subbrowser-runner.js';
import type { SubBrowserArgs } from './types.js';

function parseArgs(argv: readonly string[]): SubBrowserArgs {
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

  const args = parsed as Partial<SubBrowserArgs>;
  if (!args || typeof args.moduleName !== 'string' || typeof args.action !== 'string') {
    throw new Error('Serialized arguments must include "moduleName" and "action".');
  }

  return {
    moduleName: args.moduleName,
    action: args.action,
    startAt: args.startAt,
    endAt: args.endAt,
    persistCookies: args.persistCookies,
    persistIndexedDb: args.persistIndexedDb,
    storageStatePath: args.storageStatePath,
    indexedDbSeed: args.indexedDbSeed,
    indexedDbProfile: args.indexedDbProfile,
  } satisfies SubBrowserArgs;
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
