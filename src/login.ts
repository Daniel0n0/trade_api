import type { Page } from 'playwright';

import {
  LANDING_REDIRECT_TIMEOUT_MS,
  LOGIN_CHECK_INTERVAL_MS,
  HOME_REDIRECT_TIMEOUT_MS,
  POST_AUTH_MODULE_DELAY_MS,
  ROBINHOOD_ENTRY_URL,
  ROBINHOOD_HOME_URL_GLOB,
  ROBINHOOD_LOGIN_URL,
  ROBINHOOD_LOGIN_URL_GLOB,
  ROBINHOOD_URL,
  SESSION_MARKERS,
  SessionState,
  isRobinhoodHomeUrl,
} from './config.js';

export interface AuthenticatedUiCheckpoint {
  readonly kind: 'home' | 'fallback';
  readonly url: string;
}

export interface LoginResult {
  readonly state: SessionState;
  readonly uiReady?: AuthenticatedUiCheckpoint;
}

export async function ensureLoggedIn(page: Page): Promise<LoginResult> {
  const currentState = await detectSessionState(page);
  if (currentState === SessionState.Authenticated) {
    const uiReady = await waitForHomeDashboard(page);
    return { state: currentState, uiReady };
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
  await page.waitForLoadState('networkidle', { timeout: LANDING_REDIRECT_TIMEOUT_MS });

  const landingOutcome =
    (await Promise.race([
      loginRedirectWatcher,
      homeRedirectWatcher,
      page.waitForTimeout(LANDING_REDIRECT_TIMEOUT_MS).then(() => 'timeout' as const),
    ])) ?? 'timeout';

  if (landingOutcome === 'home' || isRobinhoodHomeUrl(page.url())) {
    const uiReady = await waitForHomeDashboard(page);
    return { state: SessionState.Authenticated, uiReady };
  }

  if (landingOutcome === 'login' || page.url().startsWith(ROBINHOOD_LOGIN_URL)) {
    await ensureLoginScreenReady(page);
    return waitForManualLogin(page);
  }

  await page.goto(ROBINHOOD_LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: LANDING_REDIRECT_TIMEOUT_MS });
  await ensureLoginScreenReady(page);
  return waitForManualLogin(page);
}

export async function detectSessionState(page: Page): Promise<SessionState> {
  const loginButton = page.getByRole('button', SESSION_MARKERS.loginButtonRole);
  if (await loginButton.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    return SessionState.RequiresLogin;
  }

  if (await isAuthenticatedView(page)) {
    return SessionState.Authenticated;
  }

  return SessionState.Unknown;
}

async function ensureLoginScreenReady(page: Page): Promise<void> {
  const loginButton = page.getByRole('button', SESSION_MARKERS.loginButtonRole);
  await loginButton.first().waitFor({ state: 'visible', timeout: 5_000 });
}

async function waitForManualLogin(page: Page): Promise<LoginResult> {
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

      const uiReady = await waitForHomeDashboard(page);
      return { state: SessionState.Authenticated, uiReady };
    }

    if (page.isClosed()) {
      throw new Error('La ventana del navegador se cerró antes de confirmar el inicio de sesión.');
    }

    const state = await detectSessionState(page);
    if (state === SessionState.Authenticated) {
      const uiReady = await waitForHomeDashboard(page);
      return { state, uiReady };
    }

    /* eslint-disable no-console */
    console.log(
      `Aún no se confirma el inicio de sesión. Nueva comprobación en ${LOGIN_CHECK_INTERVAL_MS / 1_000} segundos...`,
    );
    /* eslint-enable no-console */
  }
}

async function waitForHomeDashboard(page: Page): Promise<AuthenticatedUiCheckpoint> {
  /* eslint-disable no-console */
  console.log('Esperando a que se cargue el home de Robinhood...');
  /* eslint-enable no-console */

  await page
    .waitForURL(ROBINHOOD_HOME_URL_GLOB, { timeout: HOME_REDIRECT_TIMEOUT_MS })
    .catch(() => null);

  await page.waitForLoadState('networkidle', { timeout: HOME_REDIRECT_TIMEOUT_MS });

  const homeDetected = await isAuthenticatedView(page, { timeout: HOME_REDIRECT_TIMEOUT_MS });

  let checkpoint: AuthenticatedUiCheckpoint;

  if (!homeDetected) {
    /* eslint-disable no-console */
    console.log('No se detectó el home. Navegando a la vista estable /stocks/SPY como fallback...');
    /* eslint-enable no-console */

    await navigateToFallbackStock(page);
    checkpoint = { kind: 'fallback', url: page.url() };
  } else {
    checkpoint = { kind: 'home', url: page.url() };
  }

  await page.waitForTimeout(POST_AUTH_MODULE_DELAY_MS);
  return checkpoint;
}

const AUTHENTICATED_VIEW_SELECTORS = [
  'role=button[name=/account/i]',
  'role=button[name=/log out/i]',
  'role=menuitem[name=/log out/i]',
  'role=heading[name=/portfolio|account|value/i]',
  'text=/Buying Power|Net Account Value/i',
] as const;

export const FALLBACK_STOCK_URL = new URL('/stocks/SPY', ROBINHOOD_URL).toString();

const FALLBACK_STOCK_SELECTORS = [
  'role=heading[name=/SPY/i]',
  'text=/SPDR\\s+S&P\\s+500/i',
  'text=/\\bSPY\\b/i',
] as const;

interface AuthenticatedViewOptions {
  readonly timeout?: number;
}

type WaitForSelectorOptions = Parameters<Page['waitForSelector']>[1];
type WaitForSelectorState = WaitForSelectorOptions extends { state?: infer State }
  ? State
  : Parameters<Page['waitForSelector']>[1] extends { state?: infer State }
    ? State
    : never;

interface WaitForAnySelectorOptions {
  readonly timeout?: number;
  readonly state?: WaitForSelectorState;
}

async function isAuthenticatedView(
  page: Page,
  { timeout = 5_000 }: AuthenticatedViewOptions = {},
): Promise<boolean> {
  try {
    await waitForAnySelector(page, AUTHENTICATED_VIEW_SELECTORS, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function navigateToFallbackStock(page: Page): Promise<void> {
  await page.goto(FALLBACK_STOCK_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: HOME_REDIRECT_TIMEOUT_MS });
  await waitForAnySelector(page, FALLBACK_STOCK_SELECTORS, { timeout: HOME_REDIRECT_TIMEOUT_MS });
}

async function waitForAnySelector(
  page: Page,
  selectors: readonly string[],
  options: WaitForAnySelectorOptions = {},
): Promise<string> {
  if (selectors.length === 0) {
    throw new Error('At least one selector must be provided.');
  }

  const { timeout = HOME_REDIRECT_TIMEOUT_MS, state = 'visible' } = options;

  const watchers = selectors.map((selector) =>
    page
      .waitForSelector(selector, { timeout, state })
      .then(() => selector)
      .catch(() => null),
  );

  const winner = await Promise.race(watchers);
  if (winner) {
    return winner;
  }

  const resolved = await Promise.all(watchers);
  const firstMatch = resolved.find((selector): selector is string => selector !== null);
  if (firstMatch) {
    return firstMatch;
  }

  throw new Error('None of the selectors became visible before the timeout elapsed.');
}
