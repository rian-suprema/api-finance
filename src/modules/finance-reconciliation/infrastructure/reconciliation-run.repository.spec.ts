import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { FinanceInitialSchema1788210289000 } from '../../../database/migrations/1788210289000-FinanceInitialSchema';
import { ReconciliationItem } from '../entities/reconciliation-item.entity';
import { ReconciliationRun } from '../entities/reconciliation-run.entity';
import { ReconciliationMatchKey, ReconciliationRunStatus } from '../reconciliation.enums';
import { ReconciliationRunRepository } from './reconciliation-run.repository';

jest.setTimeout(120_000);

describe('ReconciliationRunRepository (Postgres real via testcontainers)', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let repository: ReconciliationRunRepository;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    dataSource = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
      // A migration é SQL explícito (não depende de metadata de entidade) — só as
      // entidades deste módulo entram aqui. Registrar entidades de
      // finance-cash-balance seria import direto de outro módulo sem
      // necessidade real (decisão 10 do CLAUDE.md).
      entities: [ReconciliationRun, ReconciliationItem],
      migrations: [FinanceInitialSchema1788210289000],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    repository = new ReconciliationRunRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await postgres?.stop();
  });

  afterEach(async () => {
    await dataSource.query(
      'TRUNCATE reconciliation_items, reconciliation_runs RESTART IDENTITY CASCADE',
    );
  });

  const startRunParams = (
    overrides: Partial<Parameters<ReconciliationRunRepository['startRun']>[0]> = {},
  ) => ({
    referenceDate: '2026-08-15',
    brand: 'suprema',
    bank: 'trio',
    matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
    ...overrides,
  });

  describe('startRun', () => {
    it('é upsert por (referenceDate, brand, bank): chamar duas vezes preserva o id da primeira execução', async () => {
      const firstId = await repository.startRun(startRunParams());
      const secondId = await repository.startRun(startRunParams());

      expect(secondId).toBe(firstId);

      const rows = await dataSource.query<{ id: number }[]>('SELECT id FROM reconciliation_runs');
      expect(rows).toHaveLength(1);
    });

    it('reaproveita a linha em RUNNING mesmo depois de FAILED, limpando finished_at/error', async () => {
      const runId = await repository.startRun(startRunParams());
      await repository.failRun(runId, 'Trio indisponível');

      const restartedId = await repository.startRun(startRunParams());
      expect(restartedId).toBe(runId);

      const rows = await dataSource.query<
        { status: string; finished_at: string | null; error: string | null }[]
      >('SELECT status, finished_at, error FROM reconciliation_runs WHERE id = $1', [runId]);
      expect(rows[0].status).toBe(ReconciliationRunStatus.RUNNING);
      expect(rows[0].finished_at).toBeNull();
      expect(rows[0].error).toBeNull();
    });
  });

  describe('findRuns', () => {
    it('devolve os totais indexados por marca', async () => {
      await repository.startRun(startRunParams({ brand: 'suprema' }));
      await repository.startRun(startRunParams({ brand: 'ultra' }));

      const runs = await repository.findRuns('2026-08-15', ['suprema', 'ultra', 'maxima']);

      expect(runs.size).toBe(2);
      expect(runs.get('suprema')?.status).toBe(ReconciliationRunStatus.RUNNING);
      expect(runs.get('maxima')).toBeUndefined();
    });
  });

  describe('findRunsInRange', () => {
    it('agrega no intervalo, indexado por dia|marca', async () => {
      await repository.startRun(startRunParams({ referenceDate: '2026-08-14', brand: 'suprema' }));
      await repository.startRun(startRunParams({ referenceDate: '2026-08-15', brand: 'suprema' }));

      const runs = await repository.findRunsInRange(['suprema'], '2026-08-14', '2026-08-15');

      expect(runs.size).toBe(2);
      expect(runs.get('2026-08-15|suprema')?.status).toBe(ReconciliationRunStatus.RUNNING);
    });
  });
});
