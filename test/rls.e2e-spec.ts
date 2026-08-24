import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { InitialSchema1754560000000 } from '../src/database/migrations/1754560000000-InitialSchema';
import { AddTenantId1755000000000 } from '../src/database/migrations/1755000000000-AddTenantId';
import { EnableRowLevelSecurity1756000000000 } from '../src/database/migrations/1756000000000-EnableRowLevelSecurity';

/**
 * Prova da REDE DE SEGURANÇA no banco (Step 5) — no nível de conexão, sem a
 * aplicação: o PostgreSQL SOZINHO impede o vazamento entre tenants, mesmo que
 * a camada de aplicação falhasse em filtrar.
 *
 * Encenamos a separação de papéis REAL de produção — e o detalhe que torna o
 * FORCE indispensável: o superusuário do container SEMPRE dribla a RLS (nem
 * FORCE o afeta). Por isso o owner das tabelas é um role DEDICADO não-super:
 *   • owner (users_owner)  → cria schema/RLS (migrations) e semeia; NÃO é super,
 *     logo o FORCE também o alcança;
 *   • runtime (users_app)  → role não-owner que a aplicação usa; é sobre ele
 *     que policy + FORCE agem no dia a dia.
 */
describe('Row-Level Security + FORCE (e2e de banco)', () => {
  let postgres: StartedPostgreSqlContainer;
  let owner: DataSource;
  let runtime: DataSource;

  const OWNER_ROLE = 'users_owner';
  const APP_ROLE = 'users_app';
  const PW = 'pw_test';

  const base = () => ({
    type: 'postgres' as const,
    host: postgres.getHost(),
    port: postgres.getPort(),
    password: PW,
    database: postgres.getDatabase(),
  });

  // TypeORM `.query()` retorna `any` por design; o tipo de retorno fica fixado aqui.
  const rows = async (ds: DataSource, sql: string): Promise<Record<string, unknown>[]> =>
    ds.query(sql);

  const asTenant = async (
    ds: DataSource,
    tenantId: string,
    sql: string,
  ): Promise<Record<string, unknown>[]> => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      // set_config(..., true) = SET LOCAL: vale só nesta transação
      await runner.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = (await runner.query(sql)) as Record<string, unknown>[];
      await runner.commitTransaction();
      return result;
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  };

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();

    // 1. Bootstrap como superuser: cria os DOIS roles reais (no local isto é o
    //    initdb; no prod, o IaC/Terraform). O owner é NÃO-super de propósito.
    const su = new DataSource({
      ...base(),
      username: postgres.getUsername(),
      password: postgres.getPassword(),
    });
    await su.initialize();
    await su.query(`CREATE ROLE "${OWNER_ROLE}" LOGIN PASSWORD '${PW}'`);
    await su.query(`CREATE ROLE "${APP_ROLE}" LOGIN PASSWORD '${PW}'`);
    await su.query(`GRANT CREATE, USAGE ON SCHEMA public TO "${OWNER_ROLE}"`);
    await su.destroy();

    // 2. Migrations como OWNER dedicado → as tabelas pertencem a ele (FORCE o
    //    alcança). DB_APP_ROLE aponta o runtime → a migration concede os grants.
    process.env.DB_APP_ROLE = APP_ROLE;
    owner = new DataSource({
      ...base(),
      username: OWNER_ROLE,
      migrations: [
        InitialSchema1754560000000,
        AddTenantId1755000000000,
        EnableRowLevelSecurity1756000000000,
      ],
    });
    await owner.initialize();
    await owner.runMigrations();

    // 3. Semeia dois tenants — o owner também está sob FORCE: precisa do GUC
    await asTenant(
      owner,
      'tenant-a',
      `INSERT INTO "users"("tenant_id","username") VALUES ('tenant-a','alice')`,
    );
    await asTenant(
      owner,
      'tenant-b',
      `INSERT INTO "users"("tenant_id","username") VALUES ('tenant-b','bob')`,
    );

    // 4. Conexão de RUNTIME (o que a app usa)
    runtime = new DataSource({ ...base(), username: APP_ROLE });
    await runtime.initialize();
  });

  afterAll(async () => {
    await runtime?.destroy();
    await owner?.destroy();
    await postgres?.stop();
  });

  it('runtime SEM GUC de tenant → enxerga ZERO linhas (fail-safe: esconde tudo)', async () => {
    const result = await rows(runtime, `SELECT * FROM "users"`);
    expect(result).toHaveLength(0);
  });

  it('runtime COM GUC do tenant A → enxerga só o tenant A', async () => {
    const visible = await asTenant(runtime, 'tenant-a', `SELECT username FROM "users"`);
    expect(visible).toEqual([{ username: 'alice' }]);
  });

  it('runtime COM GUC do tenant B → enxerga só o tenant B', async () => {
    const visible = await asTenant(runtime, 'tenant-b', `SELECT username FROM "users"`);
    expect(visible).toEqual([{ username: 'bob' }]);
  });

  it('runtime NÃO consegue gravar linha fora do seu tenant (WITH CHECK bloqueia)', async () => {
    await expect(
      asTenant(
        runtime,
        'tenant-a',
        `INSERT INTO "users"("tenant_id","username") VALUES ('tenant-b','intruso')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('runtime NÃO apaga linha de outro tenant (invisível → 0 afetadas)', async () => {
    await asTenant(runtime, 'tenant-a', `DELETE FROM "users" WHERE username = 'bob'`);
    // bob é do tenant-b: invisível para o contexto tenant-a → segue intacto
    const stillThere = await asTenant(runtime, 'tenant-b', `SELECT username FROM "users"`);
    expect(stillThere).toEqual([{ username: 'bob' }]);
  });

  it('FORCE está ativo: nem o OWNER (não-super) dribla a RLS sem o GUC', async () => {
    // O "zero protection" do DB_USERNAME único deixou de existir: o dono das
    // tabelas, sem GUC, também vê zero.
    const result = await rows(owner, `SELECT * FROM "users"`);
    expect(result).toHaveLength(0);
  });
});
