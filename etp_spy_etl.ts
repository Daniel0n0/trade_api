#!/usr/bin/env ts-node
import path from 'node:path';

import {
  DEFAULT_ETP_INSTRUMENT,
  fetchEtpDetails,
  parseList,
  persistEtpArtifacts,
  readToken,
} from './etp_shared.js';

const run = async () => {
  const token = readToken();
  const instrumentId = process.env.INSTRUMENT_ID ?? DEFAULT_ETP_INSTRUMENT;
  const outDir = path.resolve(process.cwd(), process.env.OUT_DIR ?? 'out');

  const details = await fetchEtpDetails(instrumentId, token);
  const { summary, files } = persistEtpArtifacts(details, outDir);

  const signalFlags = parseList(process.env.EXTRA_FLAGS).join(', ');
  // eslint-disable-next-line no-console
  console.info('[etp-spy-etl] artefactos listos:', { ...files, summary, signalFlags });
};

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[etp-spy-etl] Error', error);
  process.exitCode = 1;
});
