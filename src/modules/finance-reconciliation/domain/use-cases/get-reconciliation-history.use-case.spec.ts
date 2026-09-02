import { GetReconciliationHistoryUseCase } from './get-reconciliation-history.use-case';
import { ReconciliationRunStatus } from '../../reconciliation.enums';

describe('GetReconciliationHistoryUseCase', () => {
  const buildRunRepository = (overrides: Record<string, unknown> = {}) => ({
    findRunsInRange: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  });

  const buildItemRepository = (overrides: Record<string, unknown> = {}) => ({
    countItemsInRange: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  });

  it('dia sem execução nenhuma → NOT_RUN, nunca omitido da lista', async () => {
    const useCase = new GetReconciliationHistoryUseCase(
      buildRunRepository() as never,
      buildItemRepository() as never,
    );

    const result = await useCase.execute({
      from: '2026-06-15',
      to: '2026-06-15',
      brands: ['suprema'],
    });

    expect(result.days).toHaveLength(1);
    expect(result.days[0].status).toBe('NOT_RUN');
  });

  it('severidade: dia com uma marca PENDING e outra NOT_RUN herda NOT_RUN (o pior)', async () => {
    const runs = new Map([
      [
        '2026-06-15|suprema',
        {
          referenceDate: '2026-06-15',
          brand: 'suprema',
          status: ReconciliationRunStatus.DONE,
          matchedCount: 4,
        },
      ],
      // 'ultra' nunca aparece no Map — equivalente a nenhuma execução (NOT_RUN).
    ]);
    const counts = new Map([['2026-06-15|suprema', { open: 7, openAmount: 383, resolved: 2 }]]);
    const useCase = new GetReconciliationHistoryUseCase(
      buildRunRepository({ findRunsInRange: jest.fn().mockResolvedValue(runs) }) as never,
      buildItemRepository({ countItemsInRange: jest.fn().mockResolvedValue(counts) }) as never,
    );

    const result = await useCase.execute({
      from: '2026-06-15',
      to: '2026-06-15',
      brands: ['suprema', 'ultra'],
    });

    expect(result.days[0].brands.find((b) => b.brand === 'suprema')?.status).toBe('PENDING');
    expect(result.days[0].brands.find((b) => b.brand === 'ultra')?.status).toBe('NOT_RUN');
    expect(result.days[0].status).toBe('NOT_RUN');
  });

  it('dia RUNNING não entra em reconciledDays, pendingDays nem missingDays', async () => {
    const runs = new Map([
      [
        '2026-06-15|suprema',
        {
          referenceDate: '2026-06-15',
          brand: 'suprema',
          status: ReconciliationRunStatus.RUNNING,
          matchedCount: 0,
        },
      ],
    ]);
    const useCase = new GetReconciliationHistoryUseCase(
      buildRunRepository({ findRunsInRange: jest.fn().mockResolvedValue(runs) }) as never,
      buildItemRepository() as never,
    );

    const result = await useCase.execute({
      from: '2026-06-15',
      to: '2026-06-15',
      brands: ['suprema'],
    });

    expect(result.days[0].status).toBe('RUNNING');
    expect(result.reconciledDays).toBe(0);
    expect(result.pendingDays).toBe(0);
    expect(result.missingDays).toBe(0);
  });

  it('missingDays conta NOT_RUN + FAILED, nunca RUNNING', async () => {
    const runs = new Map([
      [
        '2026-06-14|suprema',
        {
          referenceDate: '2026-06-14',
          brand: 'suprema',
          status: ReconciliationRunStatus.FAILED,
          matchedCount: 0,
        },
      ],
      // 2026-06-15 sem run → NOT_RUN.
    ]);
    const useCase = new GetReconciliationHistoryUseCase(
      buildRunRepository({ findRunsInRange: jest.fn().mockResolvedValue(runs) }) as never,
      buildItemRepository() as never,
    );

    const result = await useCase.execute({
      from: '2026-06-14',
      to: '2026-06-15',
      brands: ['suprema'],
    });

    expect(result.rangeDays).toBe(2);
    expect(result.missingDays).toBe(2);
  });

  it('agrega openCount/openAmount/resolvedCount de todos os dia+marca do intervalo', async () => {
    const counts = new Map([
      ['2026-06-14|suprema', { open: 3, openAmount: 100, resolved: 1 }],
      ['2026-06-15|suprema', { open: 4, openAmount: 283, resolved: 1 }],
    ]);
    const useCase = new GetReconciliationHistoryUseCase(
      buildRunRepository() as never,
      buildItemRepository({ countItemsInRange: jest.fn().mockResolvedValue(counts) }) as never,
    );

    const result = await useCase.execute({
      from: '2026-06-14',
      to: '2026-06-15',
      brands: ['suprema'],
    });

    expect(result.openCount).toBe(7);
    expect(result.openAmount).toBe(383);
    expect(result.resolvedCount).toBe(2);
  });

  it('allReconciled exige days.length > 0 e todos RECONCILED', async () => {
    const runs = new Map([
      [
        '2026-06-15|suprema',
        {
          referenceDate: '2026-06-15',
          brand: 'suprema',
          status: ReconciliationRunStatus.DONE,
          matchedCount: 4,
        },
      ],
    ]);
    const useCase = new GetReconciliationHistoryUseCase(
      buildRunRepository({ findRunsInRange: jest.fn().mockResolvedValue(runs) }) as never,
      buildItemRepository() as never,
    );

    const result = await useCase.execute({
      from: '2026-06-15',
      to: '2026-06-15',
      brands: ['suprema'],
    });

    expect(result.days[0].status).toBe('RECONCILED');
    expect(result.allReconciled).toBe(true);
  });
});
