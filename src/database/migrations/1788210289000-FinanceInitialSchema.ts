import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema completo do módulo Finance numa migration só — decisão registrada em
 * `docs/migracao-finance/MIGRACAO-FINANCE.md` §5.4: módulo novo dentro de
 * serviço novo, sem histórico de 7 migrations Prisma a replicar (a origem
 * conta essa história em `docs/migracao-finance/DADOS-FINANCE.md` §9.1; aqui
 * a história começa agora, com o estado final).
 *
 * PK `SERIAL` (regra 7 do archetype), não `UUID` como na origem — nenhuma
 * garantia de negócio depende do tipo da PK, cada upsert é por chave natural
 * (ver DADOS-FINANCE.md §7.1). `match_key` nasce `snake_case` desde o início
 * (a origem tinha `"matchKey"` sem `@map` — pegadinha de §2.1).
 *
 * Dois índices sem consumidor documentados em §9.2 foram deliberadamente
 * OMITIDOS desta migration: `cash_balance_days(status)` e
 * `cash_balance_daily(tenant_id, brand, reference_date)`. Pela mesma lógica
 * (índice sem consulta custa escrita em toda gravação, nascer com ele é
 * copiar dívida), também foram omitidos `cash_balance_bank_entries(daily_id)`
 * (redundante com o prefixo do `UNIQUE(daily_id, bank)`) e
 * `reconciliation_items(run_id)` (usado só pela FK, não por query de leitura).
 *
 * `up()` é dividido em métodos privados por sub-domínio (não por escolha de
 * estilo — é o que mantém cada função abaixo do limite de linhas do lint)
 * mas continua sendo UMA migration/classe só.
 */
