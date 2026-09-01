import { CashBalanceRegistryService } from './cash-balance-registry.service';

describe('CashBalanceRegistryService', () => {
  const buildAccess = () => ({
    resolveReferenceDate: jest.fn().mockReturnValue('2026-08-20'),
    requireBrand: jest.fn().mockResolvedValue({ brand: 'suprema', tenantId: 't1' }),
  });

  it('confirm resolve a marca via requireBrand (nunca aceita a marca como fonte de autorização direta)', async () => {
    const access = buildAccess();
    const confirmBank = { execute: jest.fn().mockResolvedValue(undefined) };
    const service = new CashBalanceRegistryService(
      access as never,
      confirmBank as never,
      {} as never,
      {} as never,
    );

    await service.confirm({
      authorization: 'Bearer token',
      brandParam: 'suprema',
      bank: 'caixa',
      balance: 100,
      userId: 'u1',
    });

    expect(access.requireBrand).toHaveBeenCalledWith('Bearer token', 'suprema');
    expect(confirmBank.execute).toHaveBeenCalledWith({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      bank: 'caixa',
      balance: 100,
      userId: 'u1',
    });
  });

  it('register nunca recebe balance no input — só data e identidade', async () => {
    const access = buildAccess();
    const registerBrand = { execute: jest.fn().mockResolvedValue({ dayStatus: 'OPEN' }) };
    const service = new CashBalanceRegistryService(
      access as never,
      {} as never,
      registerBrand as never,
      {} as never,
    );

    await service.register({ authorization: 'Bearer token', brandParam: 'suprema', userId: 'u1' });

    expect(registerBrand.execute).toHaveBeenCalledWith({
      referenceDate: '2026-08-20',
      brand: 'suprema',
      tenantId: 't1',
      userId: 'u1',
    });
  });

  it('reopen resolve a marca via requireBrand e delega ao use-case', async () => {
    const access = buildAccess();
    const reopenBrand = { execute: jest.fn().mockResolvedValue(undefined) };
    const service = new CashBalanceRegistryService(
      access as never,
      {} as never,
      {} as never,
      reopenBrand as never,
    );

    await service.reopen({ authorization: 'Bearer token', brandParam: 'suprema' });

    expect(reopenBrand.execute).toHaveBeenCalledWith({
      referenceDate: '2026-08-20',
      brand: 'suprema',
    });
  });
});
