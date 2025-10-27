import type { Page } from 'playwright';

import {
  LOGIN_CHECK_INTERVAL_MS,
  LOGIN_MAX_ATTEMPTS,
  ROBINHOOD_URL,
  SESSION_MARKERS,
  SessionState,
} from './config.js';

export async function ensureLoggedIn(page: Page): Promise<SessionState> {
  let currentState = await detectSessionState(page);
  if (currentState === SessionState.Authenticated) {
    return currentState;
  }

  await page.goto(ROBINHOOD_URL, { waitUntil: 'domcontentloaded' });
  currentState = await detectSessionState(page);
  if (currentState === SessionState.Authenticated) {
    return currentState;
  }

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
    `Se comprobará el estado de autenticación cada ${LOGIN_CHECK_INTERVAL_MS / 1_000} segundos ` +
      `hasta ${LOGIN_MAX_ATTEMPTS} veces.`,
  );
  /* eslint-enable no-console */

  let referenceUrl = page.url();

  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
    const urlChanged = await page
      .waitForURL(
        (url) => url.toString() !== referenceUrl,
        { timeout: LOGIN_CHECK_INTERVAL_MS, waitUntil: 'domcontentloaded' },
      )
      .then(() => true)
      .catch(() => false);

    if (urlChanged) {
      /* eslint-disable no-console */
      console.log('Se detectó una redirección posterior al inicio de sesión.');
      console.log(`Nueva URL: ${page.url()}`);
      /* eslint-enable no-console */

      await page.waitForLoadState('networkidle').catch(() => page.waitForTimeout(1_000));
      return SessionState.Authenticated;
    }

    const state = await detectSessionState(page);

    if (state === SessionState.Authenticated) {
      /* eslint-disable no-console */
      console.log('Sesión autenticada correctamente.');
      /* eslint-enable no-console */
      return state;
    }

    if (attempt < LOGIN_MAX_ATTEMPTS) {
      /* eslint-disable no-console */
      console.log(
        `Intento ${attempt} sin éxito. Esperando ${LOGIN_CHECK_INTERVAL_MS / 1_000} segundos antes de volver a comprobar...`,
      );
      /* eslint-enable no-console */
    }

    referenceUrl = page.url();
  }

  /* eslint-disable no-console */
  console.log('No se pudo confirmar el inicio de sesión tras los intentos configurados.');
  /* eslint-enable no-console */

  return detectSessionState(page);
}
