import process from 'node:process';

import { runCli } from './orchestrator/cli.js';

const forwardedArgs = ['session', ...process.argv.slice(2)];

await runCli(forwardedArgs);
