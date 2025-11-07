import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

const ROOT_DIR = process.cwd();
const DOTENV_FILES = ['.env', '.env.local'];

for (const filename of DOTENV_FILES) {
  const filepath = path.join(ROOT_DIR, filename);
  if (fs.existsSync(filepath)) {
    loadEnv({ path: filepath, override: true });
  }
}

if (!process.env.TZ || process.env.TZ.trim() === '') {
  process.env.TZ = 'UTC';
}

const RawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TZ: z.string().optional(),
    HEADLESS: z.string().optional(),
    DEVTOOLS: z.string().optional(),
    DEBUG_NETWORK: z.string().optional(),
    DEBUG_CONSOLE: z.string().optional(),
  })
  .passthrough();

const rawEnv = RawEnvSchema.parse(process.env);

const coerceBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

const headless = coerceBoolean(rawEnv.HEADLESS, false);

export const ENV = {
  nodeEnv: rawEnv.NODE_ENV,
  timezone: process.env.TZ,
};

export const FLAGS = {
  headless,
  devtools: coerceBoolean(rawEnv.DEVTOOLS, !headless),
  debugNetwork: coerceBoolean(rawEnv.DEBUG_NETWORK, false),
  debugConsole: coerceBoolean(rawEnv.DEBUG_CONSOLE, false),
};
