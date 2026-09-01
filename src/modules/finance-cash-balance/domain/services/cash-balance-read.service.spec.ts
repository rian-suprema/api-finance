import { CashBalanceReadService } from './cash-balance-read.service';

describe('CashBalanceReadService', () => {
  const buildAccess = (overrides: Record<string, unknown> = {}) => ({
    resolveReferenceDate: jest.fn().mockReturnValue('2026-08-20'),
    resolveBrands: jest.fn().mockResolvedValue([{ brand: 'suprema', tenantId: 't1' }]),
    resolveRange: jest.fn().mockReturnValue({ from: '2026-08-01', to: '2026-08-15' }),
    ...overrides,
  });

  it('summary resolve o escopo (data + marcas acessíveis) e delega ao use-case', async () => {
    const access = buildAccess();
    const getSummary = { execute: jest.fn().mockResolvedValue({ available: true }) };
    const service = new CashBalanceReadService(
      access as never,
      getSummary as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.summary('Bearer token', '2026-08-20');

    expect(access.resolveBrands).toHaveBeenCalledWith('Bearer token');
    expect(getSummary.execute).toHaveBeenCalledWith({
      referenceDate: '2026-08-20',
      brands: ['suprema'],
    });
  });

  it('history usa resolveRange (não resolveReferenceDate) e passa as marcas acessíveis', async () => {
    const access = buildAccess();
    const getHistory = { execute: jest.fn().mockResolvedValue({ days: [] }) };
    const service = new CashBalanceReadService(
      access as never,
      {} as never,
      {} as never,
      getHistory as never,
      {} as never,
    );

    await service.history('Bearer token', '2026-08-01', '2026-08-15');

    expect(access.resolveRange).toHaveBeenCalledWith('2026-08-01', '2026-08-15');
    expect(getHistory.execute).toHaveBeenCalledWith({
      from: '2026-08-01',
      to: '2026-08-15',
      brands: ['suprema'],
    });
  });
});
