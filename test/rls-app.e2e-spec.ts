import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { PETSHOP_USERS } from '../src/auth/permissions.constants';
import { InitialSchema1754560000000 } from '../src/database/migrations/1754560000000-InitialSchema';
import { AddTenantId1755000000000 } from '../src/database/migrations/1755000000000-AddTenantId';
import { EnableRowLevelSecurity1756000000000 } from '../src/database/migrations/1756000000000-EnableRowLevelSecurity';
import { setupTestAuth, TestAuthContext } from './auth-helper';

/**
 * PROVA DE PONTA A PONTA do Step 5: a aplicação rodando como o role de RUNTIME
 * NÃO-super, com RLS+FORCE ativos, isolada por tenant. Isto amarra as peças:
 *
 * - migrations rodam como OWNER dedicado (não-super) → FORCE o alcança;
 * - a app conecta como RUNTIME → só enxerga linhas via o GUC;
 * - o TenantTransactionInterceptor abre a transação e faz SET LOCAL
 *   app.tenant_id com o tenant do CLAIM → é a única razão de a app conseguir
 *   ler/gravar. Sem o interceptor, este role veria zero (provado em rls.e2e).
 */
interface UserBody {
  username: string;
}

describe('RLS na aplicação — app como runtime role + GUC do claim (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let auth: TestAuthContext;

  const OWNER_ROLE = 'users_owner';
  const APP_ROLE = 'users_app';
  const PW = 'pw_test';

  const api = () => request(app.getHttpServer() as App);
  const prefix = '/api/v1';
  const perms = Object.values(PETSHOP_USERS);

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    // 1. Roles reais (papel do initdb/IaC): owner não-super + runtime
    const su = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
    });
    await su.initialize();
    await su.query(`CREATE ROLE "${OWNER_ROLE}" LOGIN PASSWORD '${PW}'`);
    await su.query(`CREATE ROLE "${APP_ROLE}" LOGIN PASSWORD '${PW}'`);
    await su.query(`GRANT CREATE, USAGE ON SCHEMA public TO "${OWNER_ROLE}"`);
    await su.destroy();

    // 2. Migrations como OWNER (schema + RLS + grants ao runtime)
    process.env.DB_APP_ROLE = APP_ROLE;
    const owner = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: OWNER_ROLE,
      password: PW,
      database: postgres.getDatabase(),
      migrations: [
        InitialSchema1754560000000,
        AddTenantId1755000000000,
        EnableRowLevelSecurity1756000000000,
      ],
    });
    await owner.initialize();
    await owner.runMigrations();
    await owner.destroy();

    // 3. A APLICAÇÃO conecta como RUNTIME (não-owner, não-super) — é aqui que a
    //    RLS morde; a app só funciona porque o interceptor injeta o GUC
    process.env.NODE_ENV = 'test';
    process.env.API_PREFIX = 'api/v1';
    process.env.DB_HOST = postgres.getHost();
    process.env.DB_PORT = String(postgres.getPort());
    process.env.DB_USERNAME = APP_ROLE;
    process.env.DB_PASSWORD = PW;
    process.env.DB_NAME = postgres.getDatabase();
    process.env.DB_SSL = 'false';

    auth = setupTestAuth();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health/liveness', 'health/readiness'] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  const asTenant = (tenantId: string) => `Bearer ${auth.sign({ tenantId, permissions: perms })}`;

  it('app (runtime) grava e lê dentro do tenant — o GUC do interceptor viabiliza', async () => {
    const create = await api()
      .post(`${prefix}/user`)
      .set('Authorization', asTenant('tenant-a'))
      .send({ username: 'alice' });
    expect(create.status).toBe(200);

    const read = await api().get(`${prefix}/user/alice`).set('Authorization', asTenant('tenant-a'));
    expect(read.status).toBe(200);
    expect((read.body as UserBody).username).toBe('alice');
  });

  it('outro tenant NÃO vê o registro — RLS no banco corta, não só o filtro da app', async () => {
    const foreign = await api()
      .get(`${prefix}/user/alice`)
      .set('Authorization', asTenant('tenant-b'));
    expect(foreign.status).toBe(404);
  });

  it('readiness (rota @Public, sem tenant) funciona sem transação de tenant', async () => {
    const res = await api().get('/health/readiness');
    expect(res.status).toBe(200);
  });
});
