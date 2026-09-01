import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { FinanceInitialSchema1788210289000 } from '../../../database/migrations/1788210289000-FinanceInitialSchema';
import { CashBalanceBankEntry } from '../entities/cash-balance-bank-entry.entity';
import { CashBalanceBrandSnapshot } from '../entities/cash-balance-brand-snapshot.entity';
import { CashBalanceDaily } from '../entities/cash-balance-daily.entity';
import { CashBalanceDay } from '../entities/cash-balance-day.entity';
import { TrioClosingBalance } from '../entities/trio-closing-balance.entity';
import { FinanceAuditLog } from '../entities/finance-audit-log.entity';
import { CashBalanceRepository, type RegisterBrandParams } from './cash-balance.repository';

jest.setTimeout(120_000);

interface StatusRow {
  status: string;
}

describe('CashBalanceRepository (Postgres real via testcontainers)', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let repository: CashBalanceRepository;

  const buildRegisterParams = (
    overrides: Partial<RegisterBrandParams> = {},
  ): RegisterBrandParams => ({
    referenceDate: '2026-08-15',
    brand: 'suprema',
    tenantId: 'tenant-suprema',
    userId: 'operador-1',
    trioBalance: 1000,
    manualBalances: new Map([['caixa', 500]]),
    saldoJogadores: 300,
    saldoTransacional: 1500,
    totalBalanco: 1200,
    depositsTotal: 800,
    withdrawalsTotal: 200,
    requiredBrands: 3,
    ...overrides,
  });

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    dataSource = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
      entities: [
        CashBalanceDay,
        CashBalanceDaily,
        CashBalanceBankEntry,
        CashBalanceBrandSnapshot,
        TrioClosingBalance,
        FinanceAuditLog,
      ],
      migrations: [FinanceInitialSchema1788210289000],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    repository = new CashBalanceRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await postgres?.stop();
  });

  afterEach(async () => {
    await dataSource.query(
      'TRUNCATE cash_balance_bank_entries, cash_balance_brand_snapshots, cash_balance_daily, cash_balance_days RESTART IDENTITY CASCADE',
    );
  });

  describe('registerBrand', () => {
    it('é atômico: falha no meio da transação não deixa nenhuma linha gravada (rollback completo)', async () => {
      const params = buildRegisterParams({
        manualBalances: new Map([
          ['caixa', 500],
          // Nome de banco > 50 caracteres viola o varchar(50) da coluna —
          // constraint real do Postgres, não um mock de falha.
          ['x'.repeat(60), 100],
        ]),
      });

      await expect(repository.registerBrand(params)).rejects.toThrow();

      const days = await dataSource.query<unknown[]>('SELECT * FROM cash_balance_days');
      const dailies = await dataSource.query<unknown[]>('SELECT * FROM cash_balance_daily');
      const entries = await dataSource.query<unknown[]>('SELECT * FROM cash_balance_bank_entries');

      expect(days).toHaveLength(0);
      expect(dailies).toHaveLength(0);
      expect(entries).toHaveLength(0);
    });

    it('fecha o dia só quando as 3 marcas estão confirmadas', async () => {
      const first = await repository.registerBrand(buildRegisterParams({ brand: 'suprema' }));
      expect(first.dayClosed).toBe(false);

      const second = await repository.registerBrand(buildRegisterParams({ brand: 'ultra' }));
      expect(second.dayClosed).toBe(false);

      const day = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-15'`,
      );
      expect(day[0].status).toBe('OPEN');

      const third = await repository.registerBrand(buildRegisterParams({ brand: 'maxima' }));
      expect(third.dayClosed).toBe(true);

      const closedDay = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-15'`,
      );
      expect(closedDay[0].status).toBe('CLOSED');
    });
  });

  describe('recomputeMonthlyAccumulated', () => {
    it('é soma corrente em ordem de data — dia inserido fora de ordem não conta dias posteriores', async () => {
      // Inserção deliberadamente fora de ordem cronológica: dia 20, depois 05, depois 10.
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-20', totalBalanco: 100 }),
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-05', totalBalanco: 50 }),
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', totalBalanco: 30 }),
      );

      await repository.recomputeMonthlyAccumulated('2026-08-15');

      const rows = await dataSource.query<{ reference_date: string; acumulado_mensal: string }[]>(
        `SELECT d.reference_date::text, s.acumulado_mensal
         FROM cash_balance_brand_snapshots s
         JOIN cash_balance_daily d ON d.id = s.daily_id
         ORDER BY d.reference_date ASC`,
      );

      // Ordem cronológica: 05 (50) → 10 (50+30=80) → 20 (80+100=180).
      expect(rows.map((row) => Number(row.acumulado_mensal))).toEqual([50, 80, 180]);
    });
  });

  describe('findLastKnownBalances', () => {
    it('usa exatamente 2 queries, nunca uma por marca', async () => {
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', brand: 'suprema' }),
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', brand: 'ultra' }),
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', brand: 'maxima' }),
      );

      const querySpy = jest.spyOn(dataSource, 'query');
      querySpy.mockClear();

      await repository.findLastKnownBalances(['suprema', 'ultra'], '2026-08-15');
      const countWithTwoBrands = querySpy.mock.calls.length;

      querySpy.mockClear();
      await repository.findLastKnownBalances(['suprema', 'ultra', 'maxima'], '2026-08-15');
      const countWithThreeBrands = querySpy.mock.calls.length;

      expect(countWithTwoBrands).toBe(2);
      expect(countWithThreeBrands).toBe(2);

      querySpy.mockRestore();
    });
  });

  describe('reopenBrand', () => {
    it('reabre a marca (DRAFT) e o dia (OPEN) na mesma transação — nunca um sem o outro', async () => {
      await repository.registerBrand(buildRegisterParams({ brand: 'suprema' }));
      await repository.registerBrand(buildRegisterParams({ brand: 'ultra' }));
      await repository.registerBrand(buildRegisterParams({ brand: 'maxima' }));

      const closedDay = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-15'`,
      );
      expect(closedDay[0].status).toBe('CLOSED');

      const reopened = await repository.reopenBrand('2026-08-15', 'suprema');
      expect(reopened).toBe(true);

      const daily = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_daily WHERE reference_date = '2026-08-15' AND brand = 'suprema'`,
      );
      const day = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-15'`,
      );

      expect(daily[0].status).toBe('DRAFT');
      expect(day[0].status).toBe('OPEN');
    });
  });
});
