import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  const AUTH = 'Bearer x';

  const buildBrandAccess = (overrides: Record<string, unknown> = {}) => ({
    resolveReferenceDate: jest.fn().mockReturnValue('2026-06-15'),
    resolveRange: jest.fn().mockReturnValue({ from: '2026-06-01', to: '2026-06-15' }),
    resolveBrands: jest.fn().mockResolvedValue([
      { brand: 'suprema', tenantId: 't1' },
      { brand: 'ultra', tenantId: 't2' },
      { brand: 'maxima', tenantId: 't3' },
    ]),
    ...overrides,
  });

  const buildGet = (overrides: Record<string, unknown> = {}) => ({
    execute: jest
      .fn()
      .mockResolvedValue({ referenceDate: '2026-06-15', brands: [], allReconciled: false }),
    ...overrides,
  });

  const buildHistory = (overrides: Record<string, unknown> = {}) => ({
    execute: jest.fn().mockResolvedValue({ from: '2026-06-01', to: '2026-06-15', days: [] }),
    ...overrides,
  });

  const buildRunReconciliation = (overrides: Record<string, unknown> = {}) => ({
    execute: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  const buildResolveItem = (overrides: Record<string, unknown> = {}) => ({
    resolve: jest.fn().mockResolvedValue(undefined),
    reopen: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it('run() nunca aguarda runReconciliation.execute — resolve mesmo se a varredura nunca terminar', async () => {
    const runReconciliation = buildRunReconciliation({
      execute: jest.fn(
        () =>
          new Promise(() => {
            // nunca resolve — simula a varredura de ~2min/marca
          }),
      ),
    });
    const brandAccess = buildBrandAccess();
    const service = new ReconciliationService(
      brandAccess as never,
      buildGet() as never,
      buildHistory() as never,
      runReconciliation as never,
      buildResolveItem() as never,
    );

    const result = await service.run(AUTH, '2026-06-15');

    expect(result).toEqual({ referenceDate: '2026-06-15' });
    expect(runReconciliation.execute).toHaveBeenCalledWith({
      referenceDate: '2026-06-15',
      brands: ['suprema', 'ultra', 'maxima'],
    });
  });

  it('get() resolve a data e as marcas acessíveis antes de delegar ao use-case', async () => {
    const brandAccess = buildBrandAccess();
    const getUseCase = buildGet();
    const service = new ReconciliationService(
      brandAccess as never,
      getUseCase as never,
      buildHistory() as never,
      buildRunReconciliation() as never,
      buildResolveItem() as never,
    );

    await service.get(AUTH, '2099-01-01');

    expect(brandAccess.resolveReferenceDate).toHaveBeenCalledWith('2099-01-01');
    expect(getUseCase.execute).toHaveBeenCalledWith({
      referenceDate: '2026-06-15',
      brands: ['suprema', 'ultra', 'maxima'],
    });
  });

  it('history() resolve o intervalo e as marcas acessíveis antes de delegar', async () => {
    const brandAccess = buildBrandAccess();
    const historyUseCase = buildHistory();
    const service = new ReconciliationService(
      brandAccess as never,
      buildGet() as never,
      historyUseCase as never,
      buildRunReconciliation() as never,
      buildResolveItem() as never,
    );

    await service.history(AUTH, '2026-06-01', '2026-06-15');

    expect(brandAccess.resolveRange).toHaveBeenCalledWith('2026-06-01', '2026-06-15');
    expect(historyUseCase.execute).toHaveBeenCalledWith({
      from: '2026-06-01',
      to: '2026-06-15',
      brands: ['suprema', 'ultra', 'maxima'],
    });
  });

  it('resolve() repassa id/nota/autor + marcas acessíveis do usuário', async () => {
    const resolveItem = buildResolveItem();
    const service = new ReconciliationService(
      buildBrandAccess() as never,
      buildGet() as never,
      buildHistory() as never,
      buildRunReconciliation() as never,
      resolveItem as never,
    );

    await service.resolve(AUTH, 42, 'Nota válida com mais de dez caracteres.', 'user-1');

    expect(resolveItem.resolve).toHaveBeenCalledWith({
      id: 42,
      note: 'Nota válida com mais de dez caracteres.',
      userId: 'user-1',
      allowedBrands: ['suprema', 'ultra', 'maxima'],
    });
  });

  it('reopen() repassa id + marcas acessíveis do usuário', async () => {
    const resolveItem = buildResolveItem();
    const service = new ReconciliationService(
      buildBrandAccess() as never,
      buildGet() as never,
      buildHistory() as never,
      buildRunReconciliation() as never,
      resolveItem as never,
    );

    await service.reopen(AUTH, 42);

    expect(resolveItem.reopen).toHaveBeenCalledWith({
      id: 42,
      allowedBrands: ['suprema', 'ultra', 'maxima'],
    });
  });
});
