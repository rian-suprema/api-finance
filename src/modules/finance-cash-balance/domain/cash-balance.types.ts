/**
 * `BrandKey`/`BankType` são provisórios aqui — o catálogo real
 * (`BRANDS`/`BankType`) só chega em `cash-balance.constants.ts` na Fase 07.
 * Declarar como tipo próprio agora evita dependência cruzada com uma fase
 * futura; trocar pelo import do catálogo quando `cash-balance.constants.ts`
 * existir (decisão registrada em CLAUDE.md — Aprendizados críticos, Fase 02).
 */
export type BrandKey = string;
export type BankType = 'API' | 'MANUAL';

export interface BrandAccess {
  brand: BrandKey;
  tenantId: string;
}

// ─── KPIs (ClickHouse) ───────────────────────────────────────────────────────

export interface BrandAmount {
  brand: BrandKey;
  label: string;
  amount: number;
}

export interface KpiCard {
  total: number;
  byBrand: BrandAmount[];
}

export interface CashBalanceSummary {
  referenceDate: string;
  /** false quando o ClickHouse não está configurado ou indisponível. */
  available: boolean;
  depositsYesterday: KpiCard;
  withdrawalsYesterday: KpiCard;
  netDepositYesterday: KpiCard;
  depositsMonth: KpiCard;
  withdrawalsMonth: KpiCard;
  netDepositMonth: KpiCard;
}

// ─── Fechamento da Trio ──────────────────────────────────────────────────────

export interface TrioBalance {
  brand: BrandKey;
  /** null quando o fechamento do dia não foi capturado. */
  balance: number | null;
  available: boolean;
  /** Instante em que o saldo foi lido da Trio (ISO), null se não capturado. */
  capturedAt: string | null;
  /**
   * false quando a captura não convergiu (houve lançamento no intervalo da
   * leitura) e o valor merece conferência manual.
   */
  exact: boolean;
  message?: string;
}

// ─── Estado dos bancos ───────────────────────────────────────────────────────

export interface BankState {
  bank: string;
  label: string;
  type: BankType;
  /** Trio nunca é editável. */
  readOnly: boolean;
  balance: number;
  confirmed: boolean;
  /** true quando o valor é sugestão (último saldo registrado), não confirmado hoje. */
  suggested: boolean;
  /** false quando não há fechamento capturado — o card entra em estado de erro. */
  available: boolean;
  message?: string;
  /**
   * Quando o saldo foi lido da fonte (ISO). Só os bancos de API têm: deixa
   * explícito na tela que o valor é um fechamento capturado, não leitura viva.
   */
  capturedAt?: string | null;
  /** false quando a captura não convergiu e o valor merece conferência. */
  exact?: boolean;
}

export interface BrandBanksState {
  brand: BrandKey;
  label: string;
  status: 'DRAFT' | 'CONFIRMED';
  allBanksConfirmed: boolean;
  pendingBanks: string[];
  banks: BankState[];
  saldoTransacional: number;
  saldoJogadores: number | null;
  totalBalanco: number | null;
  acumuladoMensal: number;
  confirmedAt: string | null;
}

export interface CashBalanceBanksState {
  referenceDate: string;
  dayStatus: 'OPEN' | 'CLOSED';
  /** true quando as 3 marcas estão confirmadas e o dia foi fechado. */
  allBrandsConfirmed: boolean;
  brands: BrandBanksState[];
}

// ─── Histórico de balanços ───────────────────────────────────────────────────

/** Colunas numéricas de uma linha do histórico. */
export interface HistoryAmounts {
  deposits: number;
  withdrawals: number;
  netDeposit: number;
  saldoTransacional: number;
  saldoJogadores: number;
  totalBalanco: number;
  acumuladoMensal: number;
}

export interface HistoryBrandRow extends HistoryAmounts {
  brand: BrandKey;
  label: string;
}

export interface HistoryDay {
  referenceDate: string;
  dayStatus: 'OPEN' | 'CLOSED';
  brands: HistoryBrandRow[];
  /** Soma das marcas do dia — o consolidado que a tela do dia também mostra. */
  subtotal: HistoryAmounts;
}

/**
 * Totais do rodapé. Depósito, saque, net e balanço são fluxo e por isso são
 * somados. Saldo transacional, saldo de jogadores e acumulado mensal são
 * estoque: somar dias diferentes não produz número com significado contábil,
 * então vale o valor do último dia registrado do intervalo.
 */
export interface HistoryTotals {
  deposits: number;
  withdrawals: number;
  netDeposit: number;
  totalBalanco: number;
  lastDay: {
    referenceDate: string;
    saldoTransacional: number;
    saldoJogadores: number;
    acumuladoMensal: number;
  } | null;
}

export interface HistoryKpis {
  deposits: KpiCard;
  withdrawals: KpiCard;
  netDeposit: KpiCard;
  totalBalanco: KpiCard;
  netDepositDailyAverage: KpiCard;
  totalBalancoDailyAverage: KpiCard;
}

export interface CashBalanceHistory {
  from: string;
  to: string;
  /** Dias corridos do intervalo. */
  rangeDays: number;
  /** Dias do intervalo com balanço registrado — o que a tabela lista. */
  registeredDays: number;
  /** false quando o ClickHouse não está configurado ou indisponível. */
  kpisAvailable: boolean;
  kpis: HistoryKpis;
  days: HistoryDay[];
  totals: HistoryTotals;
}

export interface RegisterBrandResult {
  brand: BrandKey;
  referenceDate: string;
  saldoTransacional: number;
  saldoJogadores: number;
  totalBalanco: number;
  acumuladoMensal: number;
  dayStatus: 'OPEN' | 'CLOSED';
  allBrandsConfirmed: boolean;
}
