#!/usr/bin/env ts-node
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

import { parseList, readToken, resolveInstrumentId } from './etp_shared.js';

type DoraItem = {
  readonly uuid?: string;
  readonly title?: string;
  readonly url?: string;
  readonly source?: string;
  readonly published_at?: string;
  readonly impact_score?: number;
  readonly preview_text?: string;
};

type NewsScore = DoraItem & { readonly symbol: string; readonly score: number; readonly ageMinutes: number };

const program = new Command();
program
  .option('--symbols <list>', 'Símbolos separados por coma', 'SPY')
  .option('--out <dir>', 'Directorio raíz de salida', 'out')
  .option('--limit <n>', 'Límite de artículos por símbolo', (value) => Number(value), 50);

const fetchNews = async (instrumentId: string, token: string): Promise<DoraItem[]> => {
  const url = `https://dora.robinhood.com/feed/instrument/${instrumentId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`No pude leer el feed de noticias: ${res.status}`);
  }
  const data = (await res.json()) as { results?: DoraItem[] };
  return data.results ?? [];
};

const scoreItem = (item: DoraItem, now: Date): { score: number; ageMinutes: number } => {
  const published = item.published_at ? new Date(item.published_at) : null;
  const ageMinutes = published ? (now.getTime() - published.getTime()) / 60000 : Number.POSITIVE_INFINITY;
  const recencyScore = published ? Math.max(0, 100 - ageMinutes / 10) : 0;
  const impactScore = Number.isFinite(item.impact_score) ? Number(item.impact_score) * 10 : 10;
  const sourceBoost = item.source && /bloomberg|reuters|wsj|ft|cnbc/i.test(item.source) ? 15 : 0;
  const score = recencyScore * 0.6 + impactScore * 0.3 + sourceBoost;
  return { score: Number(score.toFixed(2)), ageMinutes: Number.isFinite(ageMinutes) ? Number(ageMinutes.toFixed(2)) : 9999 };
};

const writeNewsArtifacts = (symbol: string, outDir: string, items: NewsScore[]): void => {
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'news.csv');
  const jsonPath = path.join(outDir, 'news.json');
  const mdPath = path.join(outDir, 'orden_noticias.md');
  const signalPath = path.join(outDir, 'news_signal.json');

  const header = ['uuid', 'title', 'source', 'published_at', 'age_minutes', 'score', 'url'];
  const csvLines = [header.join(',')];
  for (const item of items) {
    const row = [
      item.uuid ?? '',
      item.title ?? '',
      item.source ?? '',
      item.published_at ?? '',
      item.ageMinutes,
      item.score,
      item.url ?? '',
    ];
    csvLines.push(row.map((value) => (typeof value === 'string' && /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : String(value))).join(','));
  }
  fs.writeFileSync(csvPath, `${csvLines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), 'utf8');

  const lines = ['# orden_noticias', '', '| # | Título | Fuente | Edad (min) | Score |', '|---|--------|--------|-----------|-------|'];
  items.forEach((item, idx) => {
    const title = item.title ?? '(sin título)';
    lines.push(`| ${idx + 1} | ${title} | ${item.source ?? ''} | ${item.ageMinutes} | ${item.score} |`);
  });
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');

  const maxScore = Math.max(...items.map((item) => item.score), 0);
  fs.writeFileSync(signalPath, JSON.stringify({ symbol, maxScore }, null, 2));
};

const buildNews = async (symbol: string, token: string, limit: number): Promise<NewsScore[]> => {
  const instrumentId = await resolveInstrumentId(symbol, token);
  if (!instrumentId) {
    throw new Error(`No pude resolver instrument_id para ${symbol}`);
  }
  const rawItems = await fetchNews(instrumentId, token);
  const now = new Date();
  const scored = rawItems
    .slice(0, limit)
    .map((item) => {
      const { score, ageMinutes } = scoreItem(item, now);
      return { ...item, symbol, score, ageMinutes };
    })
    .sort((a, b) => b.score - a.score);
  return scored;
};

const main = async () => {
  const token = readToken();
  program.parse(process.argv);
  const opts = program.opts<{ symbols: string; out: string; limit: number }>();
  const symbols = parseList(opts.symbols);
  const outRoot = path.resolve(process.cwd(), opts.out ?? 'out');

  for (const symbol of symbols) {
    const items = await buildNews(symbol, token, opts.limit ?? 50);
    const outDir = path.join(outRoot, symbol.toUpperCase());
    writeNewsArtifacts(symbol, outDir, items);
  }

  // eslint-disable-next-line no-console
  console.info('[news-fetch] completado', { symbols });
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[news-fetch] Error', error);
  process.exitCode = 1;
});