export class FinanceInitialSchema1788210289000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createEnums(queryRunner);
    await this.createCashBalanceCore(queryRunner);
    await this.createCashBalanceEntriesAndSnapshots(queryRunner);
    await this.createTrioAndAuditTables(queryRunner);
    await this.createReconciliationTables(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Tabelas na ordem inversa da criação — filhas antes das mães (FK).
    await queryRunner.query(`DROP TABLE "reconciliation_items"`);
    await queryRunner.query(`DROP TABLE "reconciliation_runs"`);
    await queryRunner.query(`DROP TABLE "finance_audit_logs"`);
    await queryRunner.query(`DROP TABLE "trio_closing_balances"`);
    await queryRunner.query(`DROP TABLE "cash_balance_brand_snapshots"`);
    await queryRunner.query(`DROP TABLE "cash_balance_bank_entries"`);
    await queryRunner.query(`DROP TABLE "cash_balance_daily"`);
    await queryRunner.query(`DROP TABLE "cash_balance_days"`);

    await queryRunner.query(`DROP TYPE "reconciliation_item_status"`);
    await queryRunner.query(`DROP TYPE "reconciliation_side"`);
    await queryRunner.query(`DROP TYPE "reconciliation_flow"`);
    await queryRunner.query(`DROP TYPE "reconciliation_match_key"`);
    await queryRunner.query(`DROP TYPE "reconciliation_run_status"`);
    await queryRunner.query(`DROP TYPE "trio_closing_balance_method"`);
    await queryRunner.query(`DROP TYPE "cash_balance_bank_source"`);
    await queryRunner.query(`DROP TYPE "cash_balance_bank_type"`);
    await queryRunner.query(`DROP TYPE "cash_balance_brand_status"`);
    await queryRunner.query(`DROP TYPE "cash_balance_day_status"`);
  }

  // ── 10 enums nativos (DADOS-FINANCE.md §6) ────────────────────────────────
  private async createEnums(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "cash_balance_day_status" AS ENUM ('OPEN', 'CLOSED')`);
    await queryRunner.query(
      `CREATE TYPE "cash_balance_brand_status" AS ENUM ('DRAFT', 'CONFIRMED')`,
    );
    await queryRunner.query(`CREATE TYPE "cash_balance_bank_type" AS ENUM ('API', 'MANUAL')`);
    await queryRunner.query(`CREATE TYPE "cash_balance_bank_source" AS ENUM ('TRIO', 'MANUAL')`);
    await queryRunner.query(
      `CREATE TYPE "trio_closing_balance_method" AS ENUM ('POINT_IN_TIME', 'SNAPSHOT', 'RECONSTRUCTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "reconciliation_run_status" AS ENUM ('RUNNING', 'DONE', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "reconciliation_match_key" AS ENUM ('AMOUNT', 'EXTERNAL_KEY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "reconciliation_flow" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TREASURY')`,
    );
    await queryRunner.query(`CREATE TYPE "reconciliation_side" AS ENUM ('PLATFORM', 'BANK')`);
    await queryRunner.query(
      `CREATE TYPE "reconciliation_item_status" AS ENUM ('OPEN', 'RESOLVED')`,
    );
  }

  // ── cash_balance_days + cash_balance_daily — o dia e o dia×marca (§3.1/§3.2) ─
  private async createCashBalanceCore(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cash_balance_days" (
        "id"             SERIAL PRIMARY KEY,
        "reference_date" DATE NOT NULL UNIQUE,
        "status"         "cash_balance_day_status" NOT NULL DEFAULT 'OPEN',
        "closed_at"      TIMESTAMPTZ,
        "closed_by"      VARCHAR(100),
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"     TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_balance_daily" (
        "id"                 SERIAL PRIMARY KEY,
        "day_id"             INTEGER NOT NULL REFERENCES "cash_balance_days"("id"),
        "tenant_id"          VARCHAR(100) NOT NULL,
        "brand"              VARCHAR(50) NOT NULL,
        "reference_date"     DATE NOT NULL,
        "deposits_total"     NUMERIC(18,2) NOT NULL DEFAULT 0,
        "withdrawals_total"  NUMERIC(18,2) NOT NULL DEFAULT 0,
        "net_deposit"        NUMERIC(18,2) NOT NULL DEFAULT 0,
        "status"             "cash_balance_brand_status" NOT NULL DEFAULT 'DRAFT',
        "confirmed_at"       TIMESTAMPTZ,
        "confirmed_by"       VARCHAR(100),
        "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at"         TIMESTAMPTZ,
        UNIQUE ("reference_date", "brand")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_cash_balance_daily_day_id" ON "cash_balance_daily" ("day_id")`,
    );
  }

  // ── cash_balance_bank_entries + cash_balance_brand_snapshots (§3.3/§3.4) ────
  private async createCashBalanceEntriesAndSnapshots(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cash_balance_bank_entries" (
        "id"            SERIAL PRIMARY KEY,
        "daily_id"      INTEGER NOT NULL REFERENCES "cash_balance_daily"("id"),
        "bank"          VARCHAR(50) NOT NULL,
        "type"          "cash_balance_bank_type" NOT NULL,
        "source"        "cash_balance_bank_source" NOT NULL,
        "balance"       NUMERIC(18,2) NOT NULL DEFAULT 0,
        "confirmed"     BOOLEAN NOT NULL DEFAULT false,
        "confirmed_at"  TIMESTAMPTZ,
        "confirmed_by"  VARCHAR(100),
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("daily_id", "bank")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_balance_brand_snapshots" (
        "id"                  SERIAL PRIMARY KEY,
        "daily_id"            INTEGER NOT NULL UNIQUE REFERENCES "cash_balance_daily"("id"),
        "saldo_transacional"  NUMERIC(18,2) NOT NULL,
        "saldo_jogadores"     NUMERIC(18,2) NOT NULL,
        "total_balanco"       NUMERIC(18,2) NOT NULL,
        "acumulado_mensal"    NUMERIC(18,2) NOT NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  // ── trio_closing_balances + finance_audit_logs — sem FK (§3.5/§5) ──────────
  private async createTrioAndAuditTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trio_closing_balances" (
        "id"              SERIAL PRIMARY KEY,
        "reference_date"  DATE NOT NULL,
        "brand"           VARCHAR(50) NOT NULL,
        "bank_account_id" VARCHAR(100) NOT NULL,
        "balance"         NUMERIC(18,2) NOT NULL,
        "cutoff_at"       TIMESTAMPTZ NOT NULL,
        "captured_at"     TIMESTAMPTZ NOT NULL,
        "exact"           BOOLEAN NOT NULL DEFAULT true,
        "method"          "trio_closing_balance_method" NOT NULL,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("reference_date", "brand")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_trio_closing_balances_reference_date" ON "trio_closing_balances" ("reference_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE "finance_audit_logs" (
        "id"          SERIAL PRIMARY KEY,
        "user_id"     VARCHAR(100) NOT NULL,
        "tenant_id"   VARCHAR(100),
        "action"      VARCHAR(50) NOT NULL,
        "entity"      VARCHAR(100) NOT NULL,
        "entity_id"   VARCHAR(100),
        "after"       JSONB,
        "ip"          VARCHAR(100),
        "user_agent"  VARCHAR(255),
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_finance_audit_logs_user_id_created_at" ON "finance_audit_logs" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_finance_audit_logs_entity_entity_id" ON "finance_audit_logs" ("entity", "entity_id")`,
    );
  }

  // ── reconciliation_runs + reconciliation_items (§4.1/§4.2) ──────────────────
  private async createReconciliationTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reconciliation_runs" (
        "id"                            SERIAL PRIMARY KEY,
        "reference_date"                DATE NOT NULL,
        "brand"                         VARCHAR(50) NOT NULL,
        "bank"                          VARCHAR(50) NOT NULL,
        "status"                        "reconciliation_run_status" NOT NULL,
        "match_key"                     "reconciliation_match_key" NOT NULL,
        "started_at"                    TIMESTAMPTZ NOT NULL,
        "finished_at"                   TIMESTAMPTZ,
        "error"                         TEXT,
        "platform_deposits_total"       NUMERIC(18,2) NOT NULL DEFAULT 0,
        "platform_deposits_count"       INTEGER NOT NULL DEFAULT 0,
        "bank_deposits_total"           NUMERIC(18,2) NOT NULL DEFAULT 0,
        "bank_deposits_count"           INTEGER NOT NULL DEFAULT 0,
        "platform_withdrawals_total"    NUMERIC(18,2) NOT NULL DEFAULT 0,
        "platform_withdrawals_count"    INTEGER NOT NULL DEFAULT 0,
        "bank_withdrawals_total"        NUMERIC(18,2) NOT NULL DEFAULT 0,
        "bank_withdrawals_count"        INTEGER NOT NULL DEFAULT 0,
        "treasury_total"                NUMERIC(18,2) NOT NULL DEFAULT 0,
        "treasury_count"                INTEGER NOT NULL DEFAULT 0,
        "fees_total"                    NUMERIC(18,2) NOT NULL DEFAULT 0,
        "fees_count"                    INTEGER NOT NULL DEFAULT 0,
        "deposits_crossover_total"      NUMERIC(18,2) NOT NULL DEFAULT 0,
        "deposits_crossover_count"      INTEGER NOT NULL DEFAULT 0,
        "withdrawals_crossover_total"   NUMERIC(18,2) NOT NULL DEFAULT 0,
        "withdrawals_crossover_count"   INTEGER NOT NULL DEFAULT 0,
        "matched_count"                 INTEGER NOT NULL DEFAULT 0,
        "pending_count"                 INTEGER NOT NULL DEFAULT 0,
        "created_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("reference_date", "brand", "bank")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reconciliation_items" (
        "id"                          SERIAL PRIMARY KEY,
        "run_id"                      INTEGER NOT NULL REFERENCES "reconciliation_runs"("id"),
        "reference_date"              DATE NOT NULL,
        "brand"                       VARCHAR(50) NOT NULL,
        "bank"                        VARCHAR(50) NOT NULL,
        "flow"                        "reconciliation_flow" NOT NULL,
        "side"                        "reconciliation_side" NOT NULL,
        "item_key"                    VARCHAR(255) NOT NULL,
        "amount"                      NUMERIC(18,2) NOT NULL,
        "occurred_at"                 TIMESTAMPTZ,
        "external_key"                VARCHAR(255),
        "end_to_end_id"               VARCHAR(255),
        "counterparty_name"           VARCHAR(255),
        "counterparty_tax_number"     VARCHAR(20),
        "status"                      "reconciliation_item_status" NOT NULL,
        "note"                        TEXT,
        "resolved_at"                 TIMESTAMPTZ,
        "resolved_by"                 VARCHAR(100),
        "still_pending"               BOOLEAN NOT NULL DEFAULT true,
        "platform_reprocess_pending"  BOOLEAN NOT NULL DEFAULT false,
        "created_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE ("reference_date", "brand", "bank", "side", "item_key")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_reconciliation_items_reference_date_brand_status" ON "reconciliation_items" ("reference_date", "brand", "status")`,
    );
  }
}
