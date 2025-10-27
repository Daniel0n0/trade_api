import type { Page } from 'playwright';

import {
  LANDING_REDIRECT_TIMEOUT_MS,
  LOGIN_CHECK_INTERVAL_MS,
  HOME_REDIRECT_TIMEOUT_MS,
  POST_AUTH_MODULE_DELAY_MS,
  ROBINHOOD_ENTRY_URL,
  ROBINHOOD_HOME_URL,
  ROBINHOOD_HOME_URL_GLOB,
  ROBINHOOD_LOGIN_URL,
  ROBINHOOD_LOGIN_URL_GLOB,
  SESSION_MARKERS,
  SessionState,
} from './config.js';

export async function ensureLoggedIn(page: Page): Promise<SessionState> {
  let currentState = await detectSessionState(page);
  if (currentState === SessionState.Authenticated) {
    await waitForHomeDashboard(page);
    return currentState;
  }

  const loginRedirectWatcher = page
    .waitForURL(ROBINHOOD_LOGIN_URL_GLOB, { timeout: LANDING_REDIRECT_TIMEOUT_MS })
    .then(() => 'login' as const)
    .catch(() => null);
  const homeRedirectWatcher = page
    .waitForURL(ROBINHOOD_HOME_URL_GLOB, { timeout: LANDING_REDIRECT_TIMEOUT_MS })
    .then(() => 'home' as const)
    .catch(() => null);

  await page.goto(ROBINHOOD_ENTRY_URL, { waitUntil: 'domcontentloaded' });

  const landingOutcome =
    (await Promise.race([
      loginRedirectWatcher,
      homeRedirectWatcher,
      page.waitForTimeout(LANDING_REDIRECT_TIMEOUT_MS).then(() => 'timeout' as const),
    ])) ?? 'timeout';

  if (landingOutcome === 'home' || page.url().startsWith(ROBINHOOD_HOME_URL)) {
    await waitForHomeDashboard(page);
    return SessionState.Authenticated;
  }

  if (landingOutcome === 'login' || page.url().startsWith(ROBINHOOD_LOGIN_URL)) {
    await ensureLoginScreenReady(page);
    return waitForManualLogin(page);
  }

  await page.goto(ROBINHOOD_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await ensureLoginScreenReady(page);
  return waitForManualLogin(page);
}

export async function detectSessionState(page: Page): Promise<SessionState> {
  const loginButton = page.getByRole('button', SESSION_MARKERS.loginButtonRole);
  if (await loginButton.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    return SessionState.RequiresLogin;
  }

  const dashboardLocator = page.locator(SESSION_MARKERS.dashboard);
  if (await dashboardLocator.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return SessionState.Authenticated;
  }

  return SessionState.Unknown;
}

async function ensureLoginScreenReady(page: Page): Promise<void> {
  const loginButton = page.getByRole('button', SESSION_MARKERS.loginButtonRole);
  await loginButton.first().waitFor({ state: 'visible', timeout: 5_000 });
}

async function waitForManualLogin(page: Page): Promise<SessionState> {
  /* eslint-disable no-console */
  console.log('\nManual login required.');
  console.log('Completa las credenciales y cualquier MFA en la ventana del navegador.');
  console.log(
    `Se comprobará la redirección desde ${ROBINHOOD_LOGIN_URL} cada ${LOGIN_CHECK_INTERVAL_MS / 1_000} segundos ` +
      'hasta confirmar el inicio de sesión.',
  );
  /* eslint-enable no-console */

  for (;;) {
    const reachedHome = await page
      .waitForURL(ROBINHOOD_HOME_URL_GLOB, { timeout: LOGIN_CHECK_INTERVAL_MS })
      .then(() => true)
      .catch((error: unknown) => {
        if (error instanceof Error && /Target closed/.test(error.message)) {
          throw error;
        }

        return false;
      });

    if (reachedHome) {
      /* eslint-disable no-console */
      console.log('Se detectó una redirección posterior al inicio de sesión.');
      console.log(`Nueva URL: ${page.url()}`);
      /* eslint-enable no-console */

      await waitForHomeDashboard(page);
      return SessionState.Authenticated;
    }

    if (page.isClosed()) {
      throw new Error('La ventana del navegador se cerró antes de confirmar el inicio de sesión.');
    }

    const state = await detectSessionState(page);
    if (state === SessionState.Authenticated) {
      await waitForHomeDashboard(page);
      return state;
    }

    /* eslint-disable no-console */
    console.log(
      `Aún no se confirma el inicio de sesión. Nueva comprobación en ${LOGIN_CHECK_INTERVAL_MS / 1_000} segundos...`,
    );
    /* eslint-enable no-console */
  }
}

async function waitForHomeDashboard(page: Page): Promise<void> {
  /* eslint-disable no-console */
  console.log('Esperando a que se cargue el home de Robinhood...');
  /* eslint-enable no-console */

  const reachedHome = await page
    .waitForURL(ROBINHOOD_HOME_URL_GLOB, { timeout: HOME_REDIRECT_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);

  if (!reachedHome) {
    throw new Error('No se pudo confirmar la redirección al home de Robinhood tras iniciar sesión.');
  }

  await page.waitForTimeout(POST_AUTH_MODULE_DELAY_MS);
}
