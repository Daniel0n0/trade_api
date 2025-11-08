import { z } from 'zod';

import type { ModuleArgs } from '../orchestrator/messages.js';

const NonEmptyString = z.string().trim().min(1, 'Debe proporcionar un valor.');

export const CommonArgsSchema = z.object({
  moduleName: NonEmptyString,
  action: NonEmptyString.default('now'),
  startAt: z.string().trim().min(1).optional(),
  endAt: z.string().trim().min(1).optional(),
});

export const AuthArgsSchema = z.object({
  username: z.string().trim().min(1).optional(),
  password: z.string().trim().min(1).optional(),
  mfaCode: z.string().trim().min(1).optional(),
  totpSecret: z.string().trim().min(1).optional(),
});

export const RunnerOptionsSchema = z.object({
  persistCookies: z.boolean().optional(),
  persistIndexedDb: z.boolean().optional(),
  storageStatePath: z.string().trim().min(1).optional(),
  indexedDbSeed: z.string().trim().min(1).optional(),
  indexedDbProfile: z.string().trim().min(1).optional(),
});

export const ModuleArgsSchema: z.ZodType<ModuleArgs> = z.object({
  moduleName: NonEmptyString,
  action: NonEmptyString,
  startAt: z.string().trim().min(1).optional(),
  endAt: z.string().trim().min(1).optional(),
  persistCookies: z.boolean().optional(),
  persistIndexedDb: z.boolean().optional(),
  storageStatePath: z.string().trim().min(1).optional(),
  indexedDbSeed: z.string().trim().min(1).optional(),
  indexedDbProfile: z.string().trim().min(1).optional(),
});

export type CommonArgsInput = z.input<typeof CommonArgsSchema>;
export type AuthArgsInput = z.input<typeof AuthArgsSchema>;
export type RunnerOptionsInput = z.input<typeof RunnerOptionsSchema>;
export type ModuleArgsInput = z.input<typeof ModuleArgsSchema>;

export type CommonArgs = z.output<typeof CommonArgsSchema>;
export type AuthArgs = z.output<typeof AuthArgsSchema>;
export type RunnerOptions = z.output<typeof RunnerOptionsSchema>;
export type ModuleArgsOutput = z.output<typeof ModuleArgsSchema>;
