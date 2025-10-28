import type { BrowserContext, Page } from 'playwright';

import { MODULES } from './config.js';
import { MODULE_RUNNERS } from './modulos/index.js';

const CONSENT_CONTAINER_SELECTORS = [
  '[data-testid*="consent"]',
  '[data-testid*="cookie"]',
  '[data-testid="modal"]',
  '[role="dialog"]',
  '[aria-modal="true"]',
] as const;

const CONSENT_DISMISS_SELECTORS = [
  '[data-testid="modal-close-button"]',
  '[data-testid="close-button"]',
  '[aria-label="Close"]',
  'button:has-text(/accept|agree|got it|okay|ok|understand|entendido|cerrar/i)',
  'button:has-text(/dismiss|continue|aceptar|rechazar|cerrar/i)',
] as const;

async function ensureNoModalConsent(page: Page): Promise<void> {
  for (let sweep = 0; sweep < 3; sweep += 1) {
    let closedAny = false;

    for (const containerSelector of CONSENT_CONTAINER_SELECTORS) {
      const containers = page.locator(containerSelector);
      const count = await containers.count();

      for (let index = 0; index < count; index += 1) {
        const container = containers.nth(index);
        const visible = await container.isVisible().catch(() => false);
        if (!visible) {
          continue;
        }

        let dismissed = false;
        for (const dismissSelector of CONSENT_DISMISS_SELECTORS) {
          const dismissButton = container.locator(dismissSelector).first();
          const hasButton = (await dismissButton.count().catch(() => 0)) > 0;
          if (!hasButton) {
            continue;
          }

          try {
            await dismissButton.click({ timeout: 2_000 });
            await container.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() =>
              container.waitFor({ state: 'detached', timeout: 1_000 }).catch(() => undefined),
            );
            dismissed = true;
            closedAny = true;
            break;
          } catch (_error) {
            // Try the next selector if the click fails.
          }
        }

        if (!dismissed) {
          try {
            await page.keyboard.press('Escape');
            await container.waitFor({ state: 'hidden', timeout: 1_000 }).catch(() => undefined);
            closedAny = true;
          } catch (_error) {
            // Ignore if Escape could not be pressed or had no effect.
          }
        }
      }
    }

    if (!closedAny) {
      break;
    }

    await page.waitForTimeout(250);
  }
}

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
      await ensureNoModalConsent(page);
      runner(page).catch((error: unknown) => {
        /* eslint-disable no-console */
        console.error(`Error al ejecutar el módulo "${module.name}":`, error);
        /* eslint-enable no-console */
      });
    }
  }
}
