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
import { setupTestAuth, TestAuthContext } from './auth-helper';

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
interface PaginatedBody {
  data: UserBody[];
  total: number;
  page: number;
  pageSize: number;
}

describe('Users API (e2e)', () => {
  let app: INestApplication;
  let postgres: StartedPostgreSqlContainer;
  let auth: TestAuthContext;
  let bearer: string;

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

    // 2b. Auth SayPlus simulada: par RS256 efêmero — a app recebe SÓ a chave
    //     pública (JWT_PUBLIC_KEY_PATH), como em produção; o teste assina
    //     tokens com a privada, fazendo o papel da plataforma
    auth = setupTestAuth();
    bearer = `Bearer ${auth.sign({ permissions: Object.values(PETSHOP_USERS) })}`;

    // 3. Schema via migrations reais — o e2e valida também a migration
    const migrator = new DataSource({
      type: 'postgres',
      host: postgres.getHost(),
      port: postgres.getPort(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
      database: postgres.getDatabase(),
      migrations: [InitialSchema1754560000000, AddTenantId1755000000000],
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
      const res = await api().get('/health/liveness');
      expect(res.status).toBe(200);
    });

    it('readiness confirma o Postgres saudável', async () => {
      const res = await api().get('/health/readiness').expect(200);
      const body = res.body as { status: string; info: Record<string, { status: string }> };
      expect(body.status).toBe('ok');
      expect(body.info.database.status).toBe('up');
    });
  });

  describe('Fechadura SayPlus — validação e autorização (Step 1)', () => {
    it('sem token → 401 (toda rota de negócio nasce fechada)', async () => {
      const res = await api().get(`${prefix}/user/qualquer`);
      expect(res.status).toBe(401);
    });

    it('token válido sem o code exigido → 403 (autorização por permissão)', async () => {
      const semPermissao = auth.sign({ permissions: ['petshop.users.read'] });
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', `Bearer ${semPermissao}`)
        .send({ username: 'negado' })
        .expect(403);
      expect((res.body as ErrorBody).message).toContain(PETSHOP_USERS.CREATE);
    });

    it('token expirado → 401', async () => {
      const expirado = auth.sign({ permissions: Object.values(PETSHOP_USERS), expiresIn: -60 });
      const res = await api()
        .get(`${prefix}/user/qualquer`)
        .set('Authorization', `Bearer ${expirado}`);
      expect(res.status).toBe(401);
    });
  });

  describe('Users — CRUD, validação e contrato de erro', () => {
    it('cria usuário e nunca expõe password na resposta', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'theUser', email: 'john@email.com', password: 's3cret' })
        .expect(200);

      const user = res.body as UserBody;
      expect(user.username).toBe('theUser');
      expect(user.password).toBeUndefined();
    });

    it('cria usuários em lote (createWithList valida item a item)', async () => {
      const res = await api()
        .post(`${prefix}/user/createWithList`)
        .set('Authorization', bearer)
        .send([{ username: 'alice' }, { username: 'bob' }])
        .expect(200);

      expect((res.body as UserBody[]).map((user) => user.username)).toEqual(['alice', 'bob']);
    });

    it('busca por username', async () => {
      const res = await api()
        .get(`${prefix}/user/theUser`)
        .set('Authorization', bearer)
        .expect(200);
      expect((res.body as UserBody).email).toBe('john@email.com');
    });

    it('username duplicado → 409 no contrato de erro { code, message }', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'theUser' })
        .expect(409);
      const body = res.body as ErrorBody;
      expect(body.code).toBe('CONFLICT');
      expect(typeof body.message).toBe('string');
    });

    it('payload inválido → 400 com mensagens do ValidationPipe', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: '' })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('BAD_REQUEST');
    });

    it('propriedade fora do DTO → 400 (whitelist estrita)', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'eve', isAdmin: true })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('BAD_REQUEST');
    });

    it('atualiza o usuário', async () => {
      const res = await api()
        .put(`${prefix}/user/theUser`)
        .set('Authorization', bearer)
        .send({ email: 'new@email.com' })
        .expect(200);
      expect((res.body as UserBody).email).toBe('new@email.com');
    });

    it('remove e depois 404 no contrato { code, message }', async () => {
      await api().delete(`${prefix}/user/theUser`).set('Authorization', bearer).expect(200);
      const res = await api()
        .get(`${prefix}/user/theUser`)
        .set('Authorization', bearer)
        .expect(404);
      expect(res.body as ErrorBody).toEqual({ code: 'NOT_FOUND', message: 'User not found' });
    });
  });
  describe('Listagem paginada (GET /user) — paginação no banco, por tenant', () => {
    let bearerList: string;

    beforeAll(async () => {
      bearerList = `Bearer ${auth.sign({
        tenantId: 'tenant-list',
        permissions: Object.values(PETSHOP_USERS),
      })}`;
      for (const username of ['lista1', 'lista2', 'lista3']) {
        await api().post(`${prefix}/user`).set('Authorization', bearerList).send({ username });
      }
    });

    it('devolve o envelope {data,total,page,pageSize} só com os usuários do tenant', async () => {
      const res = await api().get(`${prefix}/user`).set('Authorization', bearerList).expect(200);
      const body = res.body as PaginatedBody;
      expect(body.total).toBe(3);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.data.map((u) => u.username)).toEqual(['lista1', 'lista2', 'lista3']);
      // password nunca sai — nem na lista
      expect(body.data.every((u) => u.password === undefined)).toBe(true);
    });

    it('pagina NO BANCO: pageSize=2 → 2 itens na pág 1 (total=3); pág 2 → 1 item', async () => {
      const p1 = await api()
        .get(`${prefix}/user?page=1&pageSize=2`)
        .set('Authorization', bearerList)
        .expect(200);
      const b1 = p1.body as PaginatedBody;
      expect(b1.data).toHaveLength(2);
      expect(b1.total).toBe(3);

      const p2 = await api()
        .get(`${prefix}/user?page=2&pageSize=2`)
        .set('Authorization', bearerList)
        .expect(200);
      expect((p2.body as PaginatedBody).data).toHaveLength(1);
    });

    it('pageSize acima do teto (>100) → 400 (ValidationPipe)', async () => {
      const res = await api().get(`${prefix}/user?pageSize=101`).set('Authorization', bearerList);
      expect(res.status).toBe(400);
    });

    it('outro tenant não enxerga estes usuários na lista', async () => {
      const bearerOther = `Bearer ${auth.sign({
        tenantId: 'tenant-outro',
        permissions: Object.values(PETSHOP_USERS),
      })}`;
      const res = await api().get(`${prefix}/user`).set('Authorization', bearerOther).expect(200);
      const nomes = (res.body as PaginatedBody).data.map((u) => u.username);
      expect(nomes).not.toContain('lista1');
    });
  });

  describe('Isolamento multi-tenant (Step 2) — tenant vem do claim, nunca do cliente', () => {
    let bearerB: string;

    beforeAll(() => {
      bearerB = `Bearer ${auth.sign({
        tenantId: 'tenant-b',
        permissions: Object.values(PETSHOP_USERS),
      })}`;
    });

    it('mesmo username pode existir em tenants diferentes (unicidade é por tenant)', async () => {
      const noTenantA = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'multiTenant' });
      expect(noTenantA.status).toBe(200);
      // no tenant-b NÃO é conflito — cada tenant vive na sua fatia
      const noTenantB = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearerB)
        .send({ username: 'multiTenant' });
      expect(noTenantB.status).toBe(200);
    });

    it('tenant não enxerga usuário de outro tenant (leitura, escrita e remoção → 404)', async () => {
      await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'soDoTenantA' })
        .expect(200);

      const read = await api().get(`${prefix}/user/soDoTenantA`).set('Authorization', bearerB);
      expect(read.status).toBe(404);
      const write = await api()
        .put(`${prefix}/user/soDoTenantA`)
        .set('Authorization', bearerB)
        .send({ email: 'invasor@email.com' });
      expect(write.status).toBe(404);
      const del = await api().delete(`${prefix}/user/soDoTenantA`).set('Authorization', bearerB);
      expect(del.status).toBe(404);

      // e o dono continua enxergando, intacto
      const own = await api()
        .get(`${prefix}/user/soDoTenantA`)
        .set('Authorization', bearer)
        .expect(200);
      expect((own.body as UserBody).email).toBeNull();
    });

    it('tenantId no body é rejeitado (whitelist estrita) — o claim é a única fonte', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'esperto', tenantId: 'tenant-de-outro' })
        .expect(400);
      expect((res.body as ErrorBody).code).toBe('BAD_REQUEST');
    });

    it('resposta nunca expõe tenant_id (coluna interna de isolamento)', async () => {
      const res = await api()
        .post(`${prefix}/user`)
        .set('Authorization', bearer)
        .send({ username: 'semVazamento' })
        .expect(200);
      expect(res.body).not.toHaveProperty('tenantId');
      expect(res.body).not.toHaveProperty('tenant_id');
    });
  });
});
