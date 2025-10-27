import { existsSync, rmSync } from 'node:fs';

import { defaultLaunchOptions } from '../src/config.js';

function main(): void {
  const profilePath = defaultLaunchOptions.userDataDir;

  if (!existsSync(profilePath)) {
    console.log(`No profile directory found at ${profilePath}.`);
    return;
  }

  rmSync(profilePath, { recursive: true, force: true });
  console.log(`Removed persistent profile at ${profilePath}.`);
}

main();
