import fs from 'node:fs';
import path from 'node:path';

export type EtpDetails = {
  readonly instrument_id?: string;
  readonly instrument?: string;
  readonly symbol?: string;
  readonly name?: string;
  readonly description?: string;
  readonly expense_ratio?: number | string;
  readonly profile?: Record<string, unknown>;
  readonly performance?: readonly Record<string, unknown>[];
  readonly sectors?: readonly Record<string, unknown>[];
  readonly holdings?: readonly Record<string, unknown>[];
};

export type EtpSummary = {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name?: string;
  readonly top10Concentration: number;
  readonly techWeight: number;
  readonly sectorHHI: number;
  readonly concentrationFlag: 'low' | 'moderate' | 'high';
  readonly diversificationFlag: 'diversified' | 'concentrated';
};

export const DEFAULT_ETP_INSTRUMENT = '8f92e76f-1e0e-4478-8580-16a6ffcfaef5';

const weightFrom = (value: unknown): number => {
  if (typeof value === 'number') {
    return value * 100;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/%/g, '').trim();
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};

export const readToken = (): string => {
  const token = process.env.ROBINHOOD_TOKEN;
  if (!token) {
    throw new Error('ROBINHOOD_TOKEN es requerido');
  }
  return token.trim();
};

const normaliseInstrumentId = (value: string | undefined): string => {
  if (!value) {
    return '';
  }
  const cleaned = value.trim();
  if (!cleaned) {
    return '';
  }
  try {
    const parsed = new URL(cleaned);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts.pop();
    return last ?? cleaned;
  } catch {
    return cleaned;
  }
};

export async function fetchEtpDetails(instrumentId: string, token: string): Promise<EtpDetails> {
  const resolvedId = normaliseInstrumentId(instrumentId) || DEFAULT_ETP_INSTRUMENT;
  const url = `https://bonfire.robinhood.com/instruments/${resolvedId}/etp-details/`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fallo al solicitar etp-details: ${res.status} ${text}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return { ...json, instrument_id: resolvedId } as EtpDetails;
}

