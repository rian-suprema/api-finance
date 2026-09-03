import { readFileSync } from 'fs';
import path from 'path';

import { settleRefunds } from './refund-settlement';
import type { Movement } from './reconciliation.types';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'test',
  'fixtures',
  'reconciliation-maxima-2026-08-15.json',
);

interface Fixture {
  platform: Movement[];
  bank: Movement[];
  expected: {
    refundSettlement: {
      settledCount: number;
      settledTotal: number;
      remainingPlatformCount: number;
      remainingBankCount: number;
      reprocessPending: Record<string, boolean>;
    };
  };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture;

describe('refund-settlement — liquidação de estorno', () => {
  const result = settleRefunds(fixture.platform, fixture.bank);

  it('estorno liquida as 3 linhas da chave (saque da plataforma + débito do banco + crédito do estorno)', () => {
    expect(result.platform.some((movement) => movement.externalKey === 'EK-REFUND-1')).toBe(false);
    expect(result.bank.some((movement) => movement.externalKey === 'EK-REFUND-1')).toBe(false);

    expect(result.settled).toHaveLength(fixture.expected.refundSettlement.settledCount);
    expect(result.platform).toHaveLength(fixture.expected.refundSettlement.remainingPlatformCount);
    expect(result.bank).toHaveLength(fixture.expected.refundSettlement.remainingBankCount);
    expect(result.totals.total).toBe(fixture.expected.refundSettlement.settledTotal);

    const settledRefund1 = result.settled.find(
      (item) => item.movement.externalKey === 'EK-REFUND-1',
    );
    expect(settledRefund1?.note).toContain('EK-REFUND-1');
    expect(settledRefund1?.note).toContain('R$ 1.000,00');
  });

  it('estorno sem externalKey não liquida nada — segue para o casamento como lançamento sem chave', () => {
    expect(result.settled.some((item) => item.movement.key === 'b-refund-nokey')).toBe(false);
    expect(result.bank.some((movement) => movement.key === 'b-refund-nokey')).toBe(true);
  });

  it('platformReprocessPending = true quando o lançamento da plataforma ainda está presente', () => {
    const settledRefund1 = result.settled.find(
      (item) => item.movement.externalKey === 'EK-REFUND-1',
    );
    expect(settledRefund1?.platformReprocessPending).toBe(
      fixture.expected.refundSettlement.reprocessPending['EK-REFUND-1'],
    );
  });

  it('platformReprocessPending = false quando o lançamento da plataforma não está presente (já revertido)', () => {
    const settledRefund2 = result.settled.find(
      (item) => item.movement.externalKey === 'EK-REFUND-2',
    );
    expect(settledRefund2?.platformReprocessPending).toBe(
      fixture.expected.refundSettlement.reprocessPending['EK-REFUND-2'],
    );
  });
});
