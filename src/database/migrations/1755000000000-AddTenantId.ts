// [EXEMPLO] Isolamento multi-tenant do domínio Users (Step 2 da integração
// SayPlus). No seu serviço, o padrão fica: toda tabela de domínio carrega
// tenant_id e as unicidades de negócio viram compostas (tenant_id, ...).
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona `tenant_id` e troca a unicidade GLOBAL de username pela unicidade
 * POR TENANT. Backfill: linhas pré-existentes (ambiente de dev/exemplo)
 * recebem 'tenant-default' — em produção real este caso não existe, pois a
 * coluna nasce junto com a tabela.
 */
export class AddTenantId1755000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "tenant_id" VARCHAR(100)`);
    await queryRunner.query(
      `UPDATE "users" SET "tenant_id" = 'tenant-default' WHERE "tenant_id" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_username_key"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "uq_users_tenant_username" UNIQUE ("tenant_id", "username")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "uq_users_tenant_username"`);
    // Pode falhar se tenants diferentes tiverem o mesmo username — resolução
    // manual consciente é preferível a um down que apaga dados.
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "users_username_key" UNIQUE ("username")`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "tenant_id"`);
  }
}
