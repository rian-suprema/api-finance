import { RunReconciliationUseCase } from './run-reconciliation.use-case';

describe('RunReconciliationUseCase', () => {
  const REFERENCE_DATE = '2026-06-15';

  const buildPlatform = (overrides: Record<string, unknown> = {}) => ({
    fetchMovements: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  const buildBank = (overrides: Record<string, unknown> = {}) => ({
    isConfigured: true,
    accountIdFor: jest.fn().mockReturnValue('acc-suprema'),
    fetchMovements: jest.fn().mockResolvedValue({ movements: [], fees: { total: 0, count: 0 } }),
    ...overrides,
  });

  const buildRunRepository = (overrides: Record<string, unknown> = {}) => ({
    startRun: jest.fn().mockResolvedValue(1),
    failRun: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  const buildItemRepository = (overrides: Record<string, unknown> = {}) => ({
    saveResult: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it('marca sem TRIO_ACCOUNT_ID configurado → outcome de erro, sem criar run', async () => {
    const runRepository = buildRunRepository();
    const useCase = new RunReconciliationUseCase(
      runRepository as never,
      buildItemRepository() as never,
      buildPlatform() as never,
      buildBank({ accountIdFor: jest.fn().mockReturnValue(undefined) }) as never,
    );

    const [outcome] = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(outcome.error).toBe('Integração com o banco não configurada para esta marca');
    expect(runRepository.startRun).not.toHaveBeenCalled();
  });

  it('Trio não configurada (isConfigured:false) → mesmo outcome de erro', async () => {
    const runRepository = buildRunRepository();
    const useCase = new RunReconciliationUseCase(
      runRepository as never,
      buildItemRepository() as never,
      buildPlatform() as never,
      buildBank({ isConfigured: false }) as never,
    );

    const [outcome] = await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    expect(outcome.error).toBe('Integração com o banco não configurada para esta marca');
    expect(runRepository.startRun).not.toHaveBeenCalled();
  });

  it('lançamentos TREASURY nunca entram no casamento nem em pending — só nos totais', async () => {
    const bankMovements = buildBank({
      fetchMovements: jest.fn().mockResolvedValue({
        movements: [
          { side: 'BANK', flow: 'TREASURY', key: 'tes-1', amountCents: 50000, core: true },
        ],
        fees: { total: 0, count: 0 },
      }),
    });
    const itemRepository = buildItemRepository();
    const useCase = new RunReconciliationUseCase(
      buildRunRepository() as never,
      itemRepository as never,
      buildPlatform() as never,
      bankMovements as never,
    );

    await useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    const [saveResultParams] = itemRepository.saveResult.mock.calls[0] as [
      {
        pending: unknown[];
        matchedCount: number;
        totals: { treasury: { total: number; count: number } };
      },
    ];
    expect(saveResultParams.pending).toEqual([]);
    expect(saveResultParams.matchedCount).toBe(0);
    expect(saveResultParams.totals.treasury).toEqual({ total: 500, count: 1 });
  });

  it('marca com exceção grava failRun e não impede a outra marca (Promise.all independente)', async () => {
    const runRepository = buildRunRepository();
    const bankMovements = buildBank({
      fetchMovements: jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('Trio indisponível')))
        .mockImplementationOnce(() =>
          Promise.resolve({ movements: [], fees: { total: 0, count: 0 } }),
        ),
    });
    const useCase = new RunReconciliationUseCase(
      runRepository as never,
      buildItemRepository() as never,
      buildPlatform() as never,
      bankMovements as never,
    );

    const outcomes = await useCase.execute({
      referenceDate: REFERENCE_DATE,
      brands: ['suprema', 'ultra'],
    });

    expect(outcomes.find((o) => o.brand === 'suprema')?.error).toBe('Trio indisponível');
    expect(outcomes.find((o) => o.brand === 'ultra')?.error).toBeUndefined();
    expect(runRepository.failRun).toHaveBeenCalledTimes(1);
  });

  it('duas execuções concorrentes do mesmo dia+marca: a segunda não duplica trabalho (guarda em memória)', async () => {
    const runRepository = buildRunRepository();
    const useCase = new RunReconciliationUseCase(
      runRepository as never,
      buildItemRepository() as never,
      buildPlatform() as never,
      buildBank() as never,
    );

    // Chamadas síncronas, sem `await` entre elas — a checagem+adição ao Set
    // em `runBrand` é 100% síncrona, então a segunda chamada já vê a marca
    // marcada antes de rodar seu próprio trecho síncrono.
    const promise1 = useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });
    const promise2 = useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });

    const [outcomes1, outcomes2] = await Promise.all([promise1, promise2]);
    const reentrancyErrors = [...outcomes1, ...outcomes2].filter(
      (outcome) => outcome.error === 'Conciliação desta marca já está em andamento',
    );

    expect(reentrancyErrors).toHaveLength(1);
    expect(runRepository.startRun).toHaveBeenCalledTimes(1);
  });

  it('isRunning reflete o Set em memória enquanto a varredura do banco está pendente', async () => {
    let resolveFetch!: (value: {
      movements: unknown[];
      fees: { total: number; count: number };
    }) => void;
    const bankMovements = buildBank({
      fetchMovements: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    });
    const useCase = new RunReconciliationUseCase(
      buildRunRepository() as never,
      buildItemRepository() as never,
      buildPlatform() as never,
      bankMovements as never,
    );

    const promise = useCase.execute({ referenceDate: REFERENCE_DATE, brands: ['suprema'] });
    await Promise.resolve();
    await Promise.resolve();
    expect(useCase.isRunning(REFERENCE_DATE, 'suprema')).toBe(true);

    resolveFetch({ movements: [], fees: { total: 0, count: 0 } });
    await promise;
    expect(useCase.isRunning(REFERENCE_DATE, 'suprema')).toBe(false);
  });
});
