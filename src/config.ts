import { join } from 'node:path';
import { homedir } from 'node:os';

export const ROBINHOOD_URL = 'https://robinhood.com/';

export interface LaunchOptions {
  readonly userDataDir: string;
  readonly slowMo: number;
  readonly tracingEnabled: boolean;
}

export const defaultLaunchOptions: LaunchOptions = {
  userDataDir: join(homedir(), '.robinhood-playwright-profile'),
  slowMo: 75,
  tracingEnabled: true,
};

export const WATCHLIST_PATH = '/watchlist';
export const PORTFOLIO_PATH = '/account/overview';

export const WAIT_FOR_NETWORK_IDLE = 5_000;

export enum SessionState {
  Unknown = 'unknown',
  Authenticated = 'authenticated',
  RequiresLogin = 'requires-login',
}

export const SESSION_MARKERS = {
  dashboard: 'div[data-testid="homepage-dashboard"]',
  watchlist: '[data-testid="watchlist"]',
  loginButton: 'button:has-text("Log In")',
};
