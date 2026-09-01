import { ConfirmBankUseCase } from './confirm-bank.use-case';

describe('ConfirmBankUseCase', () => {
  const buildRepository = () => ({ confirmBank: jest.fn().mockResolvedValue(undefined) });

  it('banco fora do catálogo → BadRequestException', async () => {
    const useCase = new ConfirmBankUseCase(buildRepository() as never);

    await expect(
      useCase.execute({
        referenceDate: '2026-08-20',
        brand: 'suprema',
        tenantId: 't1',
        bank: 'banco-fantasma',
        balance: 10,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ name: 'BadRequestException', message: 'Banco não reconhecido' });
  });

  it('bank=trio → BadRequestException (somente leitura)', async () => {
    const useCase = new ConfirmBankUseCase(buildRepository() as never);

    await expect(
      useCase.execute({
        referenceDate: '2026-08-20',
        brand: 'suprema',
        tenantId: 't1',
        bank: 'trio',
        balance: 10,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({
      name: 'BadRequestException',
      message: 'Saldo da Trio é somente leitura',
    });
  });

  it('banco manual válido chama o repositório com roundCurrency aplicado', async () => {
    const repository = buildRepository();
    const useCase = new ConfirmBankUseCase(repository as never);

    await useCase.execute({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      bank: 'caixa',
      balance: 1000.505,
      userId: 'u1',
    });

    expect(repository.confirmBank).toHaveBeenCalledWith(
      expect.objectContaining({ bank: 'caixa', balance: 1000.51 }),
    );
  });
});
