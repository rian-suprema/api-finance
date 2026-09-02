import { ReconciliationController } from './reconciliation.controller';

describe('ReconciliationController', () => {
  const AUTH = 'Bearer x';

  const buildService = (overrides: Record<string, unknown> = {}) => ({
    get: jest.fn().mockResolvedValue({ referenceDate: '2026-06-15', brands: [] }),
    history: jest.fn().mockResolvedValue({ from: '2026-06-01', to: '2026-06-15', days: [] }),
    run: jest.fn().mockResolvedValue({ referenceDate: '2026-06-15' }),
    resolve: jest.fn().mockResolvedValue(undefined),
    reopen: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it('GET / delega authorization + date resolvidos da query', async () => {
    const service = buildService();
    const controller = new ReconciliationController(service as never);

    await controller.get(AUTH, { date: '2026-06-15' });

    expect(service.get).toHaveBeenCalledWith(AUTH, '2026-06-15');
  });

  it('GET /history delega authorization + from/to da query', async () => {
    const service = buildService();
    const controller = new ReconciliationController(service as never);

    await controller.history(AUTH, { from: '2026-06-01', to: '2026-06-15' });

    expect(service.history).toHaveBeenCalledWith(AUTH, '2026-06-01', '2026-06-15');
  });

  it('POST /run delega authorization + date do corpo', async () => {
    const service = buildService();
    const controller = new ReconciliationController(service as never);

    await controller.run(AUTH, { date: '2026-06-15' });

    expect(service.run).toHaveBeenCalledWith(AUTH, '2026-06-15');
  });

  it('POST /items/:id/resolve delega authorization + sub do JWT + id + nota', async () => {
    const service = buildService();
    const controller = new ReconciliationController(service as never);

    await controller.resolve(
      AUTH,
      { sub: 'user-1', email: 'a@b.com', tenantId: 't1', permissions: [] },
      42,
      { note: 'Nota válida com mais de dez caracteres.' },
    );

    expect(service.resolve).toHaveBeenCalledWith(
      AUTH,
      42,
      'Nota válida com mais de dez caracteres.',
      'user-1',
    );
  });

  it('POST /items/:id/reopen delega authorization + id', async () => {
    const service = buildService();
    const controller = new ReconciliationController(service as never);

    await controller.reopen(AUTH, 42);

    expect(service.reopen).toHaveBeenCalledWith(AUTH, 42);
  });
});
