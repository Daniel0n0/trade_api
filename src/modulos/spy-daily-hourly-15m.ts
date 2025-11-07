import type { ModuleRunner } from '../orchestrator/types.js';

/**
 * Módulo placeholder para SPY con marcos de 1 día, 1 hora y 15 minutos.
 * Actualmente no ejecuta ninguna lógica y se deja intencionalmente inactivo.
 */
export const runSpyDailyHourly15mModule: ModuleRunner = async () => {
  return undefined;
};
