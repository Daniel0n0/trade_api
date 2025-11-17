#!/usr/bin/env ts-node
import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import {
  EtpSummary,
  deleteIfExists,
  DEFAULT_ETP_INSTRUMENT,
  fetchEtpDetails,
  parseList,
  persistEtpArtifacts,
  readToken,
  resolveInstrumentId,
} from './etp_shared.js';

type BatchTarget = { symbol: string; instrumentId: string };

type RankingEntry = EtpSummary & { readonly expenseRatio?: number; readonly momentum?: number; readonly score: number };

const program = new Command();

program
  .option('--symbols <list>', 'Lista de símbolos separados por coma')
  .option('--instruments <list>', 'Lista de instrument_id separados por coma')
  .option('--out <dir>', 'Directorio raíz de salida', 'out')
  .option('--overwrite', 'Sobrescribe salidas anteriores', false);

const pickMomentum = (details: Record<string, unknown> | undefined): number | undefined => {
  if (!details) {
    return undefined;
  }
  const performance = Array.isArray(details.performance) ? (details.performance as Record<string, unknown>[]) : [];
  const scores: number[] = [];
  for (const entry of performance) {
    const value = Number(entry.nav_return ?? entry.total_return ?? entry.market_return);
    if (Number.isFinite(value)) {
      scores.push(value);
    }
  }
  if (!scores.length) {
    return undefined;
  }
  const avg = scores.reduce((acc, value) => acc + value, 0) / scores.length;
  return Number(avg.toFixed(3));
};

const pickExpenseRatio = (details: Record<string, unknown> | undefined): number | undefined => {
  const ratio = details?.expense_ratio ?? (details?.profile as Record<string, unknown> | undefined)?.expense_ratio;
  const parsed = typeof ratio === 'string' ? Number.parseFloat(ratio.replace(/%/g, '')) : (ratio as number | undefined);
  return Number.isFinite(parsed) ? (parsed as number) : undefined;
};

const computeScore = (entry: RankingEntry): number => {
  const momentumScore = entry.momentum ?? 0;
  const diversificationScore = 100 * (1 - Math.min(entry.sectorHHI, 0.5));
  const costScore = 100 - Math.min(entry.expenseRatio ?? 0, 1.5) * 100;
  const riskPenalty = entry.concentrationFlag === 'high' ? 15 : entry.concentrationFlag === 'moderate' ? 7 : 0;

  const score = momentumScore * 0.55 + diversificationScore * 0.25 + costScore * 0.2 - riskPenalty;
  return Number(score.toFixed(2));
};

const formatOrdenDelMomento = (entries: RankingEntry[]): { csv: string; md: string } => {
  const header = ['rank', 'symbol', 'score', 'momentum', 'expense_ratio', 'top10_pct', 'tech_pct', 'hhi'];
  const csvLines = [header.join(',')];
  const mdLines = ['# ORDEN DEL MOMENTO', '', '| # | ETF | Score | Momentum | ER | Top-10 | Tech | HHI |', '|---|-----|-------|----------|----|--------|------|-----|'];

  entries.forEach((entry, idx) => {
    const row = [
      String(idx + 1),
      entry.symbol,
      entry.score,
      entry.momentum ?? '',
      entry.expenseRatio ?? '',
      entry.top10Concentration,
      entry.techWeight,
      entry.sectorHHI,
    ];
    csvLines.push(row.join(','));
    mdLines.push(
      `| ${idx + 1} | ${entry.symbol} | ${entry.score} | ${entry.momentum ?? ''} | ${entry.expenseRatio ?? ''} | ${entry.top10Concentration}% | ${entry.techWeight}% | ${entry.sectorHHI.toFixed(4)} |`,
    );
  });

  return { csv: `${csvLines.join('\n')}\n`, md: `${mdLines.join('\n')}\n` };
};

const persistOrdenDelMomento = (root: string, entries: RankingEntry[]): void => {
  const orden = formatOrdenDelMomento(entries);
  const base = path.join(root, 'orden_del_momento');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(`${base}.csv`, orden.csv, 'utf8');
  fs.writeFileSync(`${base}.md`, orden.md, 'utf8');
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      entries.map(({ score, ...rest }) => ({ ...rest, score })),
      null,
      2,
    ),
    'utf8',
  );
};

const buildTargets = async (token: string): Promise<BatchTarget[]> => {
  const opts = program.opts<{ symbols?: string; instruments?: string }>();
  const symbols = parseList(opts.symbols);
  const instruments = parseList(opts.instruments);

  const targets: BatchTarget[] = [];
  for (const instrumentId of instruments) {
    targets.push({ symbol: instrumentId, instrumentId });
  }

  for (const symbol of symbols) {
    const instrumentId = await resolveInstrumentId(symbol, token);
    if (!instrumentId) {
      // eslint-disable-next-line no-console
      console.warn(`[etp-batch] No pude resolver instrument_id para ${symbol}`);
      continue;
    }
    targets.push({ symbol: symbol.toUpperCase(), instrumentId });
  }

  if (!targets.length) {
    const fallbackId = process.env.INSTRUMENT_ID ?? DEFAULT_ETP_INSTRUMENT;
    targets.push({ symbol: 'SPY', instrumentId: fallbackId });
  }

  return targets;
};

const main = async () => {
  const token = readToken();
  program.parse(process.argv);
  const opts = program.opts<{ out: string; overwrite?: boolean }>();
  const outRoot = path.resolve(process.cwd(), opts.out ?? 'out');

  const targets = await buildTargets(token);
  const ranking: RankingEntry[] = [];

  for (const target of targets) {
    const symbolDir = path.join(outRoot, target.symbol);
    if (opts.overwrite) {
      deleteIfExists(symbolDir);
    }

    const details = await fetchEtpDetails(target.instrumentId, token);
    details.symbol = details.symbol ?? target.symbol;
    const { summary } = persistEtpArtifacts(details, symbolDir);

    const momentum = pickMomentum(details as Record<string, unknown>);
    const expenseRatio = pickExpenseRatio(details as Record<string, unknown>);
    const scoreEntry: RankingEntry = { ...summary, momentum, expenseRatio, score: 0 };
    scoreEntry.score = computeScore(scoreEntry);
    ranking.push(scoreEntry);
  }

  ranking.sort((a, b) => b.score - a.score);
  persistOrdenDelMomento(outRoot, ranking);

  // eslint-disable-next-line no-console
  console.info('[etp-batch] completado', { objetivos: targets.length, outRoot });
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[etp-batch] Error', error);
  process.exitCode = 1;
});
