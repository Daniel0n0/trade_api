import {
  MODULES as CONFIGURED_MODULES,
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

const moduleMap = new Map<string, OrchestratorModule>();

for (const definition of CONFIGURED_MODULES) {
  const descriptor = toModuleDescriptor(definition);
  if (descriptor) {
    moduleMap.set(definition.name, descriptor);
  }
}

for (const [name, runner] of Object.entries(MODULE_RUNNERS)) {
  if (moduleMap.has(name)) {
    continue;
  }

  moduleMap.set(name, {
    name,
    description: name,
    url: undefined,
    runner,
  });
}

export function listModules(): readonly OrchestratorModule[] {
  return Array.from(moduleMap.values());
}

export function getModule(name: string): OrchestratorModule | undefined {
  return moduleMap.get(name);
}
