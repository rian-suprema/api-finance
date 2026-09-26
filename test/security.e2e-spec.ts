import { readFileSync } from 'node:fs';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { FINANCE_RECONCILIATION } from '../src/auth/permissions.constants';
import { FinanceInitialSchema1788210289000 } from '../src/database/migrations/1788210289000-FinanceInitialSchema';
import { setupTestAuth, TestAuthContext } from './auth-helper';

async function pingStub(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error(
      `Stub indisponível em ${url} — rode "node scripts/finance-dev-stubs.js &" antes do test:e2e`,
    );
  }
}

/**
 * MATRIZ DE SEGURANÇA (e2e) — transforma em comportamento PROVADO o que a
 * strategy hoje garante só por código revisado: RS256 fixo (anti-downgrade),
 * issuer e audience conferidos, expiração, e a autorização por permissão.
 *
 * Cada teste que espera 401 é uma tentativa de FORJA: se alguém relaxar o
 * `algorithms`, o `issuer` ou o `audience` da JwtStrategy, o caso vira verde-
 * para-o-atacante e este spec quebra no CI antes do merge.
 */
interface ErrorBody {
  code: string;
  message: string;
}

describe('Segurança — matriz de validação do JWT (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let auth: TestAuthContext;
  let publicKeyPem: string;

  const api = () => request(app.getHttpServer() as App);
  // Pendência inexistente: prova "auth OK" via 404 do domínio sem precisar de
  // dado de negócio real — mesmo truque que a rota do exemplo usava.
  const protectedRoute = '/api/v1/reconciliation/items/999999999/reopen'; // exige finance.reconciliation.resolve

  beforeAll(async () => {
    await pingStub('http://localhost:3100/auth/me');

    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    process.env.NODE_ENV = 'test';
    process.env.API_PREFIX = 'api/v1';
    process.env.DB_HOST = postgres.getHost();
    process.env.DB_PORT = String(postgres.getPort());
    process.env.DB_USERNAME = postgres.getUsername();
    process.env.DB_PASSWORD = postgres.getPassword();
    process.env.DB_NAME = postgres.getDatabase();
    process.env.DB_SSL = 'false';

    // A plataforma SayPlus simulada: o app carrega SÓ a chave pública
    auth = setupTestAuth();
    publicKeyPem = readFileSync(auth.publicKeyPath, 'utf8');

    const migrator = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
      migrations: [FinanceInitialSchema1788210289000],
    });
    await migrator.initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health/liveness', 'health/readiness'] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  const bearer = (token: string) =>
    api().post(protectedRoute).set('Authorization', `Bearer ${token}`);

  describe('aceitação — a chave e o contrato CERTOS entram', () => {
    it('token RS256 assinado pela chave certa, iss/aud/permissão corretos → passa a auth (404 do domínio)', async () => {
      const res = await bearer(auth.sign({ permissions: [FINANCE_RECONCILIATION.RESOLVE] }));
      // 404 = auth OK, o usuário é que não existe — prova que NÃO é 401/403
      expect(res.status).toBe(404);
    });

    it('rota pública dispensa token (probe)', async () => {
      const res = await api().get('/health/liveness');
      expect(res.status).toBe(200);
    });
  });

  describe('forja de ASSINATURA — nenhuma chave errada entra', () => {
    it('token assinado por OUTRA chave privada RS256 → 401', async () => {
      const impostor = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const forged = jwt.sign(
        { permissions: [FINANCE_RECONCILIATION.RESOLVE], tenantId: 'x' },
        impostor.privateKey,
        {
          algorithm: 'RS256',
          subject: 'atacante',
          issuer: 'sayplus',
          audience: ['sayplus', 'finance'],
          expiresIn: 300,
        },
      );
      const res = await bearer(forged);
      expect(res.status).toBe(401);
    });

    it('downgrade HS256 usando a chave PÚBLICA como segredo → 401 (algorithms fixo em RS256)', async () => {
      // O ataque clássico: a chave pública não é secreta; um validador que
      // aceite HS256 a trataria como segredo HMAC e validaria a forja.

      const forged = jwt.sign(
        { permissions: [FINANCE_RECONCILIATION.RESOLVE], tenantId: 'x' },
        publicKeyPem,
        {
          algorithm: 'HS256',
          subject: 'atacante',
          issuer: 'sayplus',
          audience: ['sayplus', 'finance'],
          expiresIn: 300,
        },
      );
      const res = await bearer(forged);
      expect(res.status).toBe(401);
    });

    it('alg: none (token sem assinatura) → 401', async () => {
      // eslint-disable-next-line sonarjs/insecure-jwt-token, sonarjs/hardcoded-secret-signatures -- forja DELIBERADA de token sem assinatura: o teste prova a rejeição
      const forged = jwt.sign(
        { permissions: [FINANCE_RECONCILIATION.RESOLVE], tenantId: 'x' },
        '',
        {
          algorithm: 'none',
          subject: 'atacante',
          issuer: 'sayplus',
          audience: ['sayplus', 'finance'],
        },
      );
      const res = await bearer(forged);
      expect(res.status).toBe(401);
    });

    it('lixo no lugar do JWT → 401', async () => {
      const res = await bearer('nao-e-um-jwt');
      expect(res.status).toBe(401);
    });
  });

  describe('forja de CLAIMS — issuer/audience/expiração conferem', () => {
    it('issuer errado (outro emissor) → 401', async () => {
      const res = await bearer(
        auth.sign({ permissions: [FINANCE_RECONCILIATION.RESOLVE], issuer: 'atacante-idp' }),
      );
      expect(res.status).toBe(401);
    });

    it('audience errada (token de outro serviço) → 401', async () => {
      const res = await bearer(
        auth.sign({
          permissions: [FINANCE_RECONCILIATION.RESOLVE],
          audience: ['sayplus', 'outro-servico'],
        }),
      );
      expect(res.status).toBe(401);
    });

    it('token expirado → 401', async () => {
      const res = await bearer(
        auth.sign({ permissions: [FINANCE_RECONCILIATION.RESOLVE], expiresIn: -60 }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe('autorização — assinatura válida ainda precisa da permissão', () => {
    it('token legítimo sem NENHUMA permissão → 403 (deny-by-default)', async () => {
      const res = await bearer(auth.sign({ permissions: [] }));
      expect(res.status).toBe(403);
    });

    it('token legítimo com a permissão ERRADA → 403 apontando o code exigido', async () => {
      const res = await bearer(auth.sign({ permissions: ['finance.reconciliation.run'] }));
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).message).toContain(FINANCE_RECONCILIATION.RESOLVE);
    });
  });
});
