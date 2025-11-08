import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

import type { ModuleArgs } from './messages.js';

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

const JobSchema = z
  .object({
    label: z.string().optional(),
    module: z.string().min(1).optional(),
    moduleName: z.string().min(1).optional(),
    action: z.string().min(1).default('now'),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    persistCookies: BooleanLikeSchema,
    persistIndexedDb: BooleanLikeSchema,
    storageStatePath: z.string().optional(),
    indexedDbSeed: z.string().optional(),
    indexedDbProfile: z.string().optional(),
  })
  .refine((value) => value.module !== undefined || value.moduleName !== undefined, {
    message: 'Each job must include "module" or "moduleName".',
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
  const moduleName = job.module ?? job.moduleName;
  if (!moduleName) {
    throw new Error('Job is missing a module name.');
  }

  return {
    moduleName,
    action: job.action,
    startAt: job.startAt ?? undefined,
    endAt: job.endAt ?? undefined,
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
