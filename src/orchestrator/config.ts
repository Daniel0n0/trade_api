import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import type { ModuleArgs, DataSink, LoginMode, CredentialSource, UrlMode } from './messages.js';

const BooleanLikeSchema = z
  .preprocess((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
      return value;
    }
    return value;
  }, z.boolean())
  .optional();

const DataSinkValues: readonly DataSink[] = ['stdout', 'filesystem', 'noop'];
const LoginModeValues: readonly LoginMode[] = ['auto', 'manual', 'skip'];
const CredentialSourceValues: readonly CredentialSource[] = ['env', 'prompt', 'keychain'];
const UrlModeValues: readonly UrlMode[] = ['auto', 'module', 'symbol'];

const StringArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === 'string') {
    const parts = value
      .split(/[\s,;]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return parts;
  }
  return value;
}, z.array(z.string()).optional());

const NumberLikeSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().optional());

const JobSchema = z
  .object({
    label: z.string().optional(),
    module: z.string().min(1).optional(),
    moduleName: z.string().min(1).optional(),
    action: z.string().min(1).default('now'),
    symbols: StringArraySchema,
    headless: BooleanLikeSchema,
    start: z.string().optional(),
    end: z.string().optional(),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    closeOnFinish: BooleanLikeSchema,
    outPrefix: z.string().optional(),
    dataSink: z.enum(DataSinkValues as [DataSink, ...DataSink[]]).optional(),
    parentId: z.string().optional(),
    loginMode: z.enum(LoginModeValues as [LoginMode, ...LoginMode[]]).optional(),
    credSource: z.enum(CredentialSourceValues as [CredentialSource, ...CredentialSource[]]).optional(),
    optionsDate: z.string().optional(),
    optionsHorizon: NumberLikeSchema,
    urlMode: z.enum(UrlModeValues as [UrlMode, ...UrlMode[]]).optional(),
    persistCookies: BooleanLikeSchema,
    persistIndexedDb: BooleanLikeSchema,
    storageStatePath: z.string().optional(),
    indexedDbSeed: z.string().optional(),
    indexedDbProfile: z.string().optional(),
  })
  .refine((value) => value.module !== undefined || value.moduleName !== undefined, {
    message: 'Each job must include "module".',
    path: ['module'],
  });

const ConfigSchema = z.union([
  z.object({ jobs: z.array(JobSchema).default([]) }),
  z.array(JobSchema),
]);

type JobConfig = z.infer<typeof JobSchema>;

type ConfigInput = z.infer<typeof ConfigSchema>;

export type RunConfigJob = {
  readonly label?: string;
  readonly args: ModuleArgs;
};

export type RunConfig = {
  readonly jobs: readonly RunConfigJob[];
};

function toModuleArgsFromJob(job: JobConfig): ModuleArgs {
  const moduleId = job.module ?? job.moduleName;
  if (!moduleId) {
    throw new Error('Job is missing a module name.');
  }

  return {
    module: moduleId,
    action: job.action,
    symbols: job.symbols ?? undefined,
    headless: job.headless ?? undefined,
    start: job.start ?? job.startAt ?? undefined,
    end: job.end ?? job.endAt ?? undefined,
    closeOnFinish: job.closeOnFinish ?? undefined,
    outPrefix: job.outPrefix ?? undefined,
    dataSink: job.dataSink ?? undefined,
    parentId: job.parentId ?? undefined,
    loginMode: job.loginMode ?? undefined,
    credSource: job.credSource ?? undefined,
    optionsDate: job.optionsDate ?? undefined,
    optionsHorizon: job.optionsHorizon ?? undefined,
    urlMode: job.urlMode ?? undefined,
    persistCookies: job.persistCookies,
    persistIndexedDb: job.persistIndexedDb,
    storageStatePath: job.storageStatePath ?? undefined,
    indexedDbSeed: job.indexedDbSeed ?? undefined,
    indexedDbProfile: job.indexedDbProfile ?? undefined,
  } satisfies ModuleArgs;
}

function normalizeConfig(input: ConfigInput): readonly JobConfig[] {
  if (Array.isArray(input)) {
    return input;
  }

  return input.jobs;
}

function formatError(error: z.ZodError, sourcePath: string): Error {
  const details = error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
  return new Error(`Invalid orchestrator config at ${sourcePath}: ${details}`);
}

export async function loadRunConfig(filePath: string): Promise<RunConfig> {
  const resolvedPath = path.resolve(filePath);
  const content = await fs.readFile(resolvedPath, 'utf8');

  const raw = content.trim().length === 0 ? {} : parse(content);

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw formatError(parsed.error, resolvedPath);
  }

  const jobs: RunConfigJob[] = [];
  for (const job of normalizeConfig(parsed.data)) {
    const args = toModuleArgsFromJob(job);
    jobs.push({ label: job.label, args });
  }

  return { jobs } satisfies RunConfig;
}
