import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separação de papéis no banco: a app conecta como um role de RUNTIME
 * (não-owner); as migrations rodam como OWNER. Os GRANTs abaixo dão ao runtime
 * só DML — nunca DDL. Os CronJobs usam a mesma credencial de runtime.
 *
 * No archetype estes grants moravam na migration de RLS por tenant. O Finance
 * removeu a RLS de tenant, e os grants foram junto — no Aurora (owner e
 * runtime separados, IaC-AWS ADR-008/ADR-015) a app tomaria `permission
 * denied` em toda tabela. Local e CI não mostravam: lá tudo roda com um único
 * superusuário.
 *
 * O nome do role vem de DB_APP_ROLE (sem senha aqui); o role é criado fora da
 * migration (initdb no local, Terraform no Aurora). Sem DB_APP_ROLE, ou se o
 * role não existir no ambiente, os GRANTs são pulados (fluxo de usuário único).
 * `ALTER DEFAULT PRIVILEGES` cobre as tabelas que migrations futuras criarem.
 */
export class GrantRuntimeRole1788210290000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const appRole = process.env.DB_APP_ROLE;
    if (!appRole) return;
    // O nome entra no SQL como identificador: só o formato de role do Postgres.
    if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) {
      throw new Error(`DB_APP_ROLE inválido: "${appRole}" (esperado [a-z_][a-z0-9_]*)`);
    }

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

  public async down(queryRunner: QueryRunner): Promise<void> {
    const appRole = process.env.DB_APP_ROLE;
    if (!appRole || !/^[a-z_][a-z0-9_]*$/.test(appRole)) return;

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE USAGE, SELECT ON SEQUENCES FROM "${appRole}";
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
            REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "${appRole}";
          REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM "${appRole}";
          REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM "${appRole}";
        END IF;
      END $$;
    `);
  }
}
