// [EXEMPLO] Schema do domínio Users. No seu serviço, substitua pela SUA
// migration inicial — o padrão (SQL explícito, synchronize:false) é do esqueleto.
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema inicial do exemplo: apenas a tabela `users`.
 * SQL explícito: migration é código de produção — revisável em PR e determinística.
 */
export class InitialSchema1754560000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"          SERIAL PRIMARY KEY,
        "username"    VARCHAR(100) NOT NULL UNIQUE,
        "first_name"  VARCHAR(100),
        "last_name"   VARCHAR(100),
        "email"       VARCHAR(255),
        "password"    VARCHAR(255),
        "phone"       VARCHAR(30),
        "user_status" INTEGER NOT NULL DEFAULT 0,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
