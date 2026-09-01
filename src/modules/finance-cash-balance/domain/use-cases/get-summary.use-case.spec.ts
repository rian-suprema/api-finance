import { GetSummaryUseCase } from './get-summary.use-case';

describe('GetSummaryUseCase', () => {
  const buildClickhouse = (overrides: Record<string, unknown> = {}) => ({
    isConfigured: true,
    fetchDailyKpis: jest.fn().mockResolvedValue([]),
    fetchMonthlyKpis: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  it('devolve available:false sem chamar o ClickHouse quando ele não está configurado', async () => {
    const clickhouse = buildClickhouse({ isConfigured: false });
    const useCase = new GetSummaryUseCase(clickhouse as never);

    const summary = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });

    expect(summary.available).toBe(false);
    expect(clickhouse.fetchDailyKpis).not.toHaveBeenCalled();
  });

  it('degrada para available:false quando o ClickHouse lança (KPI indisponível não bloqueia)', async () => {
    const clickhouse = buildClickhouse({
      fetchDailyKpis: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const useCase = new GetSummaryUseCase(clickhouse as never);

    const summary = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });

    expect(summary.available).toBe(false);
  });

  it('netDeposit é subtraído marca a marca, não no total', async () => {
    const clickhouse = buildClickhouse({
      fetchDailyKpis: jest.fn().mockResolvedValue([
        { brand: 'suprema', depositsTotal: 100, withdrawalsTotal: 30 },
        { brand: 'ultra', depositsTotal: 0, withdrawalsTotal: 10 },
      ]),
    });
    const useCase = new GetSummaryUseCase(clickhouse as never);

    const summary = await useCase.execute({
      referenceDate: '2026-08-20',
      brands: ['suprema', 'ultra'],
    });

    expect(summary.available).toBe(true);
    expect(summary.netDepositYesterday.byBrand).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ brand: 'suprema', amount: 70 }),
        expect.objectContaining({ brand: 'ultra', amount: -10 }),
      ]),
    );
    expect(summary.netDepositYesterday.total).toBe(60);
  });
});
