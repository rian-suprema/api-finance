/**
 * Enums nativos do Postgres do domínio Conciliação Bancária. Nomes e valores
 * espelham `docs/migracao-finance/DADOS-FINANCE.md` §6 — a migration cria os
 * tipos com o mesmo nome em `snake_case` (`reconciliation_run_status`, etc.).
 */

/** `NOT_RUN` não é valor de banco: é a ausência de linha, calculada na leitura. */
export enum ReconciliationRunStatus {
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/** `AMOUNT` é morto — algoritmo removido em 13/08/2026; só `EXTERNAL_KEY` é gravado. */
export enum ReconciliationMatchKey {
  AMOUNT = 'AMOUNT',
  EXTERNAL_KEY = 'EXTERNAL_KEY',
}

/** `TREASURY` nunca é pendência — débito/crédito com contraparte no CNPJ próprio. */
export enum ReconciliationFlow {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TREASURY = 'TREASURY',
}

/** Parte da chave natural do item — registro da plataforma × extrato bancário. */
export enum ReconciliationSide {
  PLATFORM = 'PLATFORM',
  BANK = 'BANK',
}

export enum ReconciliationItemStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
}
