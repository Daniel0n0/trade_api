import type { BrowserContext } from 'playwright';

import { MODULES } from './config.js';
import { MODULE_RUNNERS } from './modulos/index.js';

export async function openModuleTabs(context: BrowserContext): Promise<void> {
  for (const module of MODULES) {
    if (!module.url) {
      /* eslint-disable no-console */
      console.warn(`Se omitió el módulo "${module.name}" porque no tiene URL configurada.`);
      /* eslint-enable no-console */
      continue;
    }

    const page = await context.newPage();

    /* eslint-disable no-console */
    console.log(`Abriendo módulo "${module.name}" (${module.description})...`);
    /* eslint-enable no-console */

    await page.goto(module.url, { waitUntil: 'domcontentloaded' });
    await page
      .waitForLoadState('networkidle', { timeout: 15_000 })
      .catch(() => page.waitForTimeout(2_000));

    const runner = MODULE_RUNNERS[module.name];
    if (runner) {
      runner(page).catch((error: unknown) => {
        /* eslint-disable no-console */
        console.error(`Error al ejecutar el módulo "${module.name}":`, error);
        /* eslint-enable no-console */
      });
    }
  }
}
