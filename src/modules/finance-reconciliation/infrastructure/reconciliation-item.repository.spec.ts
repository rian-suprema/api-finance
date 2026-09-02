import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { FinanceInitialSchema1788210289000 } from '../../../database/migrations/1788210289000-FinanceInitialSchema';
import type { Movement, RunTotals, SettledMovement } from '../domain/reconciliation.types';
import { ReconciliationItem } from '../entities/reconciliation-item.entity';
import { ReconciliationRun } from '../entities/reconciliation-run.entity';
import { ReconciliationItemStatus, ReconciliationMatchKey } from '../reconciliation.enums';
import { ReconciliationItemRepository } from './reconciliation-item.repository';
import { ReconciliationRunRepository } from './reconciliation-run.repository';
import type { SaveResultParams } from './reconciliation.repository.types';

jest.setTimeout(120_000);

const ZERO_SIDE = { total: 0, count: 0 };
const ZERO_TOTALS: RunTotals = {
  platformDeposits: ZERO_SIDE,
  bankDeposits: ZERO_SIDE,
  platformWithdrawals: ZERO_SIDE,
  bankWithdrawals: ZERO_SIDE,
  treasury: ZERO_SIDE,
  fees: ZERO_SIDE,
  depositsCrossover: ZERO_SIDE,
  withdrawalsCrossover: ZERO_SIDE,
};

const SCOPE = { referenceDate: '2026-08-15', brand: 'suprema', bank: 'trio' };

const buildMovement = (overrides: Partial<Movement> = {}): Movement => ({
  side: 'BANK',
  flow: 'WITHDRAWAL',
  key: 'ref-1',
  amountCents: 10_000,
  core: true,
  ...overrides,
});

const buildSettled = (
  movementOverrides: Partial<Movement> = {},
  settledOverrides: Partial<Omit<SettledMovement, 'movement'>> = {},
): SettledMovement => ({
  movement: buildMovement({
    flow: 'WITHDRAWAL',
    side: 'BANK',
    key: 'ref-refund',
    ...movementOverrides,
  }),
  note: 'estorno liquidado automaticamente — pagamento desfeito pelo banco',
  platformReprocessPending: false,
  ...settledOverrides,
});

interface ItemRow {
  id: number;
  status: ReconciliationItemStatus;
  note: string | null;
  resolved_by: string | null;
  still_pending: boolean;
  amount: string;
  platform_reprocess_pending: boolean;
  run_id: number;
}

