import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Extended to match the longer navigation waits introduced for slow redirects.
  timeout: 45_000,
  use: {
    trace: 'retain-on-failure',
    headless: false,
  },
});
