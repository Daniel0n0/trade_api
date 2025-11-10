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

const getModuleUrlCodeOverride = (module: string): string | undefined => {
  const envKey = `${MODULE_URL_CODE_ENV_PREFIX}${normalizeModuleEnvKey(module)}`;
  const override = process.env[envKey]?.trim();
  return override && override.length > 0 ? override : undefined;
};

const applyModuleUrlCodeOverrides = <T extends Record<string, string>>(
  defaults: T,
): Readonly<Record<keyof T, string>> => {
  const entries = Object.entries(defaults).map(([module, fallback]) => {
    const override = getModuleUrlCodeOverride(module);
    return [module, override ?? fallback];
  });
  return Object.freeze(Object.fromEntries(entries) as Record<keyof T, string>);
};

const DEFAULT_MODULE_URL_CODES = {
  'spy-5m-1m': '6bb41212-dbb4-4dc0-a0a7-7a75e4aaf9da',
  'spy-options-chain': 'c59d5a8e-397f-421a-a6e4-8ffe753c3456',
  'spx-options-chain': '0413b972-f84e-4ce7-8eae-c0a50b96cc90',
} as const satisfies Record<string, string>;

export const MODULE_URL_CODES: Readonly<Record<keyof typeof DEFAULT_MODULE_URL_CODES, string>> =
  applyModuleUrlCodeOverrides(DEFAULT_MODULE_URL_CODES);

const OPTIONAL_MODULE_URL_CODE_NAMES = [
  'stocks-generic-chart',
  'options-generic',
  'daily-stats',
  'daily-news',
  'daily-order-book',
] as const;

type OptionalModuleUrlCodeName = (typeof OPTIONAL_MODULE_URL_CODE_NAMES)[number];

const OPTIONAL_MODULE_URL_CODES = Object.freeze(
  Object.fromEntries(
    OPTIONAL_MODULE_URL_CODE_NAMES.flatMap((module) => {
      const override = getModuleUrlCodeOverride(module);
      return override ? ([[module, override]] as const) : [];
    }),
  ) as Record<string, string>,
);

export const getModuleUrlCode = (module: string): string | undefined => {
  if (!module) {
    return undefined;
  }

  if (module in MODULE_URL_CODES) {
    return MODULE_URL_CODES[module as keyof typeof MODULE_URL_CODES];
  }

  if (module in OPTIONAL_MODULE_URL_CODES) {
    return OPTIONAL_MODULE_URL_CODES[module];
  }

  return undefined;
};

export const buildLegendLayoutUrl = (code: string): string =>
  `${ROBINHOOD_LEGEND_LAYOUT_BASE}/${code}${LEGEND_DEFAULT_QUERY}`;

const LEGEND_URL_TEMPLATE = `${ROBINHOOD_LEGEND_LAYOUT_BASE}/{urlCode}${LEGEND_DEFAULT_QUERY}` as const;
const OPTIONS_URL_TEMPLATE = 'https://robinhood.com/options/chains/{symbol}' as const;
const STOCK_PAGE_URL_TEMPLATE = 'https://robinhood.com/stocks/{symbol}' as const;
const FUTURES_OVERVIEW_URL =
  'https://robinhood.com/lists/robinhood/12442aa7-2280-4d5a-86e4-1ee5353f3892' as const;
const FUTURES_DETAIL_URL_TEMPLATE = 'https://robinhood.com/futures/{symbol}' as const;

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

