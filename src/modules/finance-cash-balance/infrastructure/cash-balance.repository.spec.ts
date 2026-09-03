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
import { lockBankEntries } from './cash-balance.repository-upserts';

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
    saldoJogadores: 300,
    depositsTotal: 800,
    withdrawalsTotal: 200,
    requiredBrands: 3,
    ...overrides,
  });

  /** Ignora as linhas travadas e devolve um mapa fixo — suficiente para os
   *  testes que não exercitam a extração em si (essa é responsabilidade do
   *  use-case, Fase 09; aqui testamos o repositório). */
  const buildResolveManualBalances =
    (map: Map<string, number> = new Map([['caixa', 500]])) =>
    () =>
      map;

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
      const params = buildRegisterParams();
      const resolveManualBalances = buildResolveManualBalances(
        new Map([
          ['caixa', 500],
          // Nome de banco > 50 caracteres viola o varchar(50) da coluna —
          // constraint real do Postgres, não um mock de falha.
          ['x'.repeat(60), 100],
        ]),
      );

      await expect(repository.registerBrand(params, resolveManualBalances)).rejects.toThrow();

      const days = await dataSource.query<unknown[]>('SELECT * FROM cash_balance_days');
      const dailies = await dataSource.query<unknown[]>('SELECT * FROM cash_balance_daily');
      const entries = await dataSource.query<unknown[]>('SELECT * FROM cash_balance_bank_entries');

      expect(days).toHaveLength(0);
      expect(dailies).toHaveLength(0);
      expect(entries).toHaveLength(0);
    });

    it('fecha o dia só quando as 3 marcas estão confirmadas', async () => {
      const first = await repository.registerBrand(
        buildRegisterParams({ brand: 'suprema' }),
        buildResolveManualBalances(),
      );
      expect(first.dayClosed).toBe(false);

      const second = await repository.registerBrand(
        buildRegisterParams({ brand: 'ultra' }),
        buildResolveManualBalances(),
      );
      expect(second.dayClosed).toBe(false);

      const day = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-15'`,
      );
      expect(day[0].status).toBe('OPEN');

      const third = await repository.registerBrand(
        buildRegisterParams({ brand: 'maxima' }),
        buildResolveManualBalances(),
      );
      expect(third.dayClosed).toBe(true);

      const closedDay = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-15'`,
      );
      expect(closedDay[0].status).toBe('CLOSED');
    });

    it('SELECT ... FOR UPDATE em cash_balance_bank_entries bloqueia uma escrita concorrente até o commit — prova decisiva, não coincidência de timing', async () => {
      // Prova em 2 partes:
      // (1) estrutural — já confirmado por leitura de código: registerBrand
      //     chama lockBankEntries ANTES do callback e de qualquer upsert.
      // (2) decisiva — este teste — a MESMA função lockBankEntries usada por
      //     registerBrand bloqueia de verdade uma escrita concorrente na
      //     mesma linha, até o commit/rollback da transação que a travou.
      //     Controle explícito de transação (QueryRunner), não Promise.all:
      //     um Promise.all entre chamadas de repositório inteiras não prova
      //     nada por si — a primeira verificação (removendo o .setLock e
      //     rodando 5x) mostrou o teste anterior passando igual sem o lock,
      //     pura coincidência de agendamento do Node/driver.
      const referenceDate = '2026-08-16';
      const brand = 'suprema' as const;

      await repository.confirmBank({
        referenceDate,
        brand,
        tenantId: 'tenant-suprema',
        bank: 'caixa',
        balance: 500,
        userId: 'operador-1',
      });

      const [{ id: dailyId }] = await dataSource.query<{ id: number }[]>(
        `SELECT id FROM cash_balance_daily WHERE reference_date = $1 AND brand = $2`,
        [referenceDate, brand],
      );

      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // Mesma trava que registerBrand usa (lockBankEntries), com transação
      // mantida ABERTA de propósito para testar o bloqueio.
      await lockBankEntries(queryRunner.manager, dailyId);

      let confirmCompleted = false;
      const confirmPromise = repository
        .confirmBank({
          referenceDate,
          brand,
          tenantId: 'tenant-suprema',
          bank: 'caixa',
          balance: 999,
          userId: 'operador-2',
        })
        .then(() => {
          confirmCompleted = true;
        });

      // Enquanto a transação que travou a linha está aberta, a confirmação
      // concorrente NÃO PODE ter terminado — se terminasse, o lock é inerte.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(confirmCompleted).toBe(false);

      await queryRunner.commitTransaction();
      await queryRunner.release();

      await confirmPromise;
      expect(confirmCompleted).toBe(true);

      const [{ balance }] = await dataSource.query<{ balance: string }[]>(
        `SELECT balance FROM cash_balance_bank_entries WHERE daily_id = $1 AND bank = 'caixa'`,
        [dailyId],
      );
      expect(Number(balance)).toBe(999);
    });
  });

  describe('recomputeMonthlyAccumulated', () => {
    it('é soma corrente em ordem de data — dia inserido fora de ordem não conta dias posteriores', async () => {
      // totalBalanco = trioBalance - saldoJogadores (manual vazio, jogadores
      // zerado) — forma direta de controlar o total sem depender de soma manual.
      const noManualBalances = buildResolveManualBalances(new Map());

      // Inserção deliberadamente fora de ordem cronológica: dia 20, depois 05, depois 10.
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-20', trioBalance: 100, saldoJogadores: 0 }),
        noManualBalances,
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-05', trioBalance: 50, saldoJogadores: 0 }),
        noManualBalances,
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', trioBalance: 30, saldoJogadores: 0 }),
        noManualBalances,
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
        buildResolveManualBalances(),
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', brand: 'ultra' }),
        buildResolveManualBalances(),
      );
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-10', brand: 'maxima' }),
        buildResolveManualBalances(),
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

  describe('closeCompleteDays', () => {
    it('fecha, em ordem cronológica, os dias com as 3 marcas confirmadas — contra Postgres real (::text no raw SQL)', async () => {
      // Cenário só alcançável fora do fluxo normal de registerBrand (que já
      // fecha o dia sozinho na 3ª marca): usado pelo import-balance-history,
      // que grava snapshots diretos e precisa fechar retroativamente. Simula
      // isso registrando e depois reabrindo só o `cash_balance_days.status`,
      // deixando as 3 marcas CONFIRMED em `cash_balance_daily`.
      for (const date of ['2026-08-12', '2026-08-05']) {
        for (const brand of ['suprema', 'ultra', 'maxima'] as const) {
          await repository.registerBrand(
            buildRegisterParams({ referenceDate: date, brand }),
            buildResolveManualBalances(),
          );
        }
      }
      await dataSource.query(
        `UPDATE cash_balance_days SET status = 'OPEN' WHERE reference_date IN ('2026-08-12', '2026-08-05')`,
      );

      // Sem o `::text` no SELECT raw de closeCompleteDays, `reference_date` volta
      // `Date` do driver `pg`, e `.localeCompare` (usado no sort do retorno)
      // lançaria `TypeError: a.localeCompare is not a function` aqui.
      const closed = await repository.closeCompleteDays(
        '2026-08-01',
        '2026-08-15',
        3,
        'operador-1',
      );

      expect(closed).toEqual(['2026-08-05', '2026-08-12']);

      const days = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date IN ('2026-08-05', '2026-08-12')`,
      );
      expect(days.every((day) => day.status === 'CLOSED')).toBe(true);
    });

    it('não fecha dia sem as 3 marcas — devolve lista vazia, sem tocar o status', async () => {
      await repository.registerBrand(
        buildRegisterParams({ referenceDate: '2026-08-20', brand: 'suprema' }),
        buildResolveManualBalances(),
      );

      const closed = await repository.closeCompleteDays(
        '2026-08-01',
        '2026-08-31',
        3,
        'operador-1',
      );

      expect(closed).toEqual([]);
      const day = await dataSource.query<StatusRow[]>(
        `SELECT status FROM cash_balance_days WHERE reference_date = '2026-08-20'`,
      );
      expect(day[0].status).toBe('OPEN');
    });
  });

  describe('reopenBrand', () => {
    it('reabre a marca (DRAFT) e o dia (OPEN) na mesma transação — nunca um sem o outro', async () => {
      await repository.registerBrand(
        buildRegisterParams({ brand: 'suprema' }),
        buildResolveManualBalances(),
      );
      await repository.registerBrand(
        buildRegisterParams({ brand: 'ultra' }),
        buildResolveManualBalances(),
      );
      await repository.registerBrand(
        buildRegisterParams({ brand: 'maxima' }),
        buildResolveManualBalances(),
      );

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
