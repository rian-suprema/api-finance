import { PlatformMovementsService, type PlatformWindow } from './platform-movements.service';

describe('PlatformMovementsService', () => {
  const buildClickhouseMock = (depositsRows: unknown[], withdrawalsRows: unknown[]) => ({
    isConfigured: true,
    query: jest.fn().mockResolvedValueOnce(depositsRows).mockResolvedValueOnce(withdrawalsRows),
  });

  const buildWindow = (overrides: Partial<PlatformWindow> = {}): PlatformWindow => ({
    brand: 'suprema',
    from: new Date('2026-08-14T00:00:00.000Z'),
    to: new Date('2026-08-16T00:00:00.000Z'),
    coreFrom: new Date('2026-08-15T00:00:00.000Z'),
    coreTo: new Date('2026-08-16T00:00:00.000Z'),
    ...overrides,
  });

  describe('fetchMovements', () => {
    it('depósito usa deposit_ts, saque usa transaction_date/withdrawal_ts (nunca o inverso)', async () => {
      const clickhouseMock = buildClickhouseMock(
        [
          {
            document_id: 'dep-1',
            external_key: 'ext-dep-1',
            occurred_at: '2026-08-15 10:00:00.000',
            amount: '100.00',
          },
        ],
        [
          {
            document_id: 'with-1',
            external_key: 'ext-with-1',
            occurred_at: '2026-08-15 23:59:00.000',
            amount: '200.00',
          },
        ],
      );
      const service = new PlatformMovementsService(clickhouseMock as never);

      await service.fetchMovements(buildWindow());

      const [depositsQuery] = clickhouseMock.query.mock.calls[0] as [string, unknown];
      const [withdrawalsQuery] = clickhouseMock.query.mock.calls[1] as [string, unknown];

      expect(depositsQuery).toContain('deposit_ts');
      expect(depositsQuery).not.toContain('transaction_date');
      expect(depositsQuery).not.toContain('withdrawal_ts');

      expect(withdrawalsQuery).toContain('coalesce(transaction_date, withdrawal_ts)');
      expect(withdrawalsQuery).not.toContain('deposit_ts');
    });

    it('core reflete a janela núcleo: dentro de [coreFrom, coreTo) é true, fora (mas na janela alargada) é false', async () => {
      const clickhouseMock = buildClickhouseMock(
        [
          {
            document_id: 'dep-core',
            external_key: 'ext-1',
            occurred_at: '2026-08-15 12:00:00.000',
            amount: '50.00',
          },
          {
            document_id: 'dep-edge',
            external_key: 'ext-2',
            occurred_at: '2026-08-14 12:00:00.000',
            amount: '50.00',
          },
        ],
        [],
      );
      const service = new PlatformMovementsService(clickhouseMock as never);

      const movements = await service.fetchMovements(buildWindow());
      const byKey = new Map(movements.map((m) => [m.key, m]));

      expect(byKey.get('dep-core')?.core).toBe(true);
      expect(byKey.get('dep-edge')?.core).toBe(false);
    });

    it('sem gateway_external_id: externalKey fica undefined, nunca string vazia', async () => {
      const clickhouseMock = buildClickhouseMock(
        [
          {
            document_id: 'dep-sem-chave',
            external_key: '',
            occurred_at: '2026-08-15 12:00:00.000',
            amount: '10.00',
          },
        ],
        [],
      );
      const service = new PlatformMovementsService(clickhouseMock as never);

      const [movement] = await service.fetchMovements(buildWindow());

      expect(movement.externalKey).toBeUndefined();
    });

    it('não filtra source_system — depósito de outro canal (enigma) na mesma conta não pode ficar de fora', async () => {
      const clickhouseMock = buildClickhouseMock([], []);
      const service = new PlatformMovementsService(clickhouseMock as never);

      await service.fetchMovements(buildWindow());

      const [depositsQuery] = clickhouseMock.query.mock.calls[0] as [string, unknown];
      const [withdrawalsQuery] = clickhouseMock.query.mock.calls[1] as [string, unknown];

      expect(depositsQuery).not.toContain('source_system');
      expect(withdrawalsQuery).not.toContain('source_system');
    });

    it('datas e marca sempre via query_params, nunca interpolados na string da query', async () => {
      const clickhouseMock = buildClickhouseMock([], []);
      const service = new PlatformMovementsService(clickhouseMock as never);

      await service.fetchMovements(buildWindow({ brand: 'maxima' }));

      const [depositsQuery, depositsParams] = clickhouseMock.query.mock.calls[0] as [
        string,
        Record<string, string>,
      ];

      expect(depositsQuery).not.toContain('maxima');
      expect(depositsQuery).not.toContain('2026-08-14');
      expect(depositsParams).toEqual({
        marca: 'maxima',
        dia_inicio: '2026-08-14',
        dia_fim: '2026-08-16',
        inicio: '2026-08-14T00:00:00.000Z',
        fim: '2026-08-16T00:00:00.000Z',
      });
    });
  });

  describe('isConfigured', () => {
    it('reflete ClickHouseService.isConfigured', () => {
      const service = new PlatformMovementsService({ isConfigured: false } as never);
      expect(service.isConfigured).toBe(false);
    });
  });
});
