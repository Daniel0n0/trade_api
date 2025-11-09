import type { BrowserContext, Page } from 'playwright';

import { MODULES } from './config.js';
import { MODULE_RUNNERS } from './modulos/index.js';
import type { ModuleArgs } from './orchestrator/messages.js';
import { hydrateModulePage } from './modules/session-transfer.js';

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

export async function openModuleTabs(context: BrowserContext): Promise<Page[]> {
  const openedPages: Page[] = [];
  let firstHydrationSuccessful = false;
  let firstHydrationAttempted = false;

  for (const module of MODULES) {
    if (!module.url) {
      /* eslint-disable no-console */
      console.warn(`Se omitió el módulo "${module.name}" porque no tiene URL configurada.`);
      /* eslint-enable no-console */
      continue;
    }

    const page = await context.newPage();

    try {
      await page.goto('about:blank');
    } catch (error) {
      /* eslint-disable no-console */
      console.warn('No se pudo inicializar la pestaña en blanco antes de hidratar la sesión:', error);
      /* eslint-enable no-console */
    }

    const hydration = await hydrateModulePage(context, page);

    if (hydration.warnings.length > 0) {
      /* eslint-disable no-console */
      for (const warning of hydration.warnings) {
        console.warn(`[session-transfer] ${warning}`);
      }
      /* eslint-enable no-console */
    }

    const isFirstHydratedModule = !firstHydrationAttempted;
    firstHydrationAttempted = true;

    if (isFirstHydratedModule) {
      if (hydration.ok) {
        firstHydrationSuccessful = true;
      } else {
        /* eslint-disable no-console */
        console.warn(
          `[session-transfer] La hidratación inicial de la sesión falló para "${module.name}". No se abrirán pestañas adicionales para evitar reintentos de autenticación.`,
        );
        /* eslint-enable no-console */
      }
    } else if (!firstHydrationSuccessful) {
      /* eslint-disable no-console */
      console.warn(
        `[session-transfer] Se omite el módulo "${module.name}" porque la sesión no se hidrató en la primera pestaña.`,
      );
      /* eslint-enable no-console */
      await page.close();
      break;
    }

    openedPages.push(page);

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
      const args: ModuleArgs = {
        module: module.name,
        action: 'preview',
        ...(module.urlCode ? { urlCode: module.urlCode } : {}),
      };
      runner(args, { context, page }).catch((error: unknown) => {
        /* eslint-disable no-console */
        console.error(`Error al ejecutar el módulo "${module.name}":`, error);
        /* eslint-enable no-console */
      });
    }
  }

  if (MODULES.length > 0 && !firstHydrationAttempted) {
    /* eslint-disable no-console */
    console.warn('[session-transfer] No se intentó la hidratación de sesión; revisa la configuración de módulos.');
    /* eslint-enable no-console */
  }

  return openedPages;
}
