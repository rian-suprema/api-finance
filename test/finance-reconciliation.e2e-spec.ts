import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { FINANCE_RECONCILIATION } from '../src/auth/permissions.constants';
import { ReconciliationItem } from '../src/modules/finance-reconciliation/entities/reconciliation-item.entity';
import { ReconciliationRun } from '../src/modules/finance-reconciliation/entities/reconciliation-run.entity';
import {
  ReconciliationFlow,
  ReconciliationItemStatus,
  ReconciliationMatchKey,
  ReconciliationRunStatus,
  ReconciliationSide,
} from '../src/modules/finance-reconciliation/reconciliation.enums';
import { InitialSchema1754560000000 } from '../src/database/migrations/1754560000000-InitialSchema';
import { AddTenantId1755000000000 } from '../src/database/migrations/1755000000000-AddTenantId';
import { EnableRowLevelSecurity1756000000000 } from '../src/database/migrations/1756000000000-EnableRowLevelSecurity';
import { FinanceInitialSchema1788210289000 } from '../src/database/migrations/1788210289000-FinanceInitialSchema';
import { setupTestAuth, TestAuthContext } from './auth-helper';

/**
 * Teste ponta a ponta da Fase 13 (Conciliação — use-cases núcleo + API) com
 * INFRA REAL descartável (Testcontainers para Postgres). ClickHouse/Trio/
 * identidade da SayPlus são os stubs locais de `scripts/finance-dev-stubs.js`
 * — PRECISAM estar rodando (`node scripts/finance-dev-stubs.js &`) antes
 * deste arquivo.
 *
 * O golden dataset de conciliação do stub é fixo: marca `suprema`, dia
 * `2026-06-15` (`RECON_DATE` em `finance-dev-stubs.js`). Contagens travadas,
 * derivadas manualmente do dataset (ver comentário de `RECON_BANK_ROWS` no
 * stub): 4 pares casados (3 depósito + 1 saque), 7 pendências abertas, 2
 * estornos liquidados automaticamente (1 com `platformReprocessPending`).
 */

interface ReconciliationBrandBody {
  brand: string;
  status: string;
  message?: string;
  matchedCount: number;
  openCount: number;
  resolvedCount: number;
  reprocessPendingCount: number;
  totals: {
    platformDeposits: { total: number; count: number };
    bankDeposits: { total: number; count: number };
    platformWithdrawals: { total: number; count: number };
    bankWithdrawals: { total: number; count: number };
    treasury: { total: number; count: number };
    fees: { total: number; count: number };
    depositsCrossover: { total: number; count: number };
    withdrawalsCrossover: { total: number; count: number };
  };
  depositsDifference: number;
  withdrawalsDifference: number;
  reconciled: boolean;
}

interface ReconciliationBody {
  referenceDate: string;
  brands: ReconciliationBrandBody[];
}

interface HistoryDayBody {
  referenceDate: string;
  status: string;
}

interface HistoryBody {
  rangeDays: number;
  days: HistoryDayBody[];
  reconciledDays: number;
  pendingDays: number;
  missingDays: number;
}

interface ItemRow {
  id: number;
  status: string;
  resolved_by: string | null;
  note: string | null;
}

interface CorrectionCandidateBody {
  confidence: string;
  amount: number;
  difference: number;
  exact: boolean;
  note: string;
}

interface CorrectionEvidenceBody {
  itemId: number;
  clientResolved: boolean;
  candidates: CorrectionCandidateBody[];
}

interface CorrectionSearchBody {
  referenceDate: string;
  brand: string;
  searchedCount: number;
  withEvidenceCount: number;
  withoutClientCount: number;
  items: CorrectionEvidenceBody[];
}

interface CorrectionApplyBody {
  referenceDate: string;
  brand: string;
  searchedCount: number;
  resolvedCount: number;
  partialCount: number;
  withoutCandidateCount: number;
}

async function pingStub(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(
      `Stub indisponível em ${url} — rode "node scripts/finance-dev-stubs.js &" antes do test:e2e`,
    );
  }
}

