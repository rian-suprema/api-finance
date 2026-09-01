import { BadRequestException } from '@nestjs/common';

import { CashBalanceBrandStatus, CashBalanceDayStatus } from '../../cash-balance.enums';
import { RegisterBrandUseCase } from './register-brand.use-case';

describe('RegisterBrandUseCase', () => {
  const CONFIRMED_MANUAL_DAY = {
    status: CashBalanceDayStatus.OPEN,
    brands: [
      {
        id: 1,
        brand: 'suprema',
        status: CashBalanceBrandStatus.DRAFT,
        confirmedAt: null,
        entries: [
          { bank: 'caixa', balance: 100, confirmed: true },
          { bank: 'onekey', balance: 100, confirmed: true },
          { bank: 'zro', balance: 100, confirmed: true },
          { bank: 'celcoin', balance: 100, confirmed: true },
          { bank: 'okto', balance: 100, confirmed: true },
          { bank: 'topazio', balance: 100, confirmed: true },
          { bank: 'genial', balance: 100, confirmed: true },
        ],
        snapshot: null,
      },
    ],
  };

  const buildRepository = (overrides: Record<string, unknown> = {}) => ({
    findDay: jest.fn().mockResolvedValue(CONFIRMED_MANUAL_DAY),
    registerBrand: jest.fn().mockResolvedValue({
      acumuladoMensal: 999,
      dayClosed: false,
      saldoTransacional: 900,
      totalBalanco: 500,
    }),
    ...overrides,
  });
  const buildClickhouse = (overrides: Record<string, unknown> = {}) => ({
    isConfigured: true,
    fetchPlayersBalances: jest.fn().mockResolvedValue(new Map([['suprema', 400]])),
    fetchDailyKpis: jest.fn().mockResolvedValue([]),
    ...overrides,
  });
  const buildTrioClosing = (overrides: Record<string, unknown> = {}) => ({
    execute: jest.fn().mockResolvedValue([
      {
        brand: 'suprema',
        balance: 200,
        available: true,
        capturedAt: '2026-08-20T03:00:00Z',
        exact: true,
      },
    ]),
    ...overrides,
  });

  it('bancos manuais incompletos → BadRequestException com pendingBanks', async () => {
    const dayFaltandoUm = {
      ...CONFIRMED_MANUAL_DAY,
      brands: [
        {
          ...CONFIRMED_MANUAL_DAY.brands[0],
          entries: CONFIRMED_MANUAL_DAY.brands[0].entries.slice(0, 6),
        },
      ],
    };
    const useCase = new RegisterBrandUseCase(
      buildRepository({ findDay: jest.fn().mockResolvedValue(dayFaltandoUm) }) as never,
      buildClickhouse() as never,
      buildTrioClosing() as never,
    );

    let caught: BadRequestException | undefined;
    try {
      await useCase.execute({
        referenceDate: '2026-08-20',
        brand: 'suprema',
        tenantId: 't1',
        userId: 'u1',
      });
    } catch (error) {
      caught = error as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({ pendingBanks: ['genial'] });
  });

  it('sem fechamento Trio capturado → ServiceUnavailableException, nunca grava', async () => {
    const repository = buildRepository();
    const useCase = new RegisterBrandUseCase(
      repository as never,
      buildClickhouse() as never,
      buildTrioClosing({
        execute: jest
          .fn()
          .mockResolvedValue([
            { brand: 'suprema', balance: null, available: false, capturedAt: null, exact: false },
          ]),
      }) as never,
    );

    await expect(
      useCase.execute({
        referenceDate: '2026-08-20',
        brand: 'suprema',
        tenantId: 't1',
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ name: 'ServiceUnavailableException' });
    expect(repository.registerBrand).not.toHaveBeenCalled();
  });

  it('sem saldo de jogadores (ClickHouse fora) → ServiceUnavailableException, nunca grava', async () => {
    const repository = buildRepository();
    const useCase = new RegisterBrandUseCase(
      repository as never,
      buildClickhouse({ isConfigured: false }) as never,
      buildTrioClosing() as never,
    );

    await expect(
      useCase.execute({
        referenceDate: '2026-08-20',
        brand: 'suprema',
        tenantId: 't1',
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ name: 'ServiceUnavailableException' });
    expect(repository.registerBrand).not.toHaveBeenCalled();
  });

  it('completo: devolve saldoTransacional/totalBalanco calculados pelo repositório (sob lock), nunca recalculados aqui', async () => {
    const repository = buildRepository();
    const useCase = new RegisterBrandUseCase(
      repository as never,
      buildClickhouse() as never,
      buildTrioClosing() as never,
    );

    const result = await useCase.execute({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      userId: 'u1',
    });

    expect(result.saldoTransacional).toBe(900);
    expect(result.totalBalanco).toBe(500);
    expect(repository.registerBrand).toHaveBeenCalledWith(
      expect.objectContaining({ trioBalance: 200, saldoJogadores: 400 }),
      expect.any(Function),
    );
    // params NÃO carrega mais manualBalances/saldoTransacional/totalBalanco —
    // quem calcula agora é o repositório, sob o lock.
    const [callParams] = repository.registerBrand.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(callParams).not.toHaveProperty('manualBalances');
    expect(callParams).not.toHaveProperty('saldoTransacional');
    expect(callParams).not.toHaveProperty('totalBalanco');
  });

  it('o callback passado a registerBrand extrai os saldos manuais confirmados das linhas travadas', async () => {
    const repository = buildRepository();
    const useCase = new RegisterBrandUseCase(
      repository as never,
      buildClickhouse() as never,
      buildTrioClosing() as never,
    );

    await useCase.execute({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      userId: 'u1',
    });

    const [, resolveManualBalances] = repository.registerBrand.mock.calls[0] as [
      unknown,
      (entries: (typeof CONFIRMED_MANUAL_DAY.brands)[0]['entries']) => Map<string, number>,
    ];
    const manualBalances = resolveManualBalances(CONFIRMED_MANUAL_DAY.brands[0].entries);

    expect([...manualBalances.entries()]).toEqual([
      ['caixa', 100],
      ['onekey', 100],
      ['zro', 100],
      ['celcoin', 100],
      ['okto', 100],
      ['topazio', 100],
      ['genial', 100],
    ]);
  });

  it('KPIs do dia indisponíveis não bloqueia o registro — cai para {0,0}', async () => {
    const repository = buildRepository();
    const useCase = new RegisterBrandUseCase(
      repository as never,
      buildClickhouse({ fetchDailyKpis: jest.fn().mockRejectedValue(new Error('fora')) }) as never,
      buildTrioClosing() as never,
    );

    await useCase.execute({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      userId: 'u1',
    });

    expect(repository.registerBrand).toHaveBeenCalledWith(
      expect.objectContaining({ depositsTotal: 0, withdrawalsTotal: 0 }),
      expect.any(Function),
    );
  });

  it('dia fecha (dayClosed:true) → resposta com dayStatus CLOSED e allBrandsConfirmed true', async () => {
    const repository = buildRepository({
      registerBrand: jest.fn().mockResolvedValue({
        acumuladoMensal: 100,
        dayClosed: true,
        saldoTransacional: 900,
        totalBalanco: 500,
      }),
    });
    const useCase = new RegisterBrandUseCase(
      repository as never,
      buildClickhouse() as never,
      buildTrioClosing() as never,
    );

    const result = await useCase.execute({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      userId: 'u1',
    });

    expect(result.dayStatus).toBe('CLOSED');
    expect(result.allBrandsConfirmed).toBe(true);
  });
});
