// [EXEMPLO] Rede de segurança no BANCO (Step 5 da integração SayPlus): o
// próprio PostgreSQL impõe o corte por tenant, abaixo da aplicação. Mesmo um
// bug de query que esqueça o `WHERE tenant_id` NÃO vaza dado entre tenants.
// O padrão (RLS + FORCE + policy por GUC + grants ao runtime) é do esqueleto;
// as tabelas específicas são do exemplo.
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Row-Level Security com FORCE e isolamento por GUC de sessão.
 *
 * Peças e porquês:
 * - ENABLE + **FORCE** ROW LEVEL SECURITY: sem FORCE, o dono da tabela (quem
 *   roda migrations) DRIBLA a RLS — e hoje o mesmo usuário fazia tudo, então a
 *   proteção seria nula. FORCE sujeita TODOS (menos superuser/BYPASSRLS).
 * - Policy por **GUC** `app.tenant_id`: a fatia visível é definida em runtime
 *   por `SET LOCAL app.tenant_id = '<tenant>'` (a aplicação faz isso por
 *   transação — ver src/database/tenant-context.ts). `current_setting(…, true)`
 *   com missing_ok: SEM o GUC setado, resolve NULL → `tenant_id = NULL` é falso
 *   → **zero linhas** (fail-safe: contexto ausente não vaza tudo, esconde tudo).
 * - **Separação de papéis**: a app conecta como um role de RUNTIME (não-owner);
 *   migrations rodam como OWNER. Os GRANTs abaixo dão ao runtime só DML — nunca
 *   DDL. O nome do role vem de DB_APP_ROLE (sem senha aqui); o role é criado
 *   fora da migration (initdb no local, Terraform no prod). Se o role não
 *   existir no ambiente, os GRANTs são pulados (grants podem vir do IaC).
 *
 * Roda DEPOIS de AddTenantId: o backfill precisa acontecer antes de o FORCE
 * passar a exigir GUC também nas escritas de migração.
 */
export class EnableRowLevelSecurity1756000000000 implements MigrationInterface {
  private static readonly TABLES = ['users'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const appRole = process.env.DB_APP_ROLE;

    for (const table of EnableRowLevelSecurity1756000000000.TABLES) {
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY "tenant_isolation" ON "${table}"
          FOR ALL
          USING ("tenant_id" = current_setting('app.tenant_id', true))
          WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true))
      `);
    }

    if (appRole) {
      // Grants condicionais: só se o role de runtime existir neste ambiente
      // (no prod os grants podem ser responsabilidade do IaC/SRE).
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
            GRANT USAGE ON SCHEMA public TO "${appRole}";
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}";
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}";
            -- objetos futuros herdam os mesmos grants (o owner os cria)
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
              GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
              GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}";
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of EnableRowLevelSecurity1756000000000.TABLES) {
      await queryRunner.query(`DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`);
      await queryRunner.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
  }
}
