import { join } from 'node:path';
import { homedir } from 'node:os';
import process from 'node:process';

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

export type ModuleUrlArgs = {
  readonly urlCode?: string;
  readonly symbols?: readonly string[];
};

export interface ModuleDefinition {
  readonly name: string;
  readonly description: string;
  readonly url?: string;
  readonly urlTemplate?: string;
  readonly urlCode?: string;
  readonly requiresUrlCode?: boolean;
  readonly requiresSymbols?: boolean;
  readonly defaultSymbols?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

const LEGEND_DEFAULT_WEB_CLIENT = 'WEB_CLIENT_PREFERENCE_BLACK_WIDOW_DEFAULT';
const LEGEND_DEFAULT_QUERY = `?default_web_client=${LEGEND_DEFAULT_WEB_CLIENT}` as const;

const MODULE_URL_CODE_ENV_PREFIX = 'TRADE_API_URL_CODE_';

const normalizeModuleEnvKey = (module: string): string =>
  module.replace(/[^a-z0-9]/giu, '_').toUpperCase();

const applyModuleUrlCodeOverrides = <T extends Record<string, string>>(
  defaults: T,
): Readonly<Record<keyof T, string>> => {
  const entries = Object.entries(defaults).map(([module, fallback]) => {
    const envKey = `${MODULE_URL_CODE_ENV_PREFIX}${normalizeModuleEnvKey(module)}`;
    const override = process.env[envKey]?.trim();
    return [module, override && override.length > 0 ? override : fallback];
  });
  return Object.freeze(Object.fromEntries(entries) as Record<keyof T, string>);
};

const DEFAULT_MODULE_URL_CODES = {
  'spy-daily-hourly-15m': 'a9615d6b-6934-4d35-9e15-c0b5acafcfd7',
  'spy-5m-1m': 'fe5d1cd6-27de-49f6-9d9a-b56e905f3a8f',
  'spy-options-chain': 'c59d5a8e-397f-421a-a6e4-8ffe753c3456',
  'spx-options-chain': '0413b972-f84e-4ce7-8eae-c0a50b96cc90',
  // Los siguientes códigos sirven como marcadores hasta que se capture el UUID
  // definitivo de cada layout Legend. Puedes sobrescribirlos con `--url-code`
  // al ejecutar un runner o con variables de entorno `TRADE_API_URL_CODE_*`
  // para capturar nuevos layouts sin recompilar.
  'stocks-generic-chart': '00000000-0000-0000-0000-000000000101',
  'options-generic': '00000000-0000-0000-0000-000000000102',
  'stock-daily-stats': '00000000-0000-0000-0000-000000000103',
  'stock-daily-news': '00000000-0000-0000-0000-000000000104',
  'stock-daily-orderbook': '00000000-0000-0000-0000-000000000105',
  'futures-overview': '00000000-0000-0000-0000-000000000106',
  'futures-detail': '00000000-0000-0000-0000-000000000107',
} as const satisfies Record<string, string>;

export const MODULE_URL_CODES: Readonly<Record<keyof typeof DEFAULT_MODULE_URL_CODES, string>> =
  applyModuleUrlCodeOverrides(DEFAULT_MODULE_URL_CODES);

export const buildLegendLayoutUrl = (code: string): string =>
  `${ROBINHOOD_LEGEND_LAYOUT_BASE}/${code}${LEGEND_DEFAULT_QUERY}`;

const LEGEND_URL_TEMPLATE = `${ROBINHOOD_LEGEND_LAYOUT_BASE}/{urlCode}${LEGEND_DEFAULT_QUERY}` as const;
const OPTIONS_URL_TEMPLATE = 'https://robinhood.com/options/{symbol}' as const;
const STOCK_STATS_URL_TEMPLATE = 'https://robinhood.com/us/en/stocks/{symbol}/stats/' as const;
const STOCK_NEWS_URL_TEMPLATE = 'https://robinhood.com/us/en/stocks/{symbol}/news/' as const;
const STOCK_ORDER_BOOK_URL_TEMPLATE = 'https://robinhood.com/us/en/stocks/{symbol}/order-book/' as const;
const FUTURES_BASE_URL = 'https://robinhood.com/us/en/markets/futures' as const;
const FUTURES_DETAIL_URL_TEMPLATE = `${FUTURES_BASE_URL}/{symbol}/` as const;

const normalizeSymbols = (symbols?: readonly string[]): readonly string[] | undefined => {
  if (!symbols) {
    return undefined;
  }

  const normalized = symbols
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);

