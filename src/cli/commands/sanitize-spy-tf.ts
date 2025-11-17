import type { Command } from 'commander';

import {
  fetchHttpClient,
  sanitizeSpyTf,
  type Timeframe,
  SPY_TF_ENDPOINTS,
} from '../../modules/spy/sanitize-timeframes.js';
import type { CommandContext } from './shared.js';

type SanitizeOptions = { since?: string; tfs?: string };

const ALL_TIMEFRAMES: readonly Timeframe[] = ['5m', '15m', '1h'];

const parseTimeframes = (raw?: string): Timeframe[] => {
  if (!raw) {
    return [...ALL_TIMEFRAMES];
  }

  const parts = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(parts)) as Timeframe[];
  const invalid = unique.filter((value) => !ALL_TIMEFRAMES.includes(value));
  if (invalid.length > 0) {
    throw new Error(`Temporalidades inválidas: ${invalid.join(', ')}`);
  }

  return unique.length > 0 ? unique : [...ALL_TIMEFRAMES];
};

export function registerSanitizeSpyTfCommand(program: Command, _context: CommandContext): Command {
  return program
    .command('sanitize-spy-tf')
    .description('Sanea y actualiza velas de SPY por temporalidad (5m, 15m, 1h).')
    .option('--since <fecha>', 'YYYY-MM-DD; descarta velas anteriores.')
    .option('--tfs <lista>', 'Temporalidades separadas por coma (5m,15m,1h).')
    .action(async (options: SanitizeOptions) => {
      const timeframes = parseTimeframes(options.tfs);
      await sanitizeSpyTf({
        client: fetchHttpClient,
        tfs: timeframes,
        since: options.since,
      });

      console.log(
        `Saneamiento completado para: ${timeframes.join(', ')}. Actualiza SPY con fuentes ${Object.values(SPY_TF_ENDPOINTS).join(
          ', ',
        )}.`,
      );
    });
}
