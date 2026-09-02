import { GetReconciliationUseCase } from './get-reconciliation.use-case';
import { ReconciliationRunStatus } from '../../reconciliation.enums';
import type { RunTotals } from '../reconciliation.types';

describe('GetReconciliationUseCase', () => {
  const REFERENCE_DATE = '2026-06-15';

  const ZERO: RunTotals = {
    platformDeposits: { total: 0, count: 0 },
    bankDeposits: { total: 0, count: 0 },
    platformWithdrawals: { total: 0, count: 0 },
    bankWithdrawals: { total: 0, count: 0 },
    treasury: { total: 0, count: 0 },
    fees: { total: 0, count: 0 },
    depositsCrossover: { total: 0, count: 0 },
    withdrawalsCrossover: { total: 0, count: 0 },
  };

  const buildRunRepository = (overrides: Record<string, unknown> = {}) => ({
    findRuns: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  });

  const buildItemRepository = (overrides: Record<string, unknown> = {}) => ({
    findItems: jest.fn().mockResolvedValue(new Map()),
    countItems: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  });

  const buildRunReconciliation = (overrides: Record<string, unknown> = {}) => ({
    isRunning: jest.fn().mockReturnValue(false),
    ...overrides,
  });

  it('sem execução para a marca → NOT_RUN, com a mensagem padrão', async () => {
    const useCase = new GetReconciliationUseCase(
      buildRunRepository() as never,
      buildItemRepository() as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].status).toBe('NOT_RUN');
    expect(result.brands[0].message).toBe('Conciliação deste dia ainda não foi executada');
    expect(result.brands[0].totals).toEqual(ZERO);
  });

  it('run FAILED → status FAILED com a mensagem do erro gravado', async () => {
    const runRepository = buildRunRepository({
      findRuns: jest.fn().mockResolvedValue(
        new Map([
          [
            'suprema',
            {
              matchedCount: 0,
              totals: ZERO,
              status: ReconciliationRunStatus.FAILED,
              error: 'Trio indisponível',
            },
          ],
        ]),
      ),
    });
    const useCase = new GetReconciliationUseCase(
      runRepository as never,
      buildItemRepository() as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].status).toBe('FAILED');
    expect(result.brands[0].message).toBe('Trio indisponível');
  });

  it('DONE com openCount > 0 → reconciled é false mesmo com status DONE', async () => {
    const runRepository = buildRunRepository({
      findRuns: jest
        .fn()
        .mockResolvedValue(
          new Map([
            ['suprema', { matchedCount: 4, totals: ZERO, status: ReconciliationRunStatus.DONE }],
          ]),
        ),
    });
    const itemRepository = buildItemRepository({
      countItems: jest
        .fn()
        .mockResolvedValue(
          new Map([['suprema', { total: 9, open: 7, resolved: 2, reprocessPending: 1 }]]),
        ),
    });
    const useCase = new GetReconciliationUseCase(
      runRepository as never,
      itemRepository as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].openCount).toBe(7);
    expect(result.brands[0].reconciled).toBe(false);
    expect(result.allReconciled).toBe(false);
  });

  it('DONE com openCount = 0 → reconciled true, e allReconciled true quando todas as marcas estão assim', async () => {
    const runRepository = buildRunRepository({
      findRuns: jest
        .fn()
        .mockResolvedValue(
          new Map([
            ['suprema', { matchedCount: 2, totals: ZERO, status: ReconciliationRunStatus.DONE }],
          ]),
        ),
    });
    const itemRepository = buildItemRepository({
      countItems: jest
        .fn()
        .mockResolvedValue(
          new Map([['suprema', { total: 2, open: 0, resolved: 2, reprocessPending: 0 }]]),
        ),
    });
    const useCase = new GetReconciliationUseCase(
      runRepository as never,
      itemRepository as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].reconciled).toBe(true);
    expect(result.allReconciled).toBe(true);
  });

  it('usuário sem marca nenhuma → allReconciled false (nunca declara tudo conciliado com zero informação)', async () => {
    const useCase = new GetReconciliationUseCase(
      buildRunRepository() as never,
      buildItemRepository() as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: [] });

    expect(result.brands).toEqual([]);
    expect(result.allReconciled).toBe(false);
  });

  it('itemsTruncated reflete count.total > items devolvidos (teto da resposta)', async () => {
    const runRepository = buildRunRepository({
      findRuns: jest
        .fn()
        .mockResolvedValue(
          new Map([
            ['suprema', { matchedCount: 0, totals: ZERO, status: ReconciliationRunStatus.DONE }],
          ]),
        ),
    });
    const itemRepository = buildItemRepository({
      findItems: jest.fn().mockResolvedValue(new Map([['suprema', [{ id: 1 }]]])),
      countItems: jest
        .fn()
        .mockResolvedValue(
          new Map([['suprema', { total: 500, open: 500, resolved: 0, reprocessPending: 0 }]]),
        ),
    });
    const useCase = new GetReconciliationUseCase(
      runRepository as never,
      itemRepository as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].itemsTruncated).toBe(true);
  });

  it('depositsDifference/withdrawalsDifference = banco − plataforma', async () => {
    const totals: RunTotals = {
      ...ZERO,
      platformDeposits: { total: 175, count: 3 },
      bankDeposits: { total: 170, count: 4 },
      platformWithdrawals: { total: 270, count: 2 },
      bankWithdrawals: { total: 430, count: 5 },
    };
    const runRepository = buildRunRepository({
      findRuns: jest
        .fn()
        .mockResolvedValue(
          new Map([['suprema', { matchedCount: 4, totals, status: ReconciliationRunStatus.DONE }]]),
        ),
    });
    const useCase = new GetReconciliationUseCase(
      runRepository as never,
      buildItemRepository() as never,
      buildRunReconciliation() as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].depositsDifference).toBe(-5);
    expect(result.brands[0].withdrawalsDifference).toBe(160);
  });

  it('running reflete RunReconciliationUseCase.isRunning por marca+data', async () => {
    const runReconciliation = buildRunReconciliation({
      isRunning: jest.fn().mockReturnValue(true),
    });
    const useCase = new GetReconciliationUseCase(
      buildRunRepository() as never,
      buildItemRepository() as never,
      runReconciliation as never,
    );

    const result = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(result.brands[0].running).toBe(true);
    expect(runReconciliation.isRunning).toHaveBeenCalledWith(REFERENCE_DATE, 'suprema');
  });
});
