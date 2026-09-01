import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { FINANCE_CASH_BALANCE } from '../src/auth/permissions.constants';
import { TrioClosingBalanceMethod } from '../src/modules/finance-cash-balance/cash-balance.enums';
import { TrioClosingBalance } from '../src/modules/finance-cash-balance/entities/trio-closing-balance.entity';
import { InitialSchema1754560000000 } from '../src/database/migrations/1754560000000-InitialSchema';
import { AddTenantId1755000000000 } from '../src/database/migrations/1755000000000-AddTenantId';
import { EnableRowLevelSecurity1756000000000 } from '../src/database/migrations/1756000000000-EnableRowLevelSecurity';
import { FinanceInitialSchema1788210289000 } from '../src/database/migrations/1788210289000-FinanceInitialSchema';
import { setupTestAuth, TestAuthContext } from './auth-helper';

/**
 * Teste ponta a ponta da Fase 09 (Balanço de Caixa) com INFRA REAL descartável
 * (Testcontainers para Postgres). ClickHouse/Trio/identidade da SayPlus são os
 * stubs locais de `scripts/finance-dev-stubs.js` — PRECISAM estar rodando
 * (`node scripts/finance-dev-stubs.js &`) antes deste arquivo, nas portas
 * fixas de `.env.test` (:3100 /auth/me, :8123 ClickHouse, :9001 Trio — não
 * usado por esta fase, mas o stub sobe as 3 mesmo assim).
 */

interface ErrorBody {
  code: string;
  message: string;
  pendingBanks?: string[];
}

interface StatusRow {
  status: string;
}

interface BankEntryRow {
  confirmed: boolean;
  balance: string;
}

const MANUAL_BANKS = ['caixa', 'onekey', 'zro', 'celcoin', 'okto', 'topazio', 'genial'];

async function pingStub(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(
      `Stub indisponível em ${url} — rode "node scripts/finance-dev-stubs.js &" antes do test:e2e`,
    );
  }
}

