import { CashBalanceDayStatus } from '../../cash-balance.enums';
import { GetHistoryUseCase } from './get-history.use-case';

describe('GetHistoryUseCase', () => {
  const buildRepository = (records: unknown[] = []) => ({
    findRegisteredRange: jest.fn().mockResolvedValue(records),
  });
  const buildClickhouse = (overrides: Record<string, unknown> = {}) => ({
    isConfigured: true,
    fetchKpisByDayAndBrand: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  it('registeredDays conta só dias com registro; rangeDays conta dias corridos do intervalo', async () => {
    const records = [
      {
        referenceDate: '2026-08-10',
        brand: 'suprema',
        dayStatus: CashBalanceDayStatus.CLOSED,
        saldoTransacional: 100,
        saldoJogadores: 40,
        totalBalanco: 60,
        acumuladoMensal: 60,
      },
    ];
    const useCase = new GetHistoryUseCase(
      buildRepository(records) as never,
      buildClickhouse() as never,
    );

    const history = await useCase.execute({
      from: '2026-08-01',
      to: '2026-08-15',
      brands: ['suprema'],
    });

    expect(history.rangeDays).toBe(15);
    expect(history.registeredDays).toBe(1);
  });

  it('kpisAvailable:false quando o warehouse falha, mas a tabela continua respondendo', async () => {
    const records = [
      {
        referenceDate: '2026-08-10',
        brand: 'suprema',
        dayStatus: CashBalanceDayStatus.CLOSED,
        saldoTransacional: 100,
        saldoJogadores: 40,
        totalBalanco: 60,
        acumuladoMensal: 60,
      },
    ];
    const useCase = new GetHistoryUseCase(
      buildRepository(records) as never,
      buildClickhouse({
        fetchKpisByDayAndBrand: jest.fn().mockRejectedValue(new Error('fora')),
      }) as never,
    );

    const history = await useCase.execute({
      from: '2026-08-01',
      to: '2026-08-15',
      brands: ['suprema'],
    });

    expect(history.kpisAvailable).toBe(false);
    expect(history.days).toHaveLength(1);
  });

  it('usa dois divisores diferentes: netDepositDailyAverage por rangeDays, totalBalancoDailyAverage por dias registrados', async () => {
    const records = [
      {
        referenceDate: '2026-08-10',
        brand: 'suprema',
        dayStatus: CashBalanceDayStatus.CLOSED,
        saldoTransacional: 100,
        saldoJogadores: 0,
        totalBalanco: 100,
        acumuladoMensal: 100,
      },
    ];
    const useCase = new GetHistoryUseCase(
      buildRepository(records) as never,
      buildClickhouse({
        fetchKpisByDayAndBrand: jest
          .fn()
          .mockResolvedValue([
            { date: '2026-08-10', brand: 'suprema', depositsTotal: 300, withdrawalsTotal: 0 },
          ]),
      }) as never,
    );

    // 10 dias corridos, 1 dia registrado.
    const history = await useCase.execute({
      from: '2026-08-01',
      to: '2026-08-10',
      brands: ['suprema'],
    });

    const netAvg = history.kpis.netDepositDailyAverage.byBrand.find((b) => b.brand === 'suprema');
    const balancoAvg = history.kpis.totalBalancoDailyAverage.byBrand.find(
      (b) => b.brand === 'suprema',
    );

    expect(netAvg?.amount).toBeCloseTo(300 / 10);
    expect(balancoAvg?.amount).toBeCloseTo(100 / 1);
  });

  it('ordena as marcas de cada dia pela ordem do catálogo, não pela ordem do banco', async () => {
    const records = [
      {
        referenceDate: '2026-08-10',
        brand: 'maxima',
        dayStatus: CashBalanceDayStatus.CLOSED,
        saldoTransacional: 1,
        saldoJogadores: 0,
        totalBalanco: 1,
        acumuladoMensal: 1,
      },
      {
        referenceDate: '2026-08-10',
        brand: 'suprema',
        dayStatus: CashBalanceDayStatus.CLOSED,
        saldoTransacional: 2,
        saldoJogadores: 0,
        totalBalanco: 2,
        acumuladoMensal: 2,
      },
    ];
    const useCase = new GetHistoryUseCase(
      buildRepository(records) as never,
      buildClickhouse() as never,
    );

    const history = await useCase.execute({
      from: '2026-08-01',
      to: '2026-08-15',
      brands: ['suprema', 'maxima'],
    });

    expect(history.days[0].brands.map((row) => row.brand)).toEqual(['suprema', 'maxima']);
  });
});
