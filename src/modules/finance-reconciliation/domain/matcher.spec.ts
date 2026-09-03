import { readFileSync } from 'fs';
import path from 'path';

import { filterFlow, matchFlow, sumCore } from './matcher';
import { settleRefunds } from './refund-settlement';
import type { Movement } from './reconciliation.types';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'test',
  'fixtures',
  'reconciliation-maxima-2026-08-15.json',
);

interface FlowExpectation {
  matchedCount: number;
  crossEdge: { count: number; total: number };
  duplicateKeys: number;
  withoutKey: number;
  pendingKeys: string[];
  bankTotal: number;
  bankCount: number;
  platformTotal: number;
  platformCount: number;
}

interface Fixture {
  platform: Movement[];
  bank: Movement[];
  expected: {
    deposits: FlowExpectation;
    withdrawals: FlowExpectation;
    treasury: { total: number; count: number };
  };
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture;

/**
 * O casamento roda sobre as listas já sem os estornos liquidados — é o que a
 * pipeline real faz (`settleRefunds` antes de `matchFlow`).
 */
const settled = settleRefunds(fixture.platform, fixture.bank);

describe('matcher — casamento 1:1 por externalKey', () => {
  it('casa depósito e saque com a mesma externalKey nos dois lados, sem sobra em pending', () => {
    const platform = filterFlow(settled.platform, 'DEPOSIT');
    const bank = filterFlow(settled.bank, 'DEPOSIT');
    const match = matchFlow('DEPOSIT', platform, bank);

    expect(match.pending.some((movement) => movement.key === 'p-dep-happy')).toBe(false);
    expect(match.pending.some((movement) => movement.key === 'b-dep-happy')).toBe(false);

    const withdrawalPlatform = filterFlow(settled.platform, 'WITHDRAWAL');
    const withdrawalBank = filterFlow(settled.bank, 'WITHDRAWAL');
    const withdrawalMatch = matchFlow('WITHDRAWAL', withdrawalPlatform, withdrawalBank);

    expect(withdrawalMatch.pending.some((movement) => movement.key === 'p-wd-happy')).toBe(false);
    expect(withdrawalMatch.pending.some((movement) => movement.key === 'b-wd-happy')).toBe(false);
  });

  it('lançamento sem externalKey vira pendência direto, nunca casa por valor ou instante', () => {
    const platform = filterFlow(settled.platform, 'WITHDRAWAL');
    const bank = filterFlow(settled.bank, 'WITHDRAWAL');
    const match = matchFlow('WITHDRAWAL', platform, bank);

    const nokey = match.pending.find((movement) => movement.key === 'b-wd-nokey');
    expect(nokey).toBeDefined();
    expect(nokey?.externalKey).toBeUndefined();
    expect(match.withoutKey).toBe(fixture.expected.withdrawals.withoutKey);
  });

  it('chave repetida do mesmo lado conta duplicateKeys e casa os pares por ordem (core primeiro)', () => {
    const platform = filterFlow(settled.platform, 'DEPOSIT');
    const bank = filterFlow(settled.bank, 'DEPOSIT');
    const match = matchFlow('DEPOSIT', platform, bank);

    expect(match.duplicateKeys).toBe(fixture.expected.deposits.duplicateKeys);
    // A primeira ocorrência (inserida primeiro, ambas core) casa; a segunda sobra.
    expect(match.pending.some((movement) => movement.key === 'p-dup-a')).toBe(false);
    expect(match.pending.some((movement) => movement.key === 'p-dup-b')).toBe(true);
  });

  it('virada do dia: par plataforma fora do dia × banco dentro do dia conta em crossEdge', () => {
    const platform = filterFlow(settled.platform, 'DEPOSIT');
    const bank = filterFlow(settled.bank, 'DEPOSIT');
    const match = matchFlow('DEPOSIT', platform, bank);

    expect(match.crossEdge).toEqual(fixture.expected.deposits.crossEdge);
    expect(match.pending.some((movement) => movement.key === 'p-cross')).toBe(false);
    expect(match.pending.some((movement) => movement.key === 'b-cross')).toBe(false);
  });

  it('par com os dois lados fora do dia é ignorado — não é matched nem pendência', () => {
    const platform = filterFlow(settled.platform, 'WITHDRAWAL');
    const bank = filterFlow(settled.bank, 'WITHDRAWAL');
    const match = matchFlow('WITHDRAWAL', platform, bank);

    expect(match.pending.some((movement) => movement.key === 'p-both-neighbor')).toBe(false);
    expect(match.pending.some((movement) => movement.key === 'b-both-neighbor')).toBe(false);
    expect(match.edgeLeftovers.some((movement) => movement.key === 'p-both-neighbor')).toBe(false);
    expect(match.edgeLeftovers.some((movement) => movement.key === 'b-both-neighbor')).toBe(false);
    expect(match.matchedCount).toBe(fixture.expected.withdrawals.matchedCount);
  });

  it('tesouraria nunca aparece no fluxo DEPOSIT/WITHDRAWAL e nunca soma com eles', () => {
    const treasury = filterFlow(settled.bank, 'TREASURY');
    const deposits = filterFlow(settled.bank, 'DEPOSIT');
    const withdrawals = filterFlow(settled.bank, 'WITHDRAWAL');

    expect(treasury.some((movement) => movement.key === 'b-treasury')).toBe(true);
    expect(deposits.some((movement) => movement.key === 'b-treasury')).toBe(false);
    expect(withdrawals.some((movement) => movement.key === 'b-treasury')).toBe(false);

    const treasuryTotals = sumCore(treasury);
    expect(treasuryTotals).toEqual(fixture.expected.treasury);

    const depositTotals = sumCore(deposits);
    expect(depositTotals.total).not.toBe(depositTotals.total + treasuryTotals.total);
    expect(depositTotals.total).toBe(fixture.expected.deposits.bankTotal);
  });
});
