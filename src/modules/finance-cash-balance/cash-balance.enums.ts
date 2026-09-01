/**
 * Enums nativos do Postgres do domínio Balanço de Caixa. Nomes e valores
 * espelham `docs/migracao-finance/DADOS-FINANCE.md` §6 — a migration cria os
 * tipos com o mesmo nome em `snake_case` (`cash_balance_day_status`, etc.).
 */
export enum CashBalanceDayStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum CashBalanceBrandStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
}

/** `API` só para o banco `trio` hoje; `MANUAL` para os outros 7 do catálogo. */
export enum CashBalanceBankType {
  API = 'API',
  MANUAL = 'MANUAL',
}

/** Redundante com `CashBalanceBankType` hoje — mantido por paridade com a origem. */
export enum CashBalanceBankSource {
  TRIO = 'TRIO',
  MANUAL = 'MANUAL',
}

/**
 * Rótulo de confiabilidade do fechamento capturado. `SNAPSHOT` e
 * `RECONSTRUCTED` são valores mortos (nenhum código desta trilha os escreve)
 * mantidos só para identificar linhas históricas, caso algum dia sejam
 * portadas — ver DADOS-FINANCE.md §3.5.
 */
export enum TrioClosingBalanceMethod {
  POINT_IN_TIME = 'POINT_IN_TIME',
  SNAPSHOT = 'SNAPSHOT',
  RECONSTRUCTED = 'RECONSTRUCTED',
}
