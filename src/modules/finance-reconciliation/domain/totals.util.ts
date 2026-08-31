import type { RunTotals } from './reconciliation.types';

/** Totais zerados — usado por marca sem execução e por execução que falhou. */
export function emptyTotals(): RunTotals {
  const zero = () => ({ total: 0, count: 0 });

  return {
    platformDeposits: zero(),
    bankDeposits: zero(),
    platformWithdrawals: zero(),
    bankWithdrawals: zero(),
    treasury: zero(),
    fees: zero(),
    depositsCrossover: zero(),
    withdrawalsCrossover: zero(),
  };
}
