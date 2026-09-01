import { ClickHouseReadService } from './clickhouse-read.service';

describe('ClickHouseReadService', () => {
  const buildClickhouseMock = (rows: unknown[]) => ({
    isConfigured: true,
    query: jest.fn().mockResolvedValue(rows),
  });

  describe('fetchPlayersBalances', () => {
    it('parseia saldo_financeiro_total_disponivel_apostadores como number, nunca como string crua', async () => {
      const clickhouseMock = buildClickhouseMock([{ marca: 'Suprema', saldo: '123456.78' }]);
      const service = new ClickHouseReadService(clickhouseMock as never);

      const balances = await service.fetchPlayersBalances('2026-08-15');

      const value = balances.get('suprema');
      expect(typeof value).toBe('number');
      expect(value).toBeCloseTo(123456.78);
    });
  });

  describe('normalização de marca', () => {
    it('marca = "Suprema" (capitalizado, como o mart devolve) mapeia para a chave "suprema"', async () => {
      const clickhouseMock = buildClickhouseMock([{ marca: 'Suprema', saldo: 100 }]);
      const service = new ClickHouseReadService(clickhouseMock as never);

      const balances = await service.fetchPlayersBalances('2026-08-15');

      expect([...balances.keys()]).toEqual(['suprema']);
    });

    it('marca fora do catálogo (BRAND_KEYS) é descartada, nunca propagada como chave inválida', async () => {
      const clickhouseMock = buildClickhouseMock([{ marca: 'Desconhecida', saldo: 100 }]);
      const service = new ClickHouseReadService(clickhouseMock as never);

      const balances = await service.fetchPlayersBalances('2026-08-15');

      expect(balances.size).toBe(0);
    });
  });

  describe('fetchDailyKpis', () => {
    it('agrupa por marca e converte totais/contagens para number', async () => {
      const clickhouseMock = buildClickhouseMock([
        {
          marca: 'Ultra',
          total_deposito: '1000.50',
          qtd_depositos: '10',
          total_saque: '200.25',
          qtd_saques: '3',
        },
      ]);
      const service = new ClickHouseReadService(clickhouseMock as never);

      const kpis = await service.fetchDailyKpis('2026-08-15');

      expect(kpis).toEqual([
        {
          brand: 'ultra',
          depositsTotal: 1000.5,
          depositsCount: 10,
          withdrawalsTotal: 200.25,
          withdrawalsCount: 3,
        },
      ]);
    });
  });

  describe('isConfigured', () => {
    it('reflete ClickHouseService.isConfigured', () => {
      const configured = new ClickHouseReadService({
        isConfigured: true,
        query: jest.fn(),
      } as never);
      const notConfigured = new ClickHouseReadService({
        isConfigured: false,
        query: jest.fn(),
      } as never);

      expect(configured.isConfigured).toBe(true);
      expect(notConfigured.isConfigured).toBe(false);
    });
  });
});
