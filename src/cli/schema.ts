import { z } from 'zod';

import type {
  ModuleArgs,
  DataSink,
  LoginMode,
  CredentialSource,
} from '../orchestrator/messages.js';

const NonEmptyString = z.string().trim().min(1, 'Debe proporcionar un valor.');

export const DATA_SINK_VALUES: readonly DataSink[] = ['stdout', 'filesystem', 'noop'];
export const LOGIN_MODE_VALUES: readonly LoginMode[] = ['auto', 'manual', 'skip'];
export const CREDENTIAL_SOURCE_VALUES: readonly CredentialSource[] = ['env', 'prompt', 'keychain'];

export const CommonArgsSchema = z.object({
  module: NonEmptyString,
  action: NonEmptyString.default('now'),
  start: z.string().trim().min(1).optional(),
  end: z.string().trim().min(1).optional(),
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
  module: NonEmptyString,
  action: NonEmptyString,
  symbols: z.array(NonEmptyString).nonempty().optional(),
  headless: z.boolean().optional(),
  start: z.string().trim().min(1).optional(),
  end: z.string().trim().min(1).optional(),
  closeOnFinish: z.boolean().optional(),
  outPrefix: z.string().trim().min(1).optional(),
  dataSink: z.enum(DATA_SINK_VALUES as [DataSink, ...DataSink[]]).optional(),
  parentId: z.string().trim().min(1).optional(),
  loginMode: z.enum(LOGIN_MODE_VALUES as [LoginMode, ...LoginMode[]]).optional(),
  credSource: z.enum(CREDENTIAL_SOURCE_VALUES as [CredentialSource, ...CredentialSource[]]).optional(),
  optionsDate: z.string().trim().min(1).optional(),
  optionsHorizon: z.number().finite().optional(),
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

export type { ModuleArgs, DataSink, LoginMode, CredentialSource } from '../orchestrator/messages.js';