  return normalized.length > 0 ? normalized : undefined;
};

const pickSymbols = (definition: ModuleDefinition, args?: ModuleUrlArgs): readonly string[] | undefined => {
  const candidates = normalizeSymbols(args?.symbols ?? definition.defaultSymbols);
  if (!candidates || candidates.length === 0) {
    return undefined;
  }
  return candidates;
};

const pickUrlCode = (definition: ModuleDefinition, args?: ModuleUrlArgs): string | undefined => {
  const candidate = (args?.urlCode ?? definition.urlCode)?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const TEMPLATE_PATTERN = /\{([a-z0-9_]+)\}/giu;

const fillUrlTemplate = (
  template: string,
  definition: ModuleDefinition,
  args?: ModuleUrlArgs,
): string | undefined => {
  if (!template) {
    return undefined;
  }

  const symbols = pickSymbols(definition, args);
  const urlCode = pickUrlCode(definition, args);

  if (definition.requiresUrlCode && !urlCode) {
    return undefined;
  }

  if (definition.requiresSymbols && (!symbols || symbols.length === 0)) {
    return undefined;
  }

  const primarySymbol = symbols?.[0];

  let missingRequired = false;

  const resolved = template.replace(TEMPLATE_PATTERN, (match, rawKey) => {
    const key = rawKey.toLowerCase();
    switch (key) {
      case 'urlcode':
      case 'code':
        if (!urlCode) {
          missingRequired = true;
          return match;
        }
        return urlCode;
      case 'symbol':
        if (!primarySymbol) {
          missingRequired = true;
          return match;
        }
        return primarySymbol;
      case 'symbols':
        if (!symbols || symbols.length === 0) {
          missingRequired = true;
          return match;
        }
        return symbols.join(',');
      default:
        return match;
    }
  });

  if (missingRequired) {
    return undefined;
  }

  return resolved;
};

export const resolveModuleUrl = (
  definition: ModuleDefinition,
  args?: ModuleUrlArgs,
): string | undefined => {
  if (definition.urlTemplate) {
    const templated = fillUrlTemplate(definition.urlTemplate, definition, args);
    if (templated) {
      return templated;
    }
  }

  return definition.url;
};

export const getModuleDefaultArgs = (definition: ModuleDefinition): ModuleUrlArgs => {
  const symbols = pickSymbols(definition);
  const urlCode = pickUrlCode(definition);
  return {
    ...(symbols ? { symbols } : {}),
    ...(urlCode ? { urlCode } : {}),
  };
};

export const MODULES: readonly ModuleDefinition[] = [
  {
    name: 'spy-daily-hourly-15m',
    description: 'Gráficas Legend de SPY en 1D, 1H y 15m',
    urlTemplate: LEGEND_URL_TEMPLATE,
    urlCode: MODULE_URL_CODES['spy-daily-hourly-15m'],
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
  {
    name: 'spy-5m-1m',
    description: 'Gráficas Legend de SPY en 5m y 1m',
    urlTemplate: LEGEND_URL_TEMPLATE,
    urlCode: MODULE_URL_CODES['spy-5m-1m'],
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
  {
    name: 'spot',
    description: 'Vista Legend genérica (requiere urlCode)',
    urlTemplate: LEGEND_URL_TEMPLATE,
    requiresUrlCode: true,
  },
  {
    name: 'spy-options-chain',
    description: 'Cadena de opciones para SPY',
    urlTemplate: OPTIONS_URL_TEMPLATE,
    url: 'https://robinhood.com/options',
    defaultSymbols: ['SPY'],
  },
  {
    name: 'spx-options-chain',
    description: 'Cadena de opciones para SPX',
    urlTemplate: OPTIONS_URL_TEMPLATE,
    url: 'https://robinhood.com/options',
    defaultSymbols: ['SPX'],
  },
  {
    name: 'options',
    description: 'Navegador genérico de opciones por símbolo',
    urlTemplate: OPTIONS_URL_TEMPLATE,
    url: 'https://robinhood.com/options',
    defaultSymbols: ['SPY'],
  },
  {
    name: 'daily-stats',
    description: 'Estadísticas diarias para un símbolo específico',
    urlTemplate: STOCK_STATS_URL_TEMPLATE,
    defaultSymbols: ['SPY'],
    requiresSymbols: true,
  },
  {
    name: 'daily-news',
    description: 'Noticias diarias para un símbolo específico',
    urlTemplate: STOCK_NEWS_URL_TEMPLATE,
    defaultSymbols: ['SPY'],
    requiresSymbols: true,
  },
  {
    name: 'daily-order-book',
    description: 'Order book diario para un símbolo específico',
    urlTemplate: STOCK_ORDER_BOOK_URL_TEMPLATE,
    defaultSymbols: ['SPY'],
    requiresSymbols: true,
  },
  {
    name: 'futures',
    description: 'Panel principal de mercados de futuros',
    url: `${FUTURES_BASE_URL}/`,
  },
  {
    name: 'futures-mes',
    description: 'Futuros Micro E-mini S&P 500 (MES)',
    urlTemplate: FUTURES_DETAIL_URL_TEMPLATE,
    defaultSymbols: ['MES'],
    requiresSymbols: true,
  },
  {
    name: 'futures-mnq',
    description: 'Futuros Micro E-mini Nasdaq-100 (MNQ)',
    urlTemplate: FUTURES_DETAIL_URL_TEMPLATE,
    defaultSymbols: ['MNQ'],
    requiresSymbols: true,
  },
  {
    name: 'spy-daily-hourly-15m',
    description: 'Vista Legend de SPY (1D/1H/15m)',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['spy-daily-hourly-15m']),
    urlCode: MODULE_URL_CODES['spy-daily-hourly-15m'],
  },
  {
    name: 'spy-options-chain',
    description: 'Cadena de opciones para SPY',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['spy-options-chain']),
    urlCode: MODULE_URL_CODES['spy-options-chain'],
  },
  {
    name: 'spx-options-chain',
    description: 'Cadena de opciones para SPX',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['spx-options-chain']),
    urlCode: MODULE_URL_CODES['spx-options-chain'],
  },
  {
    name: 'stocks-generic-chart',
    description: 'Leyenda genérica de acciones (marcos configurables)',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['stocks-generic-chart']),
    urlCode: MODULE_URL_CODES['stocks-generic-chart'],
  },
  {
    name: 'options-generic',
    description: 'Cadena de opciones genérica (símbolo parametrizable)',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['options-generic']),
    urlCode: MODULE_URL_CODES['options-generic'],
  },
  {
    name: 'stock-daily-stats',
    description: 'Estadísticas diarias de acciones',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['stock-daily-stats']),
    urlCode: MODULE_URL_CODES['stock-daily-stats'],
  },
  {
    name: 'stock-daily-news',
    description: 'Noticias diarias de acciones',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['stock-daily-news']),
    urlCode: MODULE_URL_CODES['stock-daily-news'],
  },
  {
    name: 'stock-daily-orderbook',
    description: 'Libro de órdenes diario de acciones',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['stock-daily-orderbook']),
    urlCode: MODULE_URL_CODES['stock-daily-orderbook'],
  },
  {
    name: 'futures-overview',
    description: 'Panel general de futuros',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['futures-overview']),
    urlCode: MODULE_URL_CODES['futures-overview'],
  },
  {
    name: 'futures-detail',
    description: 'Detalle de un contrato de futuros',
    url: buildLegendLayoutUrl(MODULE_URL_CODES['futures-detail']),
    urlCode: MODULE_URL_CODES['futures-detail'],
  },
];