describe('Finance — Conciliação Bancária (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let auth: TestAuthContext;
  let bearer: string;

  const api = () => request(app.getHttpServer() as App);
  const prefix = '/api/v1';

  const GOLDEN_DATE = '2026-06-15';

  const findOpenItem = async (side: string, flow: string): Promise<number> => {
    const rows = await dataSource.query<{ id: number }[]>(
      `SELECT id FROM reconciliation_items
       WHERE reference_date = $1 AND brand = 'suprema' AND side = $2 AND flow = $3 AND status = 'OPEN'`,
      [GOLDEN_DATE, side, flow],
    );
    expect(rows).toHaveLength(1);
    return rows[0].id;
  };

  const itemRow = async (id: number): Promise<ItemRow> => {
    const rows = await dataSource.query<ItemRow[]>(
      `SELECT id, status, resolved_by, note FROM reconciliation_items WHERE id = $1`,
      [id],
    );
    return rows[0];
  };

  /** Seed direto (fora do fluxo de `run`) para isolar a severidade do histórico. */
  const seedPendingRun = async (referenceDate: string): Promise<void> => {
    const runRepo = dataSource.getRepository(ReconciliationRun);
    const run = await runRepo.save(
      runRepo.create({
        referenceDate,
        brand: 'suprema',
        bank: 'trio',
        status: ReconciliationRunStatus.DONE,
        matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
        startedAt: new Date(),
        finishedAt: new Date(),
        platformDepositsTotal: 0,
        platformDepositsCount: 0,
        bankDepositsTotal: 0,
        bankDepositsCount: 0,
        platformWithdrawalsTotal: 0,
        platformWithdrawalsCount: 0,
        bankWithdrawalsTotal: 0,
        bankWithdrawalsCount: 0,
        treasuryTotal: 0,
        treasuryCount: 0,
        feesTotal: 0,
        feesCount: 0,
        depositsCrossoverTotal: 0,
        depositsCrossoverCount: 0,
        withdrawalsCrossoverTotal: 0,
        withdrawalsCrossoverCount: 0,
        matchedCount: 0,
        pendingCount: 1,
      }),
    );

    const itemRepo = dataSource.getRepository(ReconciliationItem);
    await itemRepo.save(
      itemRepo.create({
        runId: run.id,
        referenceDate,
        brand: 'suprema',
        bank: 'trio',
        flow: ReconciliationFlow.DEPOSIT,
        side: ReconciliationSide.PLATFORM,
        itemKey: 'seed-pending-1',
        amount: 10,
        status: ReconciliationItemStatus.OPEN,
        stillPending: true,
        platformReprocessPending: false,
      }),
    );
  };

  /**
   * Item de marca fora do catálogo — nunca aparece em `resolveBrands`, prova
   * a autorização pelo dado (§3.6). Reusa o run se já existir (chamado mais
   * de uma vez neste arquivo): `(referenceDate, brand, bank)` é chave única.
   */
  const seedForeignItem = async (itemKey: string): Promise<number> => {
    const runRepo = dataSource.getRepository(ReconciliationRun);
    const key = { referenceDate: '2026-01-01', brand: 'unknown', bank: 'trio' };
    const existingRun = await runRepo.findOne({ where: key });
    const run =
      existingRun ??
      (await runRepo.save(
        runRepo.create({
          ...key,
          status: ReconciliationRunStatus.DONE,
          matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
          startedAt: new Date(),
          finishedAt: new Date(),
          platformDepositsTotal: 0,
          platformDepositsCount: 0,
          bankDepositsTotal: 0,
          bankDepositsCount: 0,
          platformWithdrawalsTotal: 0,
          platformWithdrawalsCount: 0,
          bankWithdrawalsTotal: 0,
          bankWithdrawalsCount: 0,
          treasuryTotal: 0,
          treasuryCount: 0,
          feesTotal: 0,
          feesCount: 0,
          depositsCrossoverTotal: 0,
          depositsCrossoverCount: 0,
          withdrawalsCrossoverTotal: 0,
          withdrawalsCrossoverCount: 0,
          matchedCount: 0,
          pendingCount: 1,
        }),
      ));

    const itemRepo = dataSource.getRepository(ReconciliationItem);
    const item = await itemRepo.save(
      itemRepo.create({
        runId: run.id,
        referenceDate: '2026-01-01',
        brand: 'unknown',
        bank: 'trio',
        flow: ReconciliationFlow.DEPOSIT,
        side: ReconciliationSide.PLATFORM,
        itemKey,
        amount: 10,
        status: ReconciliationItemStatus.OPEN,
        stillPending: true,
        platformReprocessPending: false,
      }),
    );

    return item.id;
  };

  beforeAll(async () => {
    await pingStub('http://localhost:3100/auth/me');
    await pingStub('http://localhost:8123/ping');

    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    process.env.NODE_ENV = 'test';
    process.env.API_PREFIX = 'api/v1';
    process.env.DB_HOST = postgres.getHost();
    process.env.DB_PORT = String(postgres.getPort());
    process.env.DB_USERNAME = postgres.getUsername();
    process.env.DB_PASSWORD = postgres.getPassword();
    process.env.DB_NAME = postgres.getDatabase();
    process.env.DB_SSL = 'false';

    auth = setupTestAuth();
    bearer = `Bearer ${auth.sign({ permissions: Object.values(FINANCE_RECONCILIATION) })}`;

    const migrator = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
      migrations: [
        InitialSchema1754560000000,
        AddTenantId1755000000000,
        EnableRowLevelSecurity1756000000000,
        FinanceInitialSchema1788210289000,
      ],
    });
    await migrator.initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health/liveness', 'health/readiness'] });
    await app.init();

    dataSource = moduleRef.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  describe('Autenticação e autorização (cenário 13)', () => {
    it('sem Bearer → 401', async () => {
      const res = await api().get(`${prefix}/reconciliation`);
      expect(res.status).toBe(401);
    });

    it('com Bearer mas sem a permissão da rota → 403', async () => {
      const semPermissao = auth.sign({ permissions: [] });
      const res = await api()
        .get(`${prefix}/reconciliation`)
        .set('Authorization', `Bearer ${semPermissao}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /reconciliation sem execução (cenário 1)', () => {
    it('dia nunca conciliado → 200, todas as marcas NOT_RUN com mensagem', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation?date=2099-01-01`)
        .set('Authorization', bearer);
      const body = res.body as ReconciliationBody;

      expect(res.status).toBe(200);
      expect(body.brands.length).toBeGreaterThan(0);
      for (const brand of body.brands) {
        expect(brand.status).toBe('NOT_RUN');
        expect(brand.message).toBe('Conciliação deste dia ainda não foi executada');
      }
    });
  });

  describe('POST /reconciliation/run (cenários 2, 3, 4, 12)', () => {
    it('responde 202 em menos de 2s, antes da varredura terminar', async () => {
      const start = Date.now();
      const res = await api()
        .post(`${prefix}/reconciliation/run`)
        .set('Authorization', bearer)
        .send({ date: GOLDEN_DATE });
      const elapsed = Date.now() - start;

      expect(res.status).toBe(202);
      expect((res.body as { referenceDate: string }).referenceDate).toBe(GOLDEN_DATE);
      expect(elapsed).toBeLessThan(2000);
    });

    it('duas chamadas simultâneas do mesmo dia não duplicam o resultado', async () => {
      await Promise.all([
        api()
          .post(`${prefix}/reconciliation/run`)
          .set('Authorization', bearer)
          .send({ date: GOLDEN_DATE }),
        api()
          .post(`${prefix}/reconciliation/run`)
          .set('Authorization', bearer)
          .send({ date: GOLDEN_DATE }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const rows = await dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) FROM reconciliation_items WHERE reference_date = $1 AND brand = 'suprema'`,
        [GOLDEN_DATE],
      );
      // 7 pendências abertas + 2 estornos liquidados — nunca duplicado por upsert/reentrância.
      expect(Number(rows[0].count)).toBe(9);
    });

    it('após terminar: DONE com os números travados do golden dataset', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      const body = res.body as ReconciliationBody;
      const suprema = body.brands.find((b) => b.brand === 'suprema') as ReconciliationBrandBody;

      expect(res.status).toBe(200);
      expect(suprema.status).toBe('DONE');
      expect(suprema.matchedCount).toBe(4);
      expect(suprema.openCount).toBe(7);
      expect(suprema.resolvedCount).toBe(2);
      expect(suprema.reprocessPendingCount).toBe(1);
      expect(suprema.reconciled).toBe(false);

      expect(suprema.totals.platformDeposits).toEqual({ total: 175, count: 3 });
      expect(suprema.totals.bankDeposits).toEqual({ total: 170, count: 4 });
      expect(suprema.totals.platformWithdrawals).toEqual({ total: 270, count: 2 });
      expect(suprema.totals.bankWithdrawals).toEqual({ total: 430, count: 5 });
      expect(suprema.totals.treasury).toEqual({ total: 500, count: 1 });
      expect(suprema.totals.fees).toEqual({ total: 0.05, count: 1 });
      expect(suprema.totals.depositsCrossover).toEqual({ total: 12, count: 1 });
      expect(suprema.totals.withdrawalsCrossover).toEqual({ total: 0, count: 0 });

      // Invariante: diferença (banco − plataforma) = virada + pendências.
      expect(suprema.depositsDifference).toBe(-5);
      expect(suprema.withdrawalsDifference).toBe(160);
    });
  });

  describe('GET /reconciliation/history (cenários 5, 6, 7)', () => {
    beforeAll(async () => {
      // Isola a severidade NOT_RUN×PENDING num dia sem relação com o golden dataset.
      await seedPendingRun('2026-06-10');
    });

    it('cobre todo dia do intervalo, mesmo sem execução — dias sem run não são omitidos', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/history?from=2026-06-01&to=2026-06-15`)
        .set('Authorization', bearer);
      const body = res.body as HistoryBody;

      expect(res.status).toBe(200);
      expect(body.rangeDays).toBe(15);
      expect(body.days).toHaveLength(15);

      const untouchedDay = body.days.find((d) => d.referenceDate === '2026-06-01');
      expect(untouchedDay?.status).toBe('NOT_RUN');
    });

    it('severidade: dia com marca PENDING e marca NOT_RUN herda NOT_RUN (pior)', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/history?from=2026-06-01&to=2026-06-15`)
        .set('Authorization', bearer);
      const body = res.body as HistoryBody;

      // suprema PENDING nesse dia (seed), ultra/maxima nunca rodaram → dia = NOT_RUN.
      const seededDay = body.days.find((d) => d.referenceDate === '2026-06-10');
      expect(seededDay?.status).toBe('NOT_RUN');

      // O golden run rodou as 3 marcas: suprema PENDING, ultra/maxima RECONCILED → dia = PENDING.
      const goldenDay = body.days.find((d) => d.referenceDate === GOLDEN_DATE);
      expect(goldenDay?.status).toBe('PENDING');
    });

    it('missingDays conta NOT_RUN + FAILED, nunca RUNNING', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/history?from=2026-06-01&to=2026-06-15`)
        .set('Authorization', bearer);
      const body = res.body as HistoryBody;

      expect(body.pendingDays).toBe(1);
      expect(body.reconciledDays).toBe(0);
      expect(body.missingDays).toBe(body.rangeDays - body.pendingDays - body.reconciledDays);
    });
  });

  describe('POST /reconciliation/items/:id/resolve (cenários 8, 9, 11)', () => {
    it('nota < 10 caracteres → 400', async () => {
      const id = await findOpenItem('BANK', 'DEPOSIT');
      const res = await api()
        .post(`${prefix}/reconciliation/items/${id}/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'curta' });
      expect(res.status).toBe(400);
    });

    it('nota válida → 204; Postgres reflete RESOLVED com o autor do JWT', async () => {
      const id = await findOpenItem('BANK', 'DEPOSIT');
      const res = await api()
        .post(`${prefix}/reconciliation/items/${id}/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Pendência sem par na plataforma — CPF não identificado no backoffice.' });
      expect(res.status).toBe(204);

      const row = await itemRow(id);
      expect(row.status).toBe('RESOLVED');
      expect(row.resolved_by).toBe('user-test-1');
    });

    it('item já RESOLVED → 409', async () => {
      const id = await findOpenItem('PLATFORM', 'WITHDRAWAL');
      await api()
        .post(`${prefix}/reconciliation/items/${id}/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Saque sem par no extrato — em investigação com o banco.' });

      const res = await api()
        .post(`${prefix}/reconciliation/items/${id}/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Segunda tentativa de tratar a mesma pendência já tratada.' });
      expect(res.status).toBe(409);
    });

    it('item inexistente → 404', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/items/999999999/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Nota de teste com mais de dez caracteres.' });
      expect(res.status).toBe(404);
    });

    it('marca sem vínculo do usuário → 403 (autorização pelo dado, não pela URL)', async () => {
      const id = await seedForeignItem('seed-foreign-resolve');
      const res = await api()
        .post(`${prefix}/reconciliation/items/${id}/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Nota de teste com mais de dez caracteres.' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /reconciliation/items/:id/reopen (cenário 10)', () => {
    it('devolve a pendência à fila, apagando a nota', async () => {
      const id = await findOpenItem('PLATFORM', 'DEPOSIT');
      await api()
        .post(`${prefix}/reconciliation/items/${id}/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Nota temporária para depois reabrir a pendência.' });

      const res = await api()
        .post(`${prefix}/reconciliation/items/${id}/reopen`)
        .set('Authorization', bearer);
      expect(res.status).toBe(204);

      const row = await itemRow(id);
      expect(row.status).toBe('OPEN');
      expect(row.note).toBeNull();
    });

    it('marca sem vínculo do usuário → 403', async () => {
      const id = await seedForeignItem('seed-foreign-reopen');
      const res = await api()
        .post(`${prefix}/reconciliation/items/${id}/reopen`)
        .set('Authorization', bearer);
      expect(res.status).toBe(403);
    });
  });

  /**
   * As 4 pendências de saque do lado do banco, com CPF, do golden dataset
   * (`trio-man-1..4` em `finance-dev-stubs.js`): FABIO (45,00, exata via ponte
   * pix_key), GISELE (80,00, evidência parcial — correção de 30,00), HELIO
   * (15,00, CPF sem client_id conhecido) e IVONE (90,00, exata via coluna
   * `cpf` da própria correção, sem ponte). Nenhum teste anterior neste arquivo
   * toca `side=BANK, flow=WITHDRAWAL` — os 4 chegam aqui intactos.
   */
  describe('GET /reconciliation/:brand/corrections e POST .../apply (cenário 14)', () => {
    it('marca sem pendência candidata → 200, searchedCount:0', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/ultra/corrections?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      const body = res.body as CorrectionSearchBody;

      expect(res.status).toBe(200);
      expect(body.searchedCount).toBe(0);
      expect(body.items).toEqual([]);
    });

    it('suprema: 4 pendências candidatas, com os 4 diagnósticos do golden dataset', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/suprema/corrections?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      const body = res.body as CorrectionSearchBody;

      expect(res.status).toBe(200);
      expect(body.referenceDate).toBe(GOLDEN_DATE);
      expect(body.brand).toBe('suprema');
      expect(body.searchedCount).toBe(4);
      expect(body.withEvidenceCount).toBe(3);
      expect(body.withoutClientCount).toBe(1);

      const withoutClient = body.items.filter((item) => !item.clientResolved);
      expect(withoutClient).toHaveLength(1);
      expect(withoutClient[0].candidates).toEqual([]);

      const exact = body.items.filter((item) => item.candidates[0]?.exact === true);
      expect(exact).toHaveLength(2);
      for (const item of exact) {
        expect(item.candidates[0].confidence).toBe('EXACT_SAME_BRAND');
        expect(item.candidates[0].difference).toBe(0);
      }

      const partial = body.items.filter((item) => item.candidates[0]?.confidence === 'PARTIAL');
      expect(partial).toHaveLength(1);
      expect(partial[0].candidates[0].exact).toBe(false);
      expect(partial[0].candidates[0].note).toContain('Conferir:');
    });

    it('apply: dá baixa nos 2 exatos, mantém o PARTIAL aberto, autor é o sub do JWT', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/suprema/corrections/apply?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer)
        .send({ date: GOLDEN_DATE });
      const body = res.body as CorrectionApplyBody;

      expect(res.status).toBe(201);
      expect(body.searchedCount).toBe(4);
      expect(body.resolvedCount).toBe(2);
      expect(body.partialCount).toBe(1);
      expect(body.withoutCandidateCount).toBe(1);

      const openWithdrawals = await dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) FROM reconciliation_items
         WHERE reference_date = $1 AND brand = 'suprema' AND side = 'BANK' AND flow = 'WITHDRAWAL'
           AND status = 'OPEN' AND counterparty_tax_number IS NOT NULL`,
        [GOLDEN_DATE],
      );
      // As 4 candidatas menos as 2 exatas: GISELE (PARTIAL) e HELIO (sem candidato) seguem OPEN.
      expect(Number(openWithdrawals[0].count)).toBe(2);

      // FABIO (45,00) e IVONE (90,00) são os 2 exatos — os únicos com `amount` nesses
      // valores no lado BANK/WITHDRAWAL. saq-2/saq-3 (estornos, resolved_by='sistema')
      // têm outros valores, então não entram nesta contagem.
      const resolvedByOperator = await dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) FROM reconciliation_items
         WHERE reference_date = $1 AND brand = 'suprema' AND side = 'BANK' AND flow = 'WITHDRAWAL'
           AND status = 'RESOLVED' AND amount IN (45, 90) AND resolved_by = 'user-test-1'`,
        [GOLDEN_DATE],
      );
      expect(Number(resolvedByOperator[0].count)).toBe(2);
    });

    it('segunda chamada de apply é idempotente: resolvedCount:0, nota humana preservada', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/suprema/corrections/apply?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer)
        .send({ date: GOLDEN_DATE });
      const body = res.body as CorrectionApplyBody;

      expect(res.status).toBe(201);
      expect(body.resolvedCount).toBe(0);
    });
  });
});
