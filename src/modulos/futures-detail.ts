import type { ModuleRunner } from '../orchestrator/types.js';

/**
 * Plantilla para vistas de detalle de un contrato de futuros. Este módulo
 * deberá combinarse con `runSocketSniffer` o interceptores HTTP dedicados una
 * vez que se definan los artefactos a persistir (por ejemplo curvas, *greeks* o
 * profundidad del libro).
 */
export const runFuturesDetailModule: ModuleRunner = async () => {
  return undefined;
};
