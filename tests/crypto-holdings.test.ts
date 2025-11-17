import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  normalizeCryptoHoldings,
  persistCryptoHoldingsSnapshot,
  HOLDINGS_CURRENT_HEADER,
} from '../src/modules/portfolio/crypto-holdings.js';

test('normalizeCryptoHoldings aggregates cost basis rows per account', () => {
  const envelope = {
    ts: Date.parse('2024-07-16T02:00:00Z'),
    source: 'https://nummus.robinhood.com/holdings/',
    payload: {
      next: null,
      previous: null,
      results: [
        {
          id: 'holding-1',
          account_id: 'crypto-account 01',
          currency_pair_id: 'BTCUSD',
          created_at: '2024-07-01T00:00:00Z',
          updated_at: '2024-07-16T01:00:00Z',
          quantity: '1.5',
          quantity_available: '1.25',
          quantity_held: '0.25',
          quantity_held_for_buy: '0.1',
          quantity_held_for_sell: '0.05',
          quantity_staked: '0.2',
          quantity_transferable: '1.3',
          currency: {
            id: 'BTC',
            code: 'BTC',
            name: 'Bitcoin',
            increment: '0.00000001',
            display_only: false,
          },
          cost_bases: [
            {
              id: 'cb-1',
              currency_id: 'USD',
              direct_cost_basis: '10000',
              direct_quantity: '1',
              direct_reward_cost_basis: '0',
              direct_reward_quantity: '0.1',
              direct_transfer_cost_basis: '0',
              direct_transfer_quantity: '0.05',
              intraday_cost_basis: '50',
              intraday_quantity: '0.01',
              marked_cost_basis: '0',
              marked_quantity: '0',
            },
            {
              id: 'cb-2',
              currency_id: 'USD',
              direct_cost_basis: '5000',
              direct_quantity: '0.5',
              direct_reward_cost_basis: '10',
              direct_reward_quantity: '0.05',
              direct_transfer_cost_basis: '0',
              direct_transfer_quantity: '0',
              intraday_cost_basis: '0',
              intraday_quantity: '0',
              marked_cost_basis: '0',
              marked_quantity: '0',
            },
          ],
          tax_lot_cost_bases: [
            {
              id: 'lot-1',
              clearing_book_cost_basis: '10000',
              clearing_running_quantity: '1.25',
              clearing_running_quantity_without_cost_basis: '0.15',
              intraday_cost_basis: '50',
              intraday_quantity: '0.01',
              intraday_quantity_without_cost_basis: '0.005',
            },
          ],
        },
        {
          id: 'holding-2',
          account_id: 'secondary',
          currency_pair_id: 'ETHUSD',
          created_at: '2024-07-02T00:00:00Z',
          updated_at: '2024-07-16T01:00:00Z',
          quantity: '0',
          quantity_available: '0',
          quantity_held: '0',
          quantity_held_for_buy: '0',
          quantity_held_for_sell: '0',
          quantity_staked: '0',
          quantity_transferable: '0',
          currency: {
            id: 'ETH',
            code: 'ETH',
            name: 'Ethereum',
            increment: '0.001',
            display_only: true,
          },
          cost_bases: [],
          tax_lot_cost_bases: [],
        },
        {
          id: 'missing-account',
          currency_pair_id: 'DOGEUSD',
          quantity: '1',
          currency: { id: 'DOGE', code: 'DOGE' },
        },
      ],
    },
  } as const;

  const snapshots = normalizeCryptoHoldings(envelope);
  assert.equal(snapshots.length, 2);

  const primary = snapshots.find((snapshot) => snapshot.accountId === 'crypto-account 01');
  const secondary = snapshots.find((snapshot) => snapshot.accountId === 'secondary');
  assert.ok(primary);
  assert.ok(secondary);

  assert.equal(primary.currentRows.length, 1);
  assert.equal(primary.costBasisRows.length, 2);
  assert.equal(primary.taxLotRows.length, 1);
  assert.equal(primary.currentRows[0]?.precision, 8);
  assert.equal(primary.currentRows[0]?.cb_direct_qty, '1.5');
  assert.equal(primary.currentRows[0]?.cb_reward_qty, '0.15');
  assert.equal(primary.currentRows[0]?.cb_intraday_cost, '50');
  assert.equal(primary.currentRows[0]?.has_position, 1);
  assert.equal(primary.currentRows[0]?.lots_count, 1);

  assert.equal(secondary?.currentRows[0]?.is_display_only, 1);
  assert.equal(secondary?.currentRows[0]?.has_position, 0);
});

test('persistCryptoHoldingsSnapshot writes raw and csv files under base directory', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-crypto-'));
  const envelope = {
    ts: Date.parse('2024-07-16T02:00:00Z'),
    payload: {
      results: [
        {
          id: 'holding-1',
          account_id: 'crypto-account 01',
          currency_pair_id: 'BTCUSD',
          created_at: '2024-07-01T00:00:00Z',
          updated_at: '2024-07-16T01:00:00Z',
          quantity: '1.5',
          quantity_available: '1.25',
          quantity_held: '0.25',
          quantity_held_for_buy: '0.1',
          quantity_held_for_sell: '0.05',
          quantity_staked: '0.2',
          quantity_transferable: '1.3',
          currency: {
            id: 'BTC',
            code: 'BTC',
            name: 'Bitcoin',
            increment: '0.00000001',
            display_only: false,
          },
          cost_bases: [
            {
              id: 'cb-1',
              currency_id: 'USD',
              direct_cost_basis: '10000',
              direct_quantity: '1',
              direct_reward_cost_basis: '0',
              direct_reward_quantity: '0.1',
              direct_transfer_cost_basis: '0',
              direct_transfer_quantity: '0.05',
              intraday_cost_basis: '50',
              intraday_quantity: '0.01',
              marked_cost_basis: '0',
              marked_quantity: '0',
            },
          ],
          tax_lot_cost_bases: [],
        },
      ],
    },
  } as const;

  const [snapshot] = normalizeCryptoHoldings(envelope);
  assert.ok(snapshot);

  const result = await persistCryptoHoldingsSnapshot(snapshot, { baseDir: workspace });
  assert.ok(path.isAbsolute(result.rawPath));
  assert.ok(path.isAbsolute(result.currentDailyPath));
  assert.ok(path.isAbsolute(result.currentRollingPath));

  const rawPayload = JSON.parse(readFileSync(result.rawPath, 'utf-8'));
  assert.equal(rawPayload.account_id, 'crypto-account 01');
  assert.equal(rawPayload.count, 1);

  const currentContent = readFileSync(result.currentDailyPath, 'utf-8')
    .trim()
    .split('\n');
  assert.equal(currentContent[0], HOLDINGS_CURRENT_HEADER.join(','));
  assert.equal(currentContent.length, 2);

  const rollingContent = readFileSync(result.currentRollingPath, 'utf-8')
    .trim()
    .split('\n');
  assert.equal(rollingContent[0], HOLDINGS_CURRENT_HEADER.join(','));
  assert.equal(rollingContent.length, 2);
});
