import type { BrowserContext } from 'playwright';

/**
 * Módulo placeholder para SPY con marcos de 1 día, 1 hora y 15 minutos.
 * Actualmente no ejecuta ninguna lógica y se deja intencionalmente inactivo.
 */
export async function runSpyDailyHourly15mModule(context: BrowserContext): Promise<void> {
  void context;
  await Promise.resolve();
}
