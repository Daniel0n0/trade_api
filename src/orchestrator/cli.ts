#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { runCli } from '../cli/index.js';

const isDirectExecution = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  await runCli(process.argv.slice(2));
}

export { runCli } from '../cli/index.js';
