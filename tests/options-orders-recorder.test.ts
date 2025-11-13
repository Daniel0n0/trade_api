import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { __test__ } from '../src/modules/options/orders-recorder.js';

const { persistOrdersPayload } = __test__;

test('persistOrdersPayload replaces existing orders when run twice', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trade-api-orders-recorder-'));
  const previousCwd = process.cwd();
  process.chdir(workspace);

  try {
    const logs: unknown[] = [];
    const writeGeneral = (entry: unknown) => {
      logs.push(entry);
    };

    const orderId = 'order-123';
    const baseOrder = {
      id: orderId,
      account_number: '1234',
      created_at: '2024-07-15T12:00:00Z',
      chain_symbol: 'TSLA',
      state: 'queued',
      legs: [
        {
          id: 'leg-1',
          position_effect: 'open',
          side: 'buy',
          ratio_quantity: 1,
          executions: [
            { id: 'exec-1', timestamp: '2024-07-15T12:05:00Z', price: '0.50', quantity: '1' },
          ],
        },
      ],
    };

    await persistOrdersPayload({ results: [baseOrder] }, writeGeneral);
    await persistOrdersPayload({ results: [{ ...baseOrder, state: 'filled' }] }, writeGeneral);

    const ordersFile = path.join(
      workspace,
      'data',
      'stocks',
      'TSLA',
      '2024-07-15',
      'options',
      'orders.jsonl',
    );
    const ordersLines = readFileSync(ordersFile, 'utf-8')
      .trim()
      .split('\n');
    assert.equal(ordersLines.length, 1, 'Debe existir un único registro por order_id');
    const storedOrder = JSON.parse(ordersLines[0]);
    assert.equal(storedOrder.state, 'filled', 'La segunda ejecución debe reemplazar la entrada previa');

    const actionLogs = logs.filter(
      (entry) => typeof entry === 'object' && entry !== null && (entry as { kind?: string }).kind === 'options-orders-order-write',
    );
    const actions = actionLogs.map((entry) => (entry as { action?: string }).action);
    assert.deepEqual(actions, ['insert', 'update'], 'Los logs deben reflejar insert y update para el mismo order_id');
  } finally {
    process.chdir(previousCwd);
  }
});
