import {
  MODULES as CONFIGURED_MODULES,
  MODULE_ALIASES,
  canonicalizeModuleName,
  getModuleDefaultArgs,
  resolveModuleUrl,
  type ModuleDefinition,
} from '../config.js';
import { MODULE_RUNNERS } from '../modulos/index.js';
import type { OrchestratorModule } from './types.js';

function toModuleDescriptor(definition: ModuleDefinition): OrchestratorModule | null {
  const runner = MODULE_RUNNERS[definition.name];
  if (!runner) {
    return null;
  }

  const defaults = getModuleDefaultArgs(definition);
  const url = resolveModuleUrl(definition, defaults);

  return {
    name: definition.name,
    description: definition.description,
    url,
    runner,
  };
}

const canonicalModuleMap = new Map<string, OrchestratorModule>();
const lookupModuleMap = new Map<string, OrchestratorModule>();

const registerDescriptor = (descriptor: OrchestratorModule): void => {
  canonicalModuleMap.set(descriptor.name, descriptor);
  lookupModuleMap.set(descriptor.name, descriptor);
};

for (const definition of CONFIGURED_MODULES) {
  const descriptor = toModuleDescriptor(definition);
  if (descriptor) {
    registerDescriptor(descriptor);
  }
}

for (const [alias, canonical] of Object.entries(MODULE_ALIASES)) {
  const descriptor = canonicalModuleMap.get(canonical);
  if (descriptor) {
    lookupModuleMap.set(alias, descriptor);
  }
}

for (const [name, runner] of Object.entries(MODULE_RUNNERS)) {
  const canonicalName = canonicalizeModuleName(name);
  const descriptor = canonicalModuleMap.get(canonicalName);
  if (descriptor) {
    lookupModuleMap.set(name, descriptor);
    continue;
  }

  const fallback: OrchestratorModule = {
    name: canonicalName,
    description: canonicalName,
    url: undefined,
    runner,
  };

  registerDescriptor(fallback);

  if (canonicalName !== name) {
    lookupModuleMap.set(name, fallback);
  }
}

export function listModules(): readonly OrchestratorModule[] {
  return Array.from(canonicalModuleMap.values());
}

export function getModule(name: string): OrchestratorModule | undefined {
  const direct = lookupModuleMap.get(name);
  if (direct) {
    return direct;
  }

  return lookupModuleMap.get(canonicalizeModuleName(name));
}