export async function resolveInstrumentId(symbol: string, token: string): Promise<string | null> {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return null;
  }
  const url = `https://api.robinhood.com/instruments/?symbol=${encodeURIComponent(trimmed.toUpperCase())}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { results?: Array<{ id?: string }>; };
  return data.results?.[0]?.id ?? null;
}

const writeFile = (filePath: string, content: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

export const writeCsv = (filePath: string, header: readonly string[], rows: Array<Array<string | number | null>>): void => {
  const lines = [header.join(',')];
  for (const row of rows) {
    const line = row
      .map((value) => {
        if (value === null || value === undefined) {
          return '';
        }
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(',');
    lines.push(line);
  }
  writeFile(filePath, `${lines.join('\n')}\n`);
};

export const writeJson = (filePath: string, data: unknown): void => {
  writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
};

export const toProfileRows = (details: EtpDetails): Array<Array<string | number | null>> => {
  const profile = details.profile ?? {};
  const expenseRatio = (details.expense_ratio ?? (profile as Record<string, unknown>).expense_ratio) as
    | number
    | string
    | undefined;
  return [
    [
      details.symbol ?? '',
      details.name ?? '',
      (profile as Record<string, unknown>).issuer ?? null,
      expenseRatio ?? null,
      (profile as Record<string, unknown>).net_assets ?? null,
      (profile as Record<string, unknown>).inception_date ?? null,
      (profile as Record<string, unknown>).category ?? null,
    ],
  ];
};

export const toPerformanceRows = (details: EtpDetails): Array<Array<string | number | null>> => {
  const rows: Array<Array<string | number | null>> = [];
  for (const entry of details.performance ?? []) {
    const record = entry as Record<string, unknown>;
    rows.push([
      record.period ?? record.label ?? null,
      record.nav_return ?? record.nav ?? record.total_return ?? null,
      record.market_return ?? record.market ?? null,
    ]);
  }
  return rows;
};

export const toSectorRows = (details: EtpDetails): Array<Array<string | number | null>> => {
  const rows: Array<Array<string | number | null>> = [];
  for (const entry of details.sectors ?? []) {
    const record = entry as Record<string, unknown>;
    rows.push([record.sector ?? record.name ?? null, record.weight ?? record.percentage ?? null]);
  }
  return rows;
};

export const toHoldingRows = (details: EtpDetails): Array<Array<string | number | null>> => {
  const rows: Array<Array<string | number | null>> = [];
  for (const entry of details.holdings ?? []) {
    const record = entry as Record<string, unknown>;
    rows.push([
      record.rank ?? record.position ?? rows.length + 1,
      record.ticker ?? record.symbol ?? null,
      record.name ?? record.company ?? null,
      record.weight ?? record.percentage ?? null,
      record.asset_class ?? record.assetClass ?? null,
      record.sector ?? null,
    ]);
  }
  return rows;
};

export const buildEtpSummary = (details: EtpDetails): EtpSummary => {
  const holdings = [...(details.holdings ?? [])];
  holdings.sort((a, b) => weightFrom((b as Record<string, unknown>).weight) - weightFrom((a as Record<string, unknown>).weight));

  const top10Weight = holdings.slice(0, 10).reduce((acc, item) => acc + weightFrom((item as Record<string, unknown>).weight), 0);
  const techWeight = holdings
    .filter((item) => {
      const sector = ((item as Record<string, unknown>).sector ?? '') as string;
      return sector.toLowerCase().includes('tech');
    })
    .reduce((acc, item) => acc + weightFrom((item as Record<string, unknown>).weight), 0);

  const sectorWeights = new Map<string, number>();
  for (const entry of details.sectors ?? []) {
    const record = entry as Record<string, unknown>;
    const sector = String(record.sector ?? record.name ?? 'other');
    const weight = weightFrom(record.weight ?? record.percentage);
    sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + weight);
  }

  let hhi = 0;
  for (const weight of sectorWeights.values()) {
    const fraction = weight / 100;
    hhi += fraction * fraction;
  }

  const concentrationFlag = top10Weight >= 50 ? 'high' : top10Weight >= 35 ? 'moderate' : 'low';
  const diversificationFlag = hhi >= 0.18 || top10Weight >= 35 ? 'concentrated' : 'diversified';

  return {
    instrumentId: normaliseInstrumentId(details.instrument_id ?? details.instrument),
    symbol: details.symbol ?? 'ETF',
    name: details.name,
    top10Concentration: Number(top10Weight.toFixed(2)),
    techWeight: Number(techWeight.toFixed(2)),
    sectorHHI: Number(hhi.toFixed(4)),
    concentrationFlag,
    diversificationFlag,
  };
};

export const persistEtpArtifacts = (
  details: EtpDetails,
  outDir: string,
): { summary: EtpSummary; files: Record<string, string> } => {
  fs.mkdirSync(outDir, { recursive: true });
  const profilePath = path.join(outDir, 'etp_profile.csv');
  const performancePath = path.join(outDir, 'etp_performance.csv');
  const sectorsPath = path.join(outDir, 'etp_sectors.csv');
  const holdingsPath = path.join(outDir, 'etp_holdings.csv');
  const summaryPath = path.join(outDir, 'etp_summary.json');

  writeCsv(profilePath, ['symbol', 'name', 'issuer', 'expense_ratio', 'net_assets', 'inception_date', 'category'], toProfileRows(details));
  writeCsv(performancePath, ['period', 'nav_return', 'market_return'], toPerformanceRows(details));
  writeCsv(sectorsPath, ['sector', 'weight'], toSectorRows(details));
  writeCsv(holdingsPath, ['rank', 'ticker', 'name', 'weight', 'asset_class', 'sector'], toHoldingRows(details));

  const summary = buildEtpSummary(details);
  writeJson(summaryPath, summary);

  return {
    summary,
    files: {
      profilePath,
      performancePath,
      sectorsPath,
      holdingsPath,
      summaryPath,
    },
  };
};

export const parseList = (value: string | undefined): string[] =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0) ?? [];

export const deleteIfExists = (target: string): void => {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
};