const BASE_MODULES: readonly ModuleDefinition[] = [
  {
    name: 'spy-5m-1m',
    description: 'Gráficas Legend de SPY en 1D/1H/15m/5m/1m/1s',
    urlTemplate: LEGEND_URL_TEMPLATE,
    urlCode: MODULE_URL_CODES['spy-5m-1m'],
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
  {
    name: 'spy-options-chain',
    description: 'Cadena de opciones para SPY',
    urlTemplate: LEGEND_URL_TEMPLATE,
    urlCode: MODULE_URL_CODES['spy-options-chain'],
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
  {
    name: 'spx-options-chain',
    description: 'Cadena de opciones para SPX',
    urlTemplate: LEGEND_URL_TEMPLATE,
    urlCode: MODULE_URL_CODES['spx-options-chain'],
    requiresUrlCode: true,
    defaultSymbols: ['SPX'],
  },
  {
    name: 'options',
    description: 'Navegador genérico de opciones por símbolo',
    urlTemplate: OPTIONS_URL_TEMPLATE,
    url: 'https://robinhood.com/options/chains/SPY',
    defaultSymbols: ['SPY'],
  },
  {
    name: 'daily-stats',
    description: 'Estadísticas diarias para un símbolo específico',
    urlTemplate: STOCK_PAGE_URL_TEMPLATE,
    defaultSymbols: ['SPY'],
    requiresSymbols: true,
  },
  {
    name: 'daily-news',
    description: 'Noticias diarias para un símbolo específico',
    urlTemplate: STOCK_PAGE_URL_TEMPLATE,
    defaultSymbols: ['SPY'],
    requiresSymbols: true,
  },
  {
    name: 'daily-order-book',
    description: 'Order book diario para un símbolo específico',
    urlTemplate: STOCK_PAGE_URL_TEMPLATE,
    defaultSymbols: ['SPY'],
    requiresSymbols: true,
  },
  { 
    name: 'futures',
    description: 'Panel principal de mercados de futuros',
    url: `${FUTURES_OVERVIEW_URL}/`,
  },
  {
    name: 'futures-mes',
    description: 'Futuros Micro E-mini S&P 500 (MES)',
    urlTemplate: FUTURES_DETAIL_URL_TEMPLATE,
    defaultSymbols: ['MESZ25'],
    requiresSymbols: true,
  },
  {
    name: 'futures-mnq',
    description: 'Futuros Micro E-mini Nasdaq-100 (MNQ)',
    urlTemplate: FUTURES_DETAIL_URL_TEMPLATE,
    defaultSymbols: ['MNQZ25'],
    requiresSymbols: true,
  },
  {
    name: 'futures-overview',
    description: 'Panel general de futuros',
    url: `${FUTURES_OVERVIEW_URL}/`,
    defaultSymbols: ['MESZ25', 'MNQZ25'],
  },
  {
    name: 'futures-detail',
    description: 'Detalle de un contrato de futuros',
    urlTemplate: FUTURES_DETAIL_URL_TEMPLATE,
    defaultSymbols: ['MESZ25'],
    requiresSymbols: true,
  },
];

const OPTIONAL_LEGEND_MODULES: readonly (ModuleDefinition & {
  readonly name: OptionalModuleUrlCodeName;
})[] = [
  {
    name: 'stocks-generic-chart',
    description: 'Leyenda genérica de acciones (marcos configurables)',
    urlTemplate: LEGEND_URL_TEMPLATE,
    requiresUrlCode: true,
  },
  {
    name: 'options-generic',
    description: 'Cadena de opciones genérica (símbolo parametrizable)',
    urlTemplate: LEGEND_URL_TEMPLATE,
    requiresUrlCode: true,
  },
  {
    name: 'daily-stats',
    description: 'Estadísticas diarias de acciones',
    urlTemplate: LEGEND_URL_TEMPLATE,
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
  {
    name: 'daily-news',
    description: 'Noticias diarias de acciones',
    urlTemplate: LEGEND_URL_TEMPLATE,
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
  {
    name: 'daily-order-book',
    description: 'Libro de órdenes diario de acciones',
    urlTemplate: LEGEND_URL_TEMPLATE,
    requiresUrlCode: true,
    defaultSymbols: ['SPY'],
  },
];

const ENABLED_OPTIONAL_MODULES: readonly ModuleDefinition[] = OPTIONAL_LEGEND_MODULES.flatMap(
  (definition) => {
    const urlCode = OPTIONAL_MODULE_URL_CODES[definition.name];
    if (!urlCode) {
      return [];
    }

    return [
      {
        ...definition,
        urlCode,
      },
    ];
  },
);

export const MODULES: readonly ModuleDefinition[] = Object.freeze([
  ...BASE_MODULES,
  ...ENABLED_OPTIONAL_MODULES,
]);
