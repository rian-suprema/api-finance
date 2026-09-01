import { CashBalanceBrandStatus, CashBalanceDayStatus } from '../../cash-balance.enums';
import { GetBanksStateUseCase } from './get-banks-state.use-case';

describe('GetBanksStateUseCase', () => {
  const buildRepository = (overrides: Record<string, unknown> = {}) => ({
    findDay: jest.fn().mockResolvedValue(null),
    findLastKnownBalances: jest.fn().mockResolvedValue(new Map()),
    sumMonthlyBalances: jest.fn().mockResolvedValue(new Map()),
    ...overrides,
  });
  const buildClickhouse = (overrides: Record<string, unknown> = {}) => ({
    isConfigured: true,
    fetchPlayersBalances: jest.fn().mockResolvedValue(new Map([['suprema', 1000]])),
    ...overrides,
  });
  const buildTrioClosing = (overrides: Record<string, unknown> = {}) => ({
    execute: jest.fn().mockResolvedValue([
      {
        brand: 'suprema',
        balance: 5000,
        available: true,
        capturedAt: '2026-08-20T03:00:00Z',
        exact: true,
      },
    ]),
    ...overrides,
  });

  it('totalBalanco = saldoTransacional - saldoJogadores (sinal correto)', async () => {
    const useCase = new GetBanksStateUseCase(
      buildRepository() as never,
      buildClickhouse({
        fetchPlayersBalances: jest.fn().mockResolvedValue(new Map([['suprema', 2000]])),
      }) as never,
      buildTrioClosing() as never,
    );

    const state = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });
    const brand = state.brands[0];

    expect(brand.saldoTransacional).toBe(5000);
    expect(brand.totalBalanco).toBe(3000);
  });

  it('saldoJogadores e totalBalanco vêm null (não 0) quando o warehouse falha', async () => {
    const useCase = new GetBanksStateUseCase(
      buildRepository() as never,
      buildClickhouse({ isConfigured: false }) as never,
      buildTrioClosing() as never,
    );

    const state = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });

    expect(state.brands[0].saldoJogadores).toBeNull();
    expect(state.brands[0].totalBalanco).toBeNull();
  });

  it('banco trio é sempre readOnly:true e confirmed reflete só se há captura', async () => {
    const useCase = new GetBanksStateUseCase(
      buildRepository() as never,
      buildClickhouse() as never,
      buildTrioClosing({
        execute: jest
          .fn()
          .mockResolvedValue([
            { brand: 'suprema', balance: null, available: false, capturedAt: null, exact: false },
          ]),
      }) as never,
    );

    const state = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });
    const trio = state.brands[0].banks.find((bank) => bank.bank === 'trio');

    expect(trio?.readOnly).toBe(true);
    expect(trio?.confirmed).toBe(false);
    expect(trio?.suggested).toBe(true);
  });

  it('allBrandsConfirmed conta as 3 marcas do catálogo, não as acessíveis ao usuário', async () => {
    const day = {
      status: CashBalanceDayStatus.OPEN,
      brands: [
        {
          id: 1,
          brand: 'suprema',
          status: CashBalanceBrandStatus.CONFIRMED,
          confirmedAt: null,
          entries: [],
          snapshot: null,
        },
      ],
    };
    const useCase = new GetBanksStateUseCase(
      buildRepository({ findDay: jest.fn().mockResolvedValue(day) }) as never,
      buildClickhouse() as never,
      buildTrioClosing() as never,
    );

    // usuário só tem vínculo com "suprema" — mesmo com ela confirmada, o dia
    // não fecha porque faltam ultra/maxima do catálogo.
    const state = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });

    expect(state.allBrandsConfirmed).toBe(false);
  });

  it('sugestão de banco manual não confirmado vem do último saldo conhecido', async () => {
    const useCase = new GetBanksStateUseCase(
      buildRepository({
        findLastKnownBalances: jest
          .fn()
          .mockResolvedValue(new Map([['suprema', new Map([['caixa', 777]])]])),
      }) as never,
      buildClickhouse() as never,
      buildTrioClosing() as never,
    );

    const state = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });
    const caixa = state.brands[0].banks.find((bank) => bank.bank === 'caixa');

    expect(caixa?.balance).toBe(777);
    expect(caixa?.suggested).toBe(true);
    expect(caixa?.confirmed).toBe(false);
  });
});
