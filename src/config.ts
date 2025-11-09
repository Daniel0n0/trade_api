import { join } from 'node:path';
import { homedir } from 'node:os';

export const ROBINHOOD_URL = 'https://robinhood.com/';
export const ROBINHOOD_ENTRY_URL = 'https://robinhood.com/us/en/';
export const ROBINHOOD_LOGIN_URL = 'https://robinhood.com/login/';
const ROBINHOOD_LEGEND_LAYOUT_BASE = 'https://robinhood.com/legend/layout';
export const ROBINHOOD_HOME_URL = `${ROBINHOOD_LEGEND_LAYOUT_BASE}/`;
export const ROBINHOOD_HOME_URL_GLOB = `${ROBINHOOD_HOME_URL}**` as const;
export const isRobinhoodHomeUrl = (url: string): boolean =>
  url.startsWith(ROBINHOOD_HOME_URL) || url === ROBINHOOD_LEGEND_LAYOUT_BASE;
export const ROBINHOOD_LOGIN_URL_GLOB = `${ROBINHOOD_LOGIN_URL}**` as const;
// Extended to allow for slower redirects in environments with higher latency.
export const LANDING_REDIRECT_TIMEOUT_MS = 45_000;
export const HOME_REDIRECT_TIMEOUT_MS = 45_000;
export const POST_AUTH_MODULE_DELAY_MS = 2_000;

export interface LaunchOptions {
  readonly userDataDir: string;
  readonly slowMo: number;
  readonly tracingEnabled: boolean;
  readonly preserveUserDataDir: boolean;
  readonly blockTrackingDomains: boolean;
}

export const defaultLaunchOptions: LaunchOptions = {
  userDataDir: join(homedir(), '.robinhood-playwright-profile'),
  slowMo: 75,
  tracingEnabled: true,
  preserveUserDataDir: false,
  blockTrackingDomains: true,
};

export const WATCHLIST_PATH = '/watchlist';
export const PORTFOLIO_PATH = '/account/overview';

export const LOGIN_CHECK_INTERVAL_MS = 10_000;

export enum SessionState {
  Unknown = 'unknown',
  Authenticated = 'authenticated',
  RequiresLogin = 'requires-login',
}

export const SESSION_MARKERS = {
  portfolioHeadingRole: { name: /portfolio|account|value/i } as const,
  accountValueText: /Buying Power|Net Account Value/i,
  watchlistHeadingRole: { name: /watchlist/i } as const,
  watchlistText: /Watchlist|Lists/i,
  loginButtonRole: { name: /log in/i } as const,
} as const;

export interface ModuleDefinition {
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly urlCode?: string;
}

const LEGEND_DEFAULT_WEB_CLIENT = 'WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT';
const LEGEND_DEFAULT_QUERY = `?default_web_client=${LEGEND_DEFAULT_WEB_CLIENT}` as const;

export const MODULE_URL_CODES: Readonly<Record<string, string>> = {
  'spy-daily-hourly-15m': '6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da',
  'spy-5m-1m': '9a624e15-84c5-4a0e-8391-69f32b32d8d5',
  'spy-options-chain': 'c59d5a8e-397f-421a-a6e4-8ffe753c3456',
  'spx-options-chain': '0413b972-f84e-4ce7-8eae-c0a50b96cc90',
} as const;

export const buildLegendLayoutUrl = (code: string): string =>
  `${ROBINHOOD_LEGEND_LAYOUT_BASE}/${code}${LEGEND_DEFAULT_QUERY}`;

export const MODULES: readonly ModuleDefinition[] = [
  {
    name: 'spy-5m-1m',
    description: 'SPY con marcos de 5 minutos y 1 minuto',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['spy-5m-1m']),
    urlCode: MODULE_URL_CODES['spy-5m-1m'],
  },
];
