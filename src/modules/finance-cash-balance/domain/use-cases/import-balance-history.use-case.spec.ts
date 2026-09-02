import {
  ImportBalanceHistoryUseCase,
  type ImportBalanceRow,
} from './import-balance-history.use-case';

describe('ImportBalanceHistoryUseCase', () => {
  const row = (overrides: Partial<ImportBalanceRow> = {}): ImportBalanceRow => ({
    referenceDate: '2026-07-01',
    brand: 'suprema',
    bankBalances: new Map([['trio', 900]]),
    saldoTransacional: 900,
    saldoJogadores: 400,
    totalBalanco: 500,
    ...overrides,
  });

  const buildRepository = (overrides: Record<string, unknown> = {}) => ({
    findRegisteredKeys: jest.fn().mockResolvedValue(new Set()),
    findTenantIdsByBrand: jest.fn().mockResolvedValue(new Map([['suprema', 'tenant-1']])),
    importBrandBalance: jest.fn().mockResolvedValue(undefined),
    closeCompleteDays: jest.fn().mockResolvedValue([]),
    recomputeMonthlyAccumulated: jest.fn().mockResolvedValue(1),
    ...overrides,
  });

  it('sem linhas, devolve relatório vazio sem tocar no repositório', async () => {
    const repository = buildRepository();
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [],
      importedBy: 'cli',
      apply: false,
      overwrite: false,
    });

    expect(report).toMatchObject({ totalRows: 0, imported: 0, range: null });
    expect(repository.findRegisteredKeys).not.toHaveBeenCalled();
  });

  it('marca sem tenant conhecido → pulada com o motivo', async () => {
    const repository = buildRepository({
      findTenantIdsByBrand: jest.fn().mockResolvedValue(new Map()),
    });
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row()],
      importedBy: 'cli',
      apply: true,
      overwrite: false,
    });

    expect(report.imported).toBe(0);
    expect(report.skipped).toEqual([
      {
        referenceDate: '2026-07-01',
        brand: 'suprema',
        reason: 'marca sem tenant conhecido no banco — registre um dia por ela primeiro',
      },
    ]);
    expect(repository.importBrandBalance).not.toHaveBeenCalled();
  });

  it('dia já registrado sem `overwrite` → pulado', async () => {
    const repository = buildRepository({
      findRegisteredKeys: jest.fn().mockResolvedValue(new Set(['2026-07-01|suprema'])),
    });
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row()],
      importedBy: 'cli',
      apply: true,
      overwrite: false,
    });

    expect(report.skipped).toEqual([
      { referenceDate: '2026-07-01', brand: 'suprema', reason: 'já registrado no banco' },
    ]);
  });

  it('dia já registrado COM `overwrite` → regrava', async () => {
    const repository = buildRepository({
      findRegisteredKeys: jest.fn().mockResolvedValue(new Set(['2026-07-01|suprema'])),
    });
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row()],
      importedBy: 'cli',
      apply: true,
      overwrite: true,
    });

    expect(report.imported).toBe(1);
    expect(repository.importBrandBalance).toHaveBeenCalledTimes(1);
  });

  it('`apply: false` só simula — não grava, não fecha dia, não recalcula acumulado', async () => {
    const repository = buildRepository();
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row()],
      importedBy: 'cli',
      apply: false,
      overwrite: false,
    });

    expect(report.imported).toBe(1);
    expect(repository.importBrandBalance).not.toHaveBeenCalled();
    expect(repository.closeCompleteDays).not.toHaveBeenCalled();
    expect(repository.recomputeMonthlyAccumulated).not.toHaveBeenCalled();
  });

  it('`apply: true` grava, fecha dias completos e recalcula o acumulado uma vez por mês', async () => {
    const repository = buildRepository();
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row({ referenceDate: '2026-07-01' }), row({ referenceDate: '2026-07-02' })],
      importedBy: 'cli',
      apply: true,
      overwrite: false,
    });

    expect(report.imported).toBe(2);
    expect(repository.importBrandBalance).toHaveBeenCalledTimes(2);
    expect(repository.closeCompleteDays).toHaveBeenCalledWith('2026-07-01', '2026-07-02', 3, 'cli');
    expect(repository.recomputeMonthlyAccumulated).toHaveBeenCalledTimes(1);
    expect(repository.recomputeMonthlyAccumulated).toHaveBeenCalledWith('2026-07-01');
  });

  it('divergência entre soma dos bancos e saldo transacional → problema no relatório, não bloqueia', async () => {
    const repository = buildRepository();
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row({ bankBalances: new Map([['trio', 100]]), saldoTransacional: 900 })],
      importedBy: 'cli',
      apply: true,
      overwrite: false,
    });

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('soma dos bancos');
    expect(report.imported).toBe(1);
  });

  it('divergência entre total do balanço e transacional−jogadores → problema no relatório', async () => {
    const repository = buildRepository();
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    const report = await useCase.execute({
      rows: [row({ totalBalanco: 999 })],
      importedBy: 'cli',
      apply: true,
      overwrite: false,
    });

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('total do balanço');
  });

  it('banco do catálogo ausente na linha entra como zero, não some do total', async () => {
    const repository = buildRepository();
    const useCase = new ImportBalanceHistoryUseCase(repository as never);

    await useCase.execute({
      rows: [row({ bankBalances: new Map([['trio', 900]]) })],
      importedBy: 'cli',
      apply: true,
      overwrite: false,
    });

    const [[params]] = repository.importBrandBalance.mock.calls as [
      [{ bankBalances: Map<string, number> }],
    ];
    expect(params.bankBalances.get('caixa')).toBe(0);
    expect(params.bankBalances.get('trio')).toBe(900);
  });
});
