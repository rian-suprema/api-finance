import { readFileSync } from 'fs';
import path from 'path';

import { emptyTotals } from './totals.util';
import { filterFlow, matchFlow, sumCore } from './matcher';
import { settleRefunds } from './refund-settlement';
import type { Movement, ReconciliationFlow } from './reconciliation.types';
import { roundCurrency } from '../../../common/utils/number.util';

const FIXTURE_PATH = path.join(process.cwd(), 'test', 'fixtures', 'reconciliation-maxima-2026-08-15.json');

interface Fixture {
  platform: Movement[];
  bank: Movement[];
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
const settled = settleRefunds(fixture.platform, fixture.bank);

function pendingSum(movements: Movement[], side: 'PLATFORM' | 'BANK'): number {
  return roundCurrency(
    movements.filter((movement) => movement.side === side).reduce((sum, movement) => sum + movement.amountCents, 0) /
      100,
  );
}

describe('totals.util — emptyTotals e invariante do fechamento', () => {
  it('emptyTotals() devolve os 8 totais zerados', () => {
    expect(emptyTotals()).toEqual({
      platformDeposits: { total: 0, count: 0 },
      bankDeposits: { total: 0, count: 0 },
      platformWithdrawals: { total: 0, count: 0 },
      bankWithdrawals: { total: 0, count: 0 },
      treasury: { total: 0, count: 0 },
      fees: { total: 0, count: 0 },
      depositsCrossover: { total: 0, count: 0 },
      withdrawalsCrossover: { total: 0, count: 0 },
    });
  });

  it.each<ReconciliationFlow>(['DEPOSIT', 'WITHDRAWAL'])(
    'invariante — diferença (banco − plataforma) = crossover + pendências (%s)',
    (flow) => {
      const platform = filterFlow(settled.platform, flow);
      const bank = filterFlow(settled.bank, flow);
      const match = matchFlow(flow, platform, bank);

      const bankTotal = sumCore(bank).total;
      const platformTotal = sumCore(platform).total;
      const difference = roundCurrency(bankTotal - platformTotal);

      const pendingBank = pendingSum(match.pending, 'BANK');
      const pendingPlatform = pendingSum(match.pending, 'PLATFORM');
      const invariant = roundCurrency(match.crossEdge.total + pendingBank - pendingPlatform);

      expect(difference).toBe(invariant);
    },
  );
});