describe('Finance — Balanço de Caixa (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let auth: TestAuthContext;
  let bearer: string;

  const api = () => request(app.getHttpServer() as App);
  const prefix = '/api/v1';

  const confirmBank = (brand: string, bank: string, date: string, balance: number) =>
    api()
      .post(`${prefix}/cash-balance/${brand}/banks/${bank}/confirm`)
      .set('Authorization', bearer)
      .send({ balance, date });

  const confirmAllManualBanks = async (
    brand: string,
    date: string,
    balance = 100,
  ): Promise<void> => {
    for (const bank of MANUAL_BANKS) {
      const res = await confirmBank(brand, bank, date, balance);
      expect(res.status).toBe(204);
    }
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
    return rows[0].status;
  };

  const dayStatus = async (date: string): Promise<string> => {
    const rows = await dataSource.query<StatusRow[]>(
      `SELECT status FROM cash_balance_days WHERE reference_date = $1`,
      [date],
    );
    return rows[0].status;
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
    bearer = `Bearer ${auth.sign({ permissions: Object.values(FINANCE_CASH_BALANCE) })}`;

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

  describe('Autenticação e autorização (cenário 14)', () => {
    it('sem Bearer → 401', async () => {
      const res = await api().get(`${prefix}/cash-balance/summary`);
      expect(res.status).toBe(401);
    });

    it('com Bearer mas sem a permissão da rota → 403', async () => {
      const semPermissao = auth.sign({ permissions: [] });
      const res = await api()
        .get(`${prefix}/cash-balance/summary`)
        .set('Authorization', `Bearer ${semPermissao}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /cash-balance/summary (cenário 1)', () => {
    it('sem date → 200, available reflete o ClickHouse configurado, byBrand cobre o catálogo', async () => {
      const res = await api().get(`${prefix}/cash-balance/summary`).set('Authorization', bearer);
      const body = res.body as {
        available: boolean;
        depositsYesterday: { byBrand: { brand: string }[] };
      };

      expect(res.status).toBe(200);
      expect(body.available).toBe(true);
      expect(
        body.depositsYesterday.byBrand.map((b) => b.brand).sort((a, b) => a.localeCompare(b)),
      ).toEqual(['maxima', 'suprema', 'ultra']);
    });
  });

  describe('GET /cash-balance/banks (cenário 2)', () => {
    it('os 8 bancos aparecem na ordem do catálogo, trio com readOnly:true', async () => {
      const res = await api().get(`${prefix}/cash-balance/banks`).set('Authorization', bearer);
      const body = res.body as { brands: { banks: { bank: string; readOnly: boolean }[] }[] };
      const banks = body.brands[0].banks;

      expect(res.status).toBe(200);
      expect(banks.map((b) => b.bank)).toEqual([
        'caixa',
        'trio',
        'onekey',
        'zro',
        'celcoin',
        'okto',
        'topazio',
        'genial',
      ]);
      expect(banks.find((b) => b.bank === 'trio')?.readOnly).toBe(true);
    });
  });

  describe('GET /cash-balance/history (cenário 3)', () => {
    it('intervalo válido → 200, registeredDays ≤ rangeDays', async () => {
      const res = await api()
        .get(`${prefix}/cash-balance/history?from=2026-08-01&to=2026-08-15`)
        .set('Authorization', bearer);
      const body = res.body as { rangeDays: number; registeredDays: number };

      expect(res.status).toBe(200);
      expect(body.registeredDays).toBeLessThanOrEqual(body.rangeDays);
    });

    it('intervalo > 180 dias → 400', async () => {
      const res = await api()
        .get(`${prefix}/cash-balance/history?from=2025-01-01&to=2026-08-15`)
        .set('Authorization', bearer);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /cash-balance/trio/refresh (cenário 4)', () => {
    it('sem captura para a data → available:false, nenhuma chamada à Trio', async () => {
      const res = await api()
        .get(`${prefix}/cash-balance/trio/refresh?date=2099-01-01`)
        .set('Authorization', bearer);
      const body = res.body as { available: boolean }[];

      expect(res.status).toBe(200);
      expect(body.every((item) => item.available === false)).toBe(true);
    });
  });

  describe('POST /:brand/banks/:bank/confirm (cenários 5, 6)', () => {
    it('bank=trio → 400 (somente leitura)', async () => {
      const res = await confirmBank('suprema', 'trio', '2026-08-21', 100);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).message).toContain('somente leitura');
    });

    it('banco manual válido → 204; Postgres reflete confirmed=true', async () => {
      const res = await confirmBank('suprema', 'caixa', '2026-08-21', 1000.5);
      expect(res.status).toBe(204);

      const rows = await dataSource.query<BankEntryRow[]>(
        `SELECT cbe.confirmed, cbe.balance FROM cash_balance_bank_entries cbe
         JOIN cash_balance_daily cbd ON cbd.id = cbe.daily_id
         WHERE cbd.reference_date = $1 AND cbd.brand = $2 AND cbe.bank = $3`,
        ['2026-08-21', 'suprema', 'caixa'],
      );

      expect(rows[0].confirmed).toBe(true);
      expect(Number(rows[0].balance)).toBe(1000.5);
    });
  });

  describe('POST /:brand/register (cenários 7, 8, 9, 10, 11)', () => {
    const DATE = '2026-08-22';

    it('campo extra no corpo → 400 (forbidNonWhitelisted)', async () => {
      const res = await api()
        .post(`${prefix}/cash-balance/suprema/register`)
        .set('Authorization', bearer)
        .send({ date: DATE, balance: 999 });
      expect(res.status).toBe(400);
    });

    it('bancos manuais incompletos → 400 com pendingBanks sobrevivendo ao GlobalExceptionFilter', async () => {
      const res = await api()
        .post(`${prefix}/cash-balance/suprema/register`)
        .set('Authorization', bearer)
        .send({ date: DATE });

      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).pendingBanks).toEqual(expect.arrayContaining(MANUAL_BANKS));
    });

    it('7 bancos confirmados mas sem fechamento Trio capturado → 503', async () => {
      await confirmAllManualBanks('suprema', DATE);

      const res = await api()
        .post(`${prefix}/cash-balance/suprema/register`)
        .set('Authorization', bearer)
        .send({ date: DATE });
      expect(res.status).toBe(503);
    });

    it('completo (7 bancos + fechamento Trio + saldo de jogadores) → 201, sinal correto, CONFIRMED no Postgres', async () => {
      await seedTrioClosing('suprema', DATE, 200);

      const res = await api()
        .post(`${prefix}/cash-balance/suprema/register`)
        .set('Authorization', bearer)
        .send({ date: DATE });

      const body = res.body as {
        saldoTransacional: number;
        saldoJogadores: number;
        totalBalanco: number;
      };

      expect(res.status).toBe(201);
      // trio(200) + 7×100 manuais = 900; jogadores da Suprema no stub = 10000
      expect(body.saldoTransacional).toBe(900);
      expect(body.totalBalanco).toBe(body.saldoTransacional - body.saldoJogadores);
      expect(await dailyStatus(DATE, 'suprema')).toBe('CONFIRMED');
    });

    it('registrar as 3 marcas do dia → a 3ª resposta fecha o dia (CLOSED)', async () => {
      for (const brand of ['ultra', 'maxima']) {
        await confirmAllManualBanks(brand, DATE);
        await seedTrioClosing(brand, DATE, 150);
      }

      const resUltra = await api()
        .post(`${prefix}/cash-balance/ultra/register`)
        .set('Authorization', bearer)
        .send({ date: DATE });
      expect(resUltra.status).toBe(201);
      expect((resUltra.body as { dayStatus: string }).dayStatus).toBe('OPEN');

      const resMaxima = await api()
        .post(`${prefix}/cash-balance/maxima/register`)
        .set('Authorization', bearer)
        .send({ date: DATE });
      const maximaBody = resMaxima.body as { dayStatus: string; allBrandsConfirmed: boolean };

      expect(resMaxima.status).toBe(201);
      expect(maximaBody.dayStatus).toBe('CLOSED');
      expect(maximaBody.allBrandsConfirmed).toBe(true);
      expect(await dayStatus(DATE)).toBe('CLOSED');
    });
  });

  describe('POST /:brand/reopen (cenários 12, 13)', () => {
    it('marca registrada → 204; daily volta a DRAFT e o dia volta a OPEN', async () => {
      const date = '2026-08-23';
      await confirmAllManualBanks('suprema', date);
      await seedTrioClosing('suprema', date, 100);
      const registerRes = await api()
        .post(`${prefix}/cash-balance/suprema/register`)
        .set('Authorization', bearer)
        .send({ date });
      expect(registerRes.status).toBe(201);

      const reopenRes = await api()
        .post(`${prefix}/cash-balance/suprema/reopen`)
        .set('Authorization', bearer)
        .send({ date });
      expect(reopenRes.status).toBe(204);

      expect(await dailyStatus(date, 'suprema')).toBe('DRAFT');
      expect(await dayStatus(date)).toBe('OPEN');
    });

    it('marca nunca registrada → 404', async () => {
      const res = await api()
        .post(`${prefix}/cash-balance/suprema/reopen`)
        .set('Authorization', bearer)
        .send({ date: '2099-12-31' });
      expect(res.status).toBe(404);
    });
  });
});
