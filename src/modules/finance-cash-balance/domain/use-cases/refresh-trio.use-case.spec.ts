import { RefreshTrioUseCase } from './refresh-trio.use-case';

describe('RefreshTrioUseCase', () => {
  it('sem captura no banco para a data → available:false, com mensagem, nunca chama a Trio', async () => {
    const repository = { findByDate: jest.fn().mockResolvedValue(new Map()) };
    const useCase = new RefreshTrioUseCase(repository as never);

    const [result] = await useCase.execute({ referenceDate: '2099-01-01', brands: ['suprema'] });

    expect(result).toEqual({
      brand: 'suprema',
      balance: null,
      available: false,
      capturedAt: null,
      exact: false,
      message: 'Saldo de fechamento da Trio não capturado para este dia',
    });
    expect(repository.findByDate).toHaveBeenCalledWith('2099-01-01', ['suprema']);
  });

  it('captura exata → available:true, exact:true, sem message', async () => {
    const capturedAt = new Date('2026-08-20T03:00:00Z');
    const repository = {
      findByDate: jest
        .fn()
        .mockResolvedValue(new Map([['suprema', { balance: 100.5, capturedAt, exact: true }]])),
    };
    const useCase = new RefreshTrioUseCase(repository as never);

    const [result] = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });

    expect(result.available).toBe(true);
    expect(result.exact).toBe(true);
    expect(result.balance).toBe(100.5);
    expect(result.message).toBeUndefined();
  });

  it('captura sem convergência → exact:false com mensagem de conferência', async () => {
    const capturedAt = new Date('2026-08-20T03:00:00Z');
    const repository = {
      findByDate: jest
        .fn()
        .mockResolvedValue(new Map([['suprema', { balance: 100, capturedAt, exact: false }]])),
    };
    const useCase = new RefreshTrioUseCase(repository as never);

    const [result] = await useCase.execute({ referenceDate: '2026-08-20', brands: ['suprema'] });

    expect(result.available).toBe(true);
    expect(result.exact).toBe(false);
    expect(result.message).toBe('Fechamento sem convergência, conferir');
  });
});
