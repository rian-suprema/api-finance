import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { InitialSchema1754560000000 } from '../src/database/migrations/1754560000000-InitialSchema';

/**
 * Teste ponta a ponta do archetype com INFRA REAL descartável (Testcontainers):
 * o Postgres sobe em container efêmero — nenhum mock de infraestrutura.
 *
 * Percorre o ciclo completo do exemplo: probes de saúde → criação (unitária e
 * em lote) → consulta → conflito → validação → atualização → remoção.
 */

/**
 * Formas serializadas das respostas HTTP. O `res.body` do supertest é `any`;
 * tipá-lo aqui mantém os asserts sob as regras type-aware do ESLint — o mesmo
 * rigor exigido do código de produção vale para o teste.
 */
interface ErrorBody {
  code: string;
  message: string;
}
interface UserBody {
  id: number;
  username: string;
  email: string;
  password?: string;
}

describe('Users API (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;

  const api = () => request(app.getHttpServer() as App);
  const prefix = '/api/v1';

  beforeAll(async () => {
    // 1. Infra efêmera
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    // 2. Ambiente da aplicação apontando para o container
    //    (process.env tem precedência sobre o .env.test carregado pelo ConfigModule)
    process.env.NODE_ENV = 'test';
    process.env.API_PREFIX = 'api/v1';
    process.env.DB_HOST = postgres.getHost();
    process.env.DB_PORT = String(postgres.getPort());
    process.env.DB_USERNAME = postgres.getUsername();
    process.env.DB_PASSWORD = postgres.getPassword();
    process.env.DB_NAME = postgres.getDatabase();
    process.env.DB_SSL = 'false';

    // 3. Schema via migrations reais — o e2e valida também a migration
    const migrator = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
      migrations: [InitialSchema1754560000000],
    });
    await migrator.initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    // 4. Sobe a aplicação completa (pipes/filters/interceptors vêm do AppModule)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Espelha o bootstrap real: prefixo da API com probes de saúde fora dele
    app.setGlobalPrefix('api/v1', { exclude: ['health/liveness', 'health/readiness'] });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
  });

  describe('Health — probes fora do prefixo da API', () => {
    it('liveness responde 200 sem tocar dependências', async () => {
      await api().get('/health/liveness').expect(200);
    });

    it('readiness confirma o Postgres saudável', async () => {
      const res = await api().get('/health/readiness').expect(200);
      const body = res.body as { status: string; info: Record<string, { status: string }> };
      expect(body.status).toBe('ok');
      expect(body.info.database.status).toBe('up');
    });
  });

  describe('Users — CRUD, validação e contrato de erro', () => {
    it('cria usuário e nunca expõe password na resposta', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .send({ username: 'theUser', email: 'john@email.com', password: 's3cret' })
        .expect(200);

      const user = res.body as UserBody;
      expect(user.username).toBe('theUser');
      expect(user.password).toBeUndefined();
    });

    it('cria usuários em lote (createWithList valida item a item)', async () => {
      const res = await api()
        .post(`${prefix}/user/createWithList`)
        .send([{ username: 'alice' }, { username: 'bob' }])
        .expect(200);

      expect((res.body as UserBody[]).map((user) => user.username)).toEqual(['alice', 'bob']);
    });

    it('busca por username', async () => {
      const res = await api().get(`${prefix}/user/theUser`).expect(200);
      expect((res.body as UserBody).email).toBe('john@email.com');
    });

    it('username duplicado → 409 no contrato de erro { code, message }', async () => {
      const res = await api().post(`${prefix}/user`).send({ username: 'theUser' }).expect(409);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('CONFLICT');
      expect(typeof body.message).toBe('string');
    });

    it('payload inválido → 400 com mensagens do ValidationPipe', async () => {
      const res = await api().post(`${prefix}/user`).send({ username: '' }).expect(400);
      expect((res.body as ErrorBody).code).toBe('BAD_REQUEST');
    });

    it('propriedade fora do DTO → 400 (whitelist estrita)', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .send({ username: 'eve', isAdmin: true })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('BAD_REQUEST');
    });

    it('atualiza o usuário', async () => {
      const res = await api()
        .put(`${prefix}/user/theUser`)
        .send({ email: 'new@email.com' })
        .expect(200);
      expect((res.body as UserBody).email).toBe('new@email.com');
    });

    it('remove e depois 404 no contrato { code, message }', async () => {
      await api().delete(`${prefix}/user/theUser`).expect(200);
      const res = await api().get(`${prefix}/user/theUser`).expect(404);
      expect(res.body as ErrorBody).toEqual({ code: 'NOT_FOUND', message: 'User not found' });
    });
  });
});
