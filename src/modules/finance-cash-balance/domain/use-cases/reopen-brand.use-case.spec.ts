import { ReopenBrandUseCase } from './reopen-brand.use-case';

describe('ReopenBrandUseCase', () => {
  it('marca nunca registrada → NotFoundException', async () => {
    const repository = { reopenBrand: jest.fn().mockResolvedValue(false) };
    const useCase = new ReopenBrandUseCase(repository as never);

    await expect(
      useCase.execute({ referenceDate: '2026-08-20', brand: 'suprema' }),
    ).rejects.toMatchObject({
      name: 'NotFoundException',
      message: 'Não há balanço registrado para esta marca na data',
    });
  });

  it('marca registrada → reabre sem lançar', async () => {
    const repository = { reopenBrand: jest.fn().mockResolvedValue(true) };
    const useCase = new ReopenBrandUseCase(repository as never);

    await expect(
      useCase.execute({ referenceDate: '2026-08-20', brand: 'suprema' }),
    ).resolves.toBeUndefined();
    expect(repository.reopenBrand).toHaveBeenCalledWith('2026-08-20', 'suprema');
  });
});