describe('ReconciliationItemRepository (Postgres real via testcontainers)', () => {
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let runRepository: ReconciliationRunRepository;
  let repository: ReconciliationItemRepository;
  let runId: number;

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

    runRepository = new ReconciliationRunRepository(dataSource);
    repository = new ReconciliationItemRepository(dataSource, runRepository);
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

  beforeEach(async () => {
    runId = await runRepository.startRun({
      ...SCOPE,
      matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
    });
  });

  const saveResultParams = (overrides: Partial<SaveResultParams> = {}): SaveResultParams => ({
    runId,
    ...SCOPE,
    totals: ZERO_TOTALS,
    matchedCount: 0,
    pending: [],
    ...overrides,
  });

  const itemRows = async (): Promise<ItemRow[]> =>
    dataSource.query<ItemRow[]>('SELECT * FROM reconciliation_items ORDER BY id');

  describe('saveResult', () => {
    it('deleta pendência OPEN sem nota que sumiu da lista de pending', async () => {
      const movement = buildMovement({ key: 'sai-fora' });
      await repository.saveResult(saveResultParams({ pending: [movement] }));
      expect(await itemRows()).toHaveLength(1);

      await repository.saveResult(saveResultParams({ pending: [] }));

      expect(await itemRows()).toHaveLength(0);
    });

    it('vira stillPending=false (não deleta) uma pendência RESOLVED com nota que sumiu', async () => {
      const movement = buildMovement({ key: 'com-nota' });
      await repository.saveResult(saveResultParams({ pending: [movement] }));

      const [created] = await itemRows();
      await dataSource.query(
        `UPDATE reconciliation_items SET status = 'RESOLVED', note = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`,
        ['tratado manualmente pelo operador', 'operador-1', created.id],
      );

      await repository.saveResult(saveResultParams({ pending: [] }));

      const [row] = await itemRows();
      expect(row).toBeDefined();
      expect(row.status).toBe(ReconciliationItemStatus.RESOLVED);
      expect(row.still_pending).toBe(false);
      expect(row.note).toBe('tratado manualmente pelo operador');
    });

    it('upsert de pending nunca sobrescreve nota/status/autor de um item — mesmo um tratado por engano antes da regra', async () => {
      const movement = buildMovement({ key: 'engano', amountCents: 10_000 });
      await repository.saveResult(saveResultParams({ pending: [movement] }));

      const [created] = await itemRows();
      await dataSource.query(
        `UPDATE reconciliation_items SET status = 'RESOLVED', note = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`,
        ['nota escrita por engano', 'operador-2', created.id],
      );

      // O item continua em `pending` na segunda execução, com valor de fato atualizado.
      const updatedMovement = buildMovement({ key: 'engano', amountCents: 25_000 });
      await repository.saveResult(saveResultParams({ pending: [updatedMovement] }));

      const [row] = await itemRows();
      expect(row.amount).toBe('250.00');
      // nota/status/autor NUNCA são sobrescritos pelo upsert de `pending` — a
      // regra normal de tratamento roda em outro caminho (resolveItem), não aqui.
      expect(row.status).toBe(ReconciliationItemStatus.RESOLVED);
      expect(row.note).toBe('nota escrita por engano');
      expect(row.resolved_by).toBe('operador-2');
    });

    it('estornos liquidados (settled) nunca sobrescrevem nota HUMANA já registrada', async () => {
      const settled = buildSettled({ key: 'estorno-1' });
      await repository.saveResult(saveResultParams({ settled: [settled] }));

      const [afterFirstRun] = await itemRows();
      expect(afterFirstRun.resolved_by).toBe('sistema');

      // Um operador humano registra a própria nota sobre a mesma linha.
      await dataSource.query(
        `UPDATE reconciliation_items SET note = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`,
        [
          'investigado — reprocessamento já solicitado ao time de pagamentos',
          'operador-3',
          afterFirstRun.id,
        ],
      );

      // Reexecução: o mesmo estorno reaparece em `settled`.
      await repository.saveResult(saveResultParams({ settled: [settled] }));

      const [row] = await itemRows();
      expect(row.note).toBe('investigado — reprocessamento já solicitado ao time de pagamentos');
      expect(row.resolved_by).toBe('operador-3');
    });

    it('platformReprocessPending é recalculado a cada execução — some quando o estorno reaparece sem o sinalizador', async () => {
      const settled = buildSettled({ key: 'estorno-2' }, { platformReprocessPending: true });
      await repository.saveResult(saveResultParams({ settled: [settled] }));

      const [afterFirstRun] = await itemRows();
      expect(afterFirstRun.platform_reprocess_pending).toBe(true);

      const settledResolved = buildSettled(
        { key: 'estorno-2' },
        { platformReprocessPending: false },
      );
      await repository.saveResult(saveResultParams({ settled: [settledResolved] }));

      const [row] = await itemRows();
      expect(row.platform_reprocess_pending).toBe(false);
    });

    it('recalcula pending_count do run ao gravar', async () => {
      const movements = [
        buildMovement({ key: 'p1', side: 'BANK' }),
        buildMovement({ key: 'p2', side: 'PLATFORM' }),
      ];
      await repository.saveResult(saveResultParams({ pending: movements, matchedCount: 3 }));

      const runs = await dataSource.query<{ pending_count: number; matched_count: number }[]>(
        'SELECT pending_count, matched_count FROM reconciliation_runs WHERE id = $1',
        [runId],
      );
      expect(runs[0].pending_count).toBe(2);
      expect(runs[0].matched_count).toBe(3);
    });
  });

  describe('resolveItem / reopenItem', () => {
    it('resolveItem recalcula pending_count do run correspondente', async () => {
      const movements = [buildMovement({ key: 'a' }), buildMovement({ key: 'b' })];
      await repository.saveResult(saveResultParams({ pending: movements }));

      const [first] = await itemRows();
      await repository.resolveItem({
        id: first.id,
        note: 'conferido no extrato',
        userId: 'operador-4',
      });

      const runs = await dataSource.query<{ pending_count: number }[]>(
        'SELECT pending_count FROM reconciliation_runs WHERE id = $1',
        [runId],
      );
      expect(runs[0].pending_count).toBe(1);
    });

    it('reopenItem devolve a pendência para a fila e recalcula pending_count', async () => {
      const movement = buildMovement({ key: 'c' });
      await repository.saveResult(saveResultParams({ pending: [movement] }));

      const [item] = await itemRows();
      await repository.resolveItem({ id: item.id, note: 'nota qualquer', userId: 'operador-5' });
      await repository.reopenItem(item.id);

      const [row] = await itemRows();
      expect(row.status).toBe(ReconciliationItemStatus.OPEN);
      expect(row.note).toBeNull();
      expect(row.resolved_by).toBeNull();

      const runs = await dataSource.query<{ pending_count: number }[]>(
        'SELECT pending_count FROM reconciliation_runs WHERE id = $1',
        [runId],
      );
      expect(runs[0].pending_count).toBe(1);
    });
  });

  describe('resolveItems (baixa em lote)', () => {
    it('é idempotente: a segunda chamada com os mesmos ids não altera nada e resolvedCount é 0', async () => {
      const movements = [buildMovement({ key: 'lote-1' }), buildMovement({ key: 'lote-2' })];
      await repository.saveResult(saveResultParams({ pending: movements }));

      const rows = await itemRows();
      const ids = rows.map((row) => row.id);
      const noteById = new Map(ids.map((id) => [id, 'baixa em lote']));

      const firstCount = await repository.resolveItems({ ids, noteById, userId: 'operador-6' });
      expect(firstCount).toBe(2);

      const secondCount = await repository.resolveItems({ ids, noteById, userId: 'operador-6' });
      expect(secondCount).toBe(0);

      const afterSecond = await itemRows();
      expect(afterSecond.every((row) => row.note === 'baixa em lote')).toBe(true);
    });
  });

  describe('countItemsInRange / findRunsInRange', () => {
    it('agrega no banco por dia|marca — sem trazer nenhuma linha de item', async () => {
      const runIdDay1 = runId;
      await repository.saveResult(
        saveResultParams({
          runId: runIdDay1,
          pending: [buildMovement({ key: 'd1-open', amountCents: 5_000 })],
        }),
      );

      const runIdDay2 = await runRepository.startRun({
        referenceDate: '2026-08-16',
        brand: 'suprema',
        bank: 'trio',
        matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
      });
      await repository.saveResult(
        saveResultParams({
          runId: runIdDay2,
          referenceDate: '2026-08-16',
          pending: [buildMovement({ key: 'd2-open-1', amountCents: 3_000 })],
          settled: [buildSettled({ key: 'd2-settled' })],
        }),
      );

      const counts = await repository.countItemsInRange(['suprema'], '2026-08-15', '2026-08-16');

      expect(counts.get('2026-08-15|suprema')).toEqual({ open: 1, openAmount: 50, resolved: 0 });
      expect(counts.get('2026-08-16|suprema')).toEqual({ open: 1, openAmount: 30, resolved: 1 });

      const runs = await runRepository.findRunsInRange(['suprema'], '2026-08-15', '2026-08-16');
      expect(runs.size).toBe(2);
    });
  });

  describe('findItemsForCorrectionSearch', () => {
    it('só devolve item side=BANK, flow=WITHDRAWAL, status=OPEN, stillPending=true, com CPF da contraparte', async () => {
      const candidate = buildMovement({
        key: 'candidato',
        side: 'BANK',
        flow: 'WITHDRAWAL',
        counterpartyTaxNumber: '12345678901',
      });
      const deposit = buildMovement({
        key: 'deposito',
        side: 'BANK',
        flow: 'DEPOSIT',
        counterpartyTaxNumber: '12345678901',
      });
      const treasury = buildMovement({
        key: 'tesouraria',
        side: 'BANK',
        flow: 'TREASURY',
        counterpartyTaxNumber: '12345678901',
      });
      const withoutTaxNumber = buildMovement({ key: 'sem-cpf', side: 'BANK', flow: 'WITHDRAWAL' });
      const platformSide = buildMovement({
        key: 'lado-plataforma',
        side: 'PLATFORM',
        flow: 'WITHDRAWAL',
        counterpartyTaxNumber: '12345678901',
      });

      await repository.saveResult(
        saveResultParams({
          pending: [candidate, deposit, treasury, withoutTaxNumber, platformSide],
        }),
      );

      const results = await repository.findItemsForCorrectionSearch({
        referenceDate: SCOPE.referenceDate,
        brand: SCOPE.brand,
      });

      expect(results).toHaveLength(1);
      expect(results[0].taxNumber).toBe('12345678901');
    });
  });
});
