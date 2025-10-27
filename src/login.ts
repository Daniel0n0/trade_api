import type { Page } from 'playwright';

import {
  LANDING_REDIRECT_TIMEOUT_MS,
  LOGIN_CHECK_INTERVAL_MS,
  LOGIN_MAX_ATTEMPTS,
  HOME_REDIRECT_TIMEOUT_MS,
  POST_AUTH_MODULE_DELAY_MS,
  ROBINHOOD_ENTRY_URL,
  ROBINHOOD_HOME_URL,
  ROBINHOOD_LOGIN_URL,
  SESSION_MARKERS,
  SessionState,
} from './config.js';

export async function ensureLoggedIn(page: Page): Promise<SessionState> {
  let currentState = await detectSessionState(page);
  if (currentState === SessionState.Authenticated) {
    await waitForHomeDashboard(page);
    return currentState;
  }

  await page.goto(ROBINHOOD_ENTRY_URL, { waitUntil: 'domcontentloaded' });

  const redirectedFromLanding = await page
    .waitForURL(
      (url) => !url.toString().startsWith(ROBINHOOD_ENTRY_URL),
      { timeout: LANDING_REDIRECT_TIMEOUT_MS, waitUntil: 'domcontentloaded' },
    )
    .then(() => true)
    .catch(() => false);

  if (redirectedFromLanding) {
    currentState = await detectSessionState(page);
    if (currentState === SessionState.Authenticated) {
      await waitForHomeDashboard(page);
      return currentState;
    }
  }

  await page.goto(ROBINHOOD_LOGIN_URL, { waitUntil: 'domcontentloaded' });

  return waitForManualLogin(page);
}

export async function detectSessionState(page: Page): Promise<SessionState> {
  const loginButton = page.locator(SESSION_MARKERS.loginButton);
  if (await loginButton.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return SessionState.RequiresLogin;
  }

  const dashboardLocator = page.locator(SESSION_MARKERS.dashboard);
  if (await dashboardLocator.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
    return SessionState.Authenticated;
  }

  return SessionState.Unknown;
}

async function waitForManualLogin(page: Page): Promise<SessionState> {
  /* eslint-disable no-console */
  console.log('\nManual login required.');
  console.log('Completa las credenciales y cualquier MFA en la ventana del navegador.');
  console.log(
    `Se comprobará la redirección desde ${ROBINHOOD_LOGIN_URL} cada ${LOGIN_CHECK_INTERVAL_MS / 1_000} ` +
      `segundos hasta ${LOGIN_MAX_ATTEMPTS} veces.`,
  );
  /* eslint-enable no-console */

  if (!page.url().startsWith(ROBINHOOD_LOGIN_URL)) {
    const state = await detectSessionState(page);
    if (state === SessionState.Authenticated) {
      return state;
    }
  }

  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
    const urlChanged = await page
      .waitForURL(
        (url) => !url.toString().startsWith(ROBINHOOD_LOGIN_URL),
        { timeout: LOGIN_CHECK_INTERVAL_MS, waitUntil: 'domcontentloaded' },
      )
      .then(() => true)
      .catch(() => false);

    if (urlChanged) {
      /* eslint-disable no-console */
      console.log('Se detectó una redirección posterior al inicio de sesión.');
      console.log(`Nueva URL: ${page.url()}`);
      /* eslint-enable no-console */

      await waitForHomeDashboard(page);
      return SessionState.Authenticated;
    }

    if (attempt < LOGIN_MAX_ATTEMPTS) {
      /* eslint-disable no-console */
      console.log(
        `Intento ${attempt} sin éxito. Esperando ${LOGIN_CHECK_INTERVAL_MS / 1_000} segundos antes de volver a comprobar...`,
      );
      /* eslint-enable no-console */
    }
  }

  /* eslint-disable no-console */
  console.log('No se pudo confirmar el inicio de sesión tras los intentos configurados.');
  /* eslint-enable no-console */

  return detectSessionState(page);
}

async function waitForHomeDashboard(page: Page): Promise<void> {
  /* eslint-disable no-console */
  console.log('Esperando a que se cargue el home de Robinhood...');
  /* eslint-enable no-console */

  const reachedHome = await page
    .waitForURL(
      (url) => url.toString().startsWith(ROBINHOOD_HOME_URL),
      { timeout: HOME_REDIRECT_TIMEOUT_MS, waitUntil: 'domcontentloaded' },
    )
    .then(() => true)
    .catch(() => false);

  if (!reachedHome) {
    throw new Error('No se pudo confirmar la redirección al home de Robinhood tras iniciar sesión.');
  }

  await page.waitForTimeout(POST_AUTH_MODULE_DELAY_MS);
}
