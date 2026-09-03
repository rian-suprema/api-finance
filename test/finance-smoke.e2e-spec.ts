import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { FINANCE_CASH_BALANCE, FINANCE_RECONCILIATION } from '../src/auth/permissions.constants';
import { TrioClosingBalanceMethod } from '../src/modules/finance-cash-balance/cash-balance.enums';
import { TrioClosingBalance } from '../src/modules/finance-cash-balance/entities/trio-closing-balance.entity';
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
 * Fase 17 — "smoke test" completo: as verificações do `scripts/smoke-test.js`
 * da origem, portadas e parametrizadas (`it.each`) contra o catálogo
 * consolidado de `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §6, em vez
 * de 190 blocos literais. Cobre a SUPERFÍCIE comum às 14 rotas (401, 403 por
 * permissão, 400 de whitelist, marca inválida, data inválida) — os fluxos de
 * negócio ponta a ponta (registro completo, conciliação golden dataset) vivem
 * em `finance-cash-balance.e2e-spec.ts`/`finance-reconciliation.e2e-spec.ts`,
 * não aqui, para não duplicar.
 *
 * Linhas do catálogo §6 deliberadamente NÃO cobertas aqui, com o motivo:
 * - `429` (rate limit): removido do catálogo na Fase 17 — não existe
 *   `ThrottlerGuard` nem limite de rota em nenhuma camada (app ou ingress)
 *   neste destino. Divergência documentada em §8; decisão do usuário foi
 *   documentar, não implementar, nesta trilha.
 * - `500` genérico (nunca stack trace): já é coberto por teste unitário do
 *   `GlobalExceptionFilter` (Fase 03) — forçar um 500 genuíno em e2e exigiria
 *   sabotar código de produção só para o teste, o que o projeto evita.
 * - `503 Saldo de jogadores indisponível` (texto exato, caminho
 *   `!clickhouse.isConfigured`) e `503 Integração com o data warehouse não
 *   configurada` (mesmo caminho, lado conciliação): `CLICKHOUSE_URL` é
 *   `.required()` no Joi (fail-fast, decisão 7 do CLAUDE.md), então
 *   `isConfigured` é sempre `true` em qualquer app de pé — o próprio
 *   `clickhouse.service.ts` documenta isso como caminho só alcançável em
 *   teste unitário com config mockada. Em e2e, "ClickHouse fora" só é
 *   alcançável como falha de CONEXÃO (porta fechada), que devolve a mensagem
 *   genérica `Data warehouse indisponível` — é essa variante que os testes
 *   abaixo cobrem.
 * - `503 Saldo de jogadores... não encontrado para a data`: inalcançável via
 *   stub real — `PLAYERS_ROWS` sempre cobre as 3 marcas do catálogo.
 */

interface ErrorBody {
  code: string;
  message: string;
}

interface StatusRow {
  status: string;
}

const MANUAL_BANKS = ['caixa', 'onekey', 'zro', 'celcoin', 'okto', 'topazio', 'genial'];

const ALL_PERMISSIONS = [
  ...Object.values(FINANCE_CASH_BALANCE),
  ...Object.values(FINANCE_RECONCILIATION),
];

async function pingStub(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(
      `Stub indisponível em ${url} — rode "node scripts/finance-dev-stubs.js &" antes do test:e2e`,
    );
  }
}

/** Descreve uma das 14 rotas de negócio para os `it.each` de superfície comum. */
interface RouteCase {
  readonly name: string;
  readonly method: 'get' | 'post';
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

const ALL_ROUTES: readonly RouteCase[] = [
  { name: '1 GET /cash-balance/summary', method: 'get', path: '/cash-balance/summary' },
  { name: '2 GET /cash-balance/banks', method: 'get', path: '/cash-balance/banks' },
  { name: '3 GET /cash-balance/history', method: 'get', path: '/cash-balance/history' },
  { name: '4 GET /cash-balance/trio/refresh', method: 'get', path: '/cash-balance/trio/refresh' },
  {
    name: '5 POST /cash-balance/:brand/banks/:bank/confirm',
    method: 'post',
    path: '/cash-balance/suprema/banks/caixa/confirm',
    body: { balance: 100 },
  },
  {
    name: '6 POST /cash-balance/:brand/register',
    method: 'post',
    path: '/cash-balance/suprema/register',
    body: {},
  },
  {
    name: '7 POST /cash-balance/:brand/reopen',
    method: 'post',
    path: '/cash-balance/suprema/reopen',
    body: {},
  },
  { name: '8 GET /reconciliation', method: 'get', path: '/reconciliation' },
  { name: '9 GET /reconciliation/history', method: 'get', path: '/reconciliation/history' },
  { name: '10 POST /reconciliation/run', method: 'post', path: '/reconciliation/run', body: {} },
  {
    name: '11 GET /reconciliation/:brand/corrections',
    method: 'get',
    path: '/reconciliation/suprema/corrections',
  },
  {
    name: '12 POST /reconciliation/:brand/corrections/apply',
    method: 'post',
    path: '/reconciliation/suprema/corrections/apply',
    body: {},
  },
  {
    name: '13 POST /reconciliation/items/:id/resolve',
    method: 'post',
    path: '/reconciliation/items/999999999/resolve',
    body: { note: 'Nota de teste com mais de dez caracteres.' },
  },
  {
    name: '14 POST /reconciliation/items/:id/reopen',
    method: 'post',
    path: '/reconciliation/items/999999999/reopen',
  },
];

/** As 5 rotas que recebem `:brand` na URL e passam por `BrandAccessService.requireBrand`. */
interface BrandRouteCase {
  readonly name: string;
  readonly method: 'get' | 'post';
  readonly path: (brand: string) => string;
  readonly body?: Record<string, unknown>;
}

const BRAND_ROUTES: readonly BrandRouteCase[] = [
  {
    name: '5 confirm',
    method: 'post',
    path: (brand) => `/cash-balance/${brand}/banks/caixa/confirm`,
    body: { balance: 100 },
  },
  {
    name: '6 register',
    method: 'post',
    path: (brand) => `/cash-balance/${brand}/register`,
    body: {},
  },
  { name: '7 reopen', method: 'post', path: (brand) => `/cash-balance/${brand}/reopen`, body: {} },
  {
    name: '11 corrections',
    method: 'get',
    path: (brand) => `/reconciliation/${brand}/corrections`,
  },
  {
    name: '12 corrections/apply',
    method: 'post',
    path: (brand) => `/reconciliation/${brand}/corrections/apply`,
    body: {},
  },
];

/** As 6 rotas com `@Body()` ligado a um DTO — só elas participam do `forbidNonWhitelisted`. */
const BODY_ROUTES: readonly RouteCase[] = [
  {
    name: '5 confirm',
    method: 'post',
    path: '/cash-balance/suprema/banks/caixa/confirm',
    body: { balance: 100 },
  },
  { name: '6 register', method: 'post', path: '/cash-balance/suprema/register', body: {} },
  { name: '7 reopen', method: 'post', path: '/cash-balance/suprema/reopen', body: {} },
  { name: '10 run', method: 'post', path: '/reconciliation/run', body: {} },
  {
    name: '12 apply',
    method: 'post',
    path: '/reconciliation/suprema/corrections/apply',
    body: {},
  },
  {
    name: '13 resolve',
    method: 'post',
    path: '/reconciliation/items/999999999/resolve',
    body: { note: 'Nota de teste com mais de dez caracteres.' },
  },
];

const ZERO_RUN_TOTALS = {
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
};

describe('Finance — smoke test completo (e2e, Fase 17)', () => {
  let app: INestApplication;
  let appIdentityDown: INestApplication;
  let appWarehouseDown: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let auth: TestAuthContext;
  let bearer: string;

  const api = () => request(app.getHttpServer() as App);
  const apiIdentityDown = () => request(appIdentityDown.getHttpServer() as App);
  const apiWarehouseDown = () => request(appWarehouseDown.getHttpServer() as App);
  const prefix = '/api/v1';

  const CLOSED_PORT_URL = 'http://127.0.0.1:1';

  const buildApp = async (): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const built = moduleRef.createNestApplication();
    built.setGlobalPrefix('api/v1', { exclude: ['health/liveness', 'health/readiness'] });
    await built.init();
    return built;
  };

  const seedTrioClosing = (brand: string, date: string, balance: number) =>
    dataSource.getRepository(TrioClosingBalance).insert({
      referenceDate: date,
      brand,
      bankAccountId: `acc-${brand}`,
      balance,
      cutoffAt: new Date(`${date}T03:00:00.000Z`),
      capturedAt: new Date(`${date}T03:00:05.000Z`),
      exact: true,
      method: TrioClosingBalanceMethod.POINT_IN_TIME,
    });

  const dailyStatus = async (date: string, brand: string): Promise<string> => {
    const rows = await dataSource.query<StatusRow[]>(
      `SELECT status FROM cash_balance_daily WHERE reference_date = $1 AND brand = $2`,
      [date, brand],
    );
    return rows[0]?.status;
  };

  /** Pendência de saque do lado do banco com CPF — a única forma de a busca de correção (rota 11) chegar ao ClickHouse. */
  const seedWithdrawalWithTaxNumber = async (
    referenceDate: string,
    brand: string,
  ): Promise<void> => {
    const runRepo = dataSource.getRepository(ReconciliationRun);
    const run = await runRepo.save(
      runRepo.create({
        referenceDate,
        brand,
        bank: 'trio',
        status: ReconciliationRunStatus.DONE,
        matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
        startedAt: new Date(),
        finishedAt: new Date(),
        ...ZERO_RUN_TOTALS,
      }),
    );

    const itemRepo = dataSource.getRepository(ReconciliationItem);
    await itemRepo.save(
      itemRepo.create({
        runId: run.id,
        referenceDate,
        brand,
        bank: 'trio',
        flow: ReconciliationFlow.WITHDRAWAL,
        side: ReconciliationSide.BANK,
        itemKey: 'smoke-warehouse-down-1',
        amount: 50,
        counterpartyTaxNumber: '12345678900',
        status: ReconciliationItemStatus.OPEN,
        stillPending: true,
        platformReprocessPending: false,
      }),
    );
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
    bearer = `Bearer ${auth.sign({ permissions: ALL_PERMISSIONS })}`;

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

    // App principal: os 2 stubs reais de pé (identidade :3100, ClickHouse :8123).
    process.env.SAYPLUS_API_URL = 'http://localhost:3100';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    app = await buildApp();
    dataSource = app.get(DataSource);

    // App dedicado: identidade fora (porta fechada) — prova o 503 universal.
    process.env.SAYPLUS_API_URL = CLOSED_PORT_URL;
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    appIdentityDown = await buildApp();

    // App dedicado: ClickHouse fora (porta fechada), identidade real — prova
    // o 503 de escrita (rota 6) e de busca de correção (rota 11).
    process.env.SAYPLUS_API_URL = 'http://localhost:3100';
    process.env.CLICKHOUSE_URL = CLOSED_PORT_URL;
    appWarehouseDown = await buildApp();

    // Restaura para o valor real, por higiene (nenhum outro código lê isso depois).
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
  });

  afterAll(async () => {
    await app?.close();
    await appIdentityDown?.close();
    await appWarehouseDown?.close();
    await postgres?.stop();
  });

  describe('401 sem Bearer — todas as 14 rotas de negócio (catálogo §6)', () => {
    it.each(ALL_ROUTES)('$name → 401', async ({ method, path, body }) => {
      const res = await api()
        [method](`${prefix}${path}`)
        .send(body ?? {});
      expect(res.status).toBe(401);
    });
  });

  describe('403 permissão ausente no claim do JWT — todas as 14 rotas (catálogo §6)', () => {
    it.each(ALL_ROUTES)('$name → 403', async ({ method, path, body }) => {
      const semPermissao = auth.sign({ permissions: [] });
      const res = await api()
        [method](`${prefix}${path}`)
        .set('Authorization', `Bearer ${semPermissao}`)
        .send(body ?? {});
      expect(res.status).toBe(403);
    });
  });

  describe('400 marca não reconhecida (:brand fora do catálogo) — rotas 5,6,7,11,12', () => {
    it.each(BRAND_ROUTES)('$name com :brand=atlantis → 400', async ({ method, path, body }) => {
      const res = await api()
        [method](`${prefix}${path('atlantis')}`)
        .set('Authorization', bearer)
        .send(body ?? {});
      expect(res.status).toBe(400);
    });
  });

  describe('403 usuário sem acesso a esta marca (marca válida, sem vínculo) — rotas 5,6,7,11,12', () => {
    it.each(BRAND_ROUTES)(
      '$name com :brand=suprema (catálogo) mas usuário só vinculado a ultra → 403',
      async ({ method, path, body }) => {
        const limitedToken = auth.sign({
          permissions: ALL_PERMISSIONS,
          sub: 'user-limited-brands',
        });
        const res = await api()
          [method](`${prefix}${path('suprema')}`)
          .set('Authorization', `Bearer ${limitedToken}`)
          .send(body ?? {});
        expect(res.status).toBe(403);
      },
    );
  });

  describe('400 banco não reconhecido (:bank fora do catálogo) — rota 5', () => {
    it('bank=fakebank com marca válida → 400', async () => {
      const res = await api()
        .post(`${prefix}/cash-balance/suprema/banks/fakebank/confirm`)
        .set('Authorization', bearer)
        .send({ balance: 100 });
      expect(res.status).toBe(400);
    });
  });

  describe('400 balance ausente, não numérico ou com mais de 2 decimais — rota 5', () => {
    it.each([
      ['ausente', {}],
      ['não numérico', { balance: 'abc' }],
      ['com 3 decimais', { balance: 100.123 }],
    ])('balance %s → 400', async (_label, body) => {
      const res = await api()
        .post(`${prefix}/cash-balance/suprema/banks/caixa/confirm`)
        .set('Authorization', bearer)
        .send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('400 campo extra não declarado (forbidNonWhitelisted) — todas as rotas com corpo', () => {
    it.each(BODY_ROUTES)('$name com campo extra no corpo → 400', async ({ method, path, body }) => {
      const res = await api()
        [method](`${prefix}${path}`)
        .set('Authorization', bearer)
        .send({ ...body, campoInexistente: 'x' });
      expect(res.status).toBe(400);
    });
  });

  describe('400 formato de data inválido — rotas com date/from/to', () => {
    it.each([
      ['1 summary?date', 'get', '/cash-balance/summary?date=not-a-date', undefined],
      ['3 history?from', 'get', '/cash-balance/history?from=31-12-2026&to=2026-08-15', undefined],
      ['4 trio/refresh?date', 'get', '/cash-balance/trio/refresh?date=2026%2F08%2F15', undefined],
      [
        '5 confirm body.date',
        'post',
        '/cash-balance/suprema/banks/caixa/confirm',
        { balance: 100, date: 'xx' },
      ],
      ['6 register body.date', 'post', '/cash-balance/suprema/register', { date: 'xx' }],
      ['7 reopen body.date', 'post', '/cash-balance/suprema/reopen', { date: 'xx' }],
      ['8 reconciliation?date', 'get', '/reconciliation?date=xx', undefined],
      [
        '9 reconciliation/history?from',
        'get',
        '/reconciliation/history?from=xx&to=2026-08-15',
        undefined,
      ],
      ['10 run body.date', 'post', '/reconciliation/run', { date: 'xx' }],
      ['11 corrections?date', 'get', '/reconciliation/suprema/corrections?date=xx', undefined],
      ['12 apply body.date', 'post', '/reconciliation/suprema/corrections/apply', { date: 'xx' }],
    ] as const)('%s → 400', async (_label, method, path, body) => {
      const res = await api()
        [method](`${prefix}${path}`)
        .set('Authorization', bearer)
        .send(body ?? {});
      expect(res.status).toBe(400);
    });
  });

  describe('400 from > to ou intervalo > 180 dias — rotas 3 e 9', () => {
    it('cash-balance/history: from > to → 400', async () => {
      const res = await api()
        .get(`${prefix}/cash-balance/history?from=2026-08-20&to=2026-08-01`)
        .set('Authorization', bearer);
      expect(res.status).toBe(400);
    });

    it('reconciliation/history: from > to → 400', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/history?from=2026-08-20&to=2026-08-01`)
        .set('Authorization', bearer);
      expect(res.status).toBe(400);
    });

    it('reconciliation/history: intervalo > 180 dias → 400', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/history?from=2025-01-01&to=2026-08-15`)
        .set('Authorization', bearer);
      expect(res.status).toBe(400);
    });
  });

  describe('400 :id não é um inteiro válido (ParseIntPipe, nunca UUID) — rotas 13,14', () => {
    it('resolve com id=abc → 400', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/items/abc/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'Nota de teste com mais de dez caracteres.' });
      expect(res.status).toBe(400);
    });

    it('reopen com id=abc → 400', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/items/abc/reopen`)
        .set('Authorization', bearer);
      expect(res.status).toBe(400);
    });
  });

  describe('400 note fora de 10-1000 caracteres, antes e depois do trim — rota 13', () => {
    it('nota com 1001 caracteres → 400 (bruto, class-validator, antes do trim)', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/items/999999999/resolve`)
        .set('Authorization', bearer)
        .send({ note: 'a'.repeat(1001) });
      expect(res.status).toBe(400);
    });

    it('nota com padding que passa o Length bruto mas trima para <10 → 400 (depois do trim, use-case)', async () => {
      const note = `${' '.repeat(20)}curto${' '.repeat(20)}`;
      expect(note.length).toBeGreaterThanOrEqual(10);
      expect(note.trim().length).toBeLessThan(10);

      const res = await api()
        .post(`${prefix}/reconciliation/items/999999999/resolve`)
        .set('Authorization', bearer)
        .send({ note });
      expect(res.status).toBe(400);
    });
  });

  describe('404 Pendência não encontrada — rota 14 (reopen)', () => {
    it('item inexistente → 404', async () => {
      const res = await api()
        .post(`${prefix}/reconciliation/items/999999999/reopen`)
        .set('Authorization', bearer);
      expect(res.status).toBe(404);
    });
  });

  describe('NOT_RUN em combinações de data sem execução — rotas 8,9', () => {
    it('GET /reconciliation numa data nunca executada → todas as marcas NOT_RUN', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation?date=2030-05-05`)
        .set('Authorization', bearer);
      const body = res.body as { brands: { status: string }[] };

      expect(res.status).toBe(200);
      expect(body.brands.length).toBeGreaterThan(0);
      expect(body.brands.every((b) => b.status === 'NOT_RUN')).toBe(true);
    });

    it('GET /reconciliation/history num intervalo nunca executado → missingDays = rangeDays', async () => {
      const res = await api()
        .get(`${prefix}/reconciliation/history?from=2030-01-01&to=2030-01-10`)
        .set('Authorization', bearer);
      const body = res.body as {
        rangeDays: number;
        missingDays: number;
        reconciledDays: number;
        pendingDays: number;
      };

      expect(res.status).toBe(200);
      expect(body.missingDays).toBe(body.rangeDays);
      expect(body.reconciledDays).toBe(0);
      expect(body.pendingDays).toBe(0);
    });
  });

  describe('503 /auth/me indisponível — universal às 14 rotas (mecanismo único, testado 1x)', () => {
    it('GET /cash-balance/summary com identidade fora do ar → 503', async () => {
      const res = await apiIdentityDown()
        .get(`${prefix}/cash-balance/summary`)
        .set('Authorization', bearer);
      expect(res.status).toBe(503);
      expect((res.body as ErrorBody).message).toContain('marcas do usuário');
    });
  });

  describe('503 ClickHouse fora do ar (falha de conexão) — rotas 6 e 11', () => {
    const DATE = '2026-08-30';

    it('POST /:brand/register com bancos+Trio prontos mas ClickHouse fora → 503', async () => {
      for (const bank of MANUAL_BANKS) {
        const res = await apiWarehouseDown()
          .post(`${prefix}/cash-balance/suprema/banks/${bank}/confirm`)
          .set('Authorization', bearer)
          .send({ balance: 100, date: DATE });
        expect(res.status).toBe(204);
      }
      await seedTrioClosing('suprema', DATE, 200);

      const res = await apiWarehouseDown()
        .post(`${prefix}/cash-balance/suprema/register`)
        .set('Authorization', bearer)
        .send({ date: DATE });

      expect(res.status).toBe(503);
      expect(await dailyStatus(DATE, 'suprema')).not.toBe('CONFIRMED');
    });

    it('GET /:brand/corrections com pendência candidata mas ClickHouse fora → 503', async () => {
      await seedWithdrawalWithTaxNumber(DATE, 'suprema');

      const res = await apiWarehouseDown()
        .get(`${prefix}/reconciliation/suprema/corrections?date=${DATE}`)
        .set('Authorization', bearer);

      expect(res.status).toBe(503);
      expect((res.body as ErrorBody).message).toContain('warehouse');
    });
  });
});
