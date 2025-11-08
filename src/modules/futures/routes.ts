const FUTURES_BASE_URL = 'https://robinhood.com/us/en/markets/futures';

export type FuturesRouteDefinition = {
  readonly module: string;
  readonly slug: string;
  readonly symbol: string;
  readonly symbols: readonly string[];
  readonly url: string;
};

type FuturesRouteInput = {
  readonly module: string;
  readonly symbol: string;
  readonly slug?: string;
  readonly aliases?: readonly string[];
};

const normalizeSymbol = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Symbol cannot be empty');
  }
  return trimmed.toUpperCase();
};

const normalizeSlug = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Slug cannot be empty');
  }
  return trimmed.replace(/[^0-9A-Za-z_-]+/g, '-');
};

export function createFuturesRoute(input: FuturesRouteInput): FuturesRouteDefinition {
  const symbol = normalizeSymbol(input.symbol);
  const slug = normalizeSlug((input.slug ?? input.symbol).toUpperCase());
  const aliases = (input.aliases ?? []).map((item) => normalizeSymbol(item));
  const symbols = [symbol, ...aliases];
  const url = `${FUTURES_BASE_URL}/${slug}/`;

  return {
    module: input.module,
    slug,
    symbol,
    symbols,
    url,
  } satisfies FuturesRouteDefinition;
}

const FUTURES_ROUTE_DEFINITIONS: readonly FuturesRouteDefinition[] = [
  createFuturesRoute({ module: 'futures-mes', symbol: 'MES' }),
  createFuturesRoute({ module: 'futures-mnq', symbol: 'MNQ' }),
  createFuturesRoute({ module: 'futures-mym', symbol: 'MYM' }),
  createFuturesRoute({ module: 'futures-m2k', symbol: 'M2K' }),
  createFuturesRoute({ module: 'futures-mgc', symbol: 'MGC' }),
  createFuturesRoute({ module: 'futures-sil', symbol: 'SIL' }),
  createFuturesRoute({ module: 'futures-mcl', symbol: 'MCL' }),
];

export const FUTURES_ROUTES = FUTURES_ROUTE_DEFINITIONS;

export const FUTURES_URL_BY_MODULE: Record<string, string> = FUTURES_ROUTE_DEFINITIONS.reduce(
  (acc, route) => {
    acc[route.module] = route.url;
    return acc;
  },
  {} as Record<string, string>,
);

export const FUTURES_SYMBOLS_BY_MODULE: Record<string, readonly string[]> = FUTURES_ROUTE_DEFINITIONS.reduce(
  (acc, route) => {
    acc[route.module] = route.symbols;
    return acc;
  },
  {} as Record<string, readonly string[]>,
);

export const FUTURES_MODULE_NAMES: readonly string[] = FUTURES_ROUTE_DEFINITIONS.map((route) => route.module);

export function getFuturesRoute(module: string): FuturesRouteDefinition | undefined {
  return FUTURES_ROUTE_DEFINITIONS.find((route) => route.module === module);
}
