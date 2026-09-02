export type ReconciliationSide = 'PLATFORM' | 'BANK';

export type ReconciliationFlow = 'DEPOSIT' | 'WITHDRAWAL' | 'TREASURY';

/**
 * Um lançamento de qualquer uma das duas pontas, normalizado para o casamento.
 *
 * Valor em centavos inteiros e sempre positivo: o sentido está em `flow` e
 * `side`, e somar milhares de floats introduz erro que o casamento não perdoa.
 */
export interface Movement {
  side: ReconciliationSide;
  flow: ReconciliationFlow;
  /** Identificador estável na origem — é o que ancora a nota da pendência. */
  key: string;
  amountCents: number;
  /**
   * true quando o lançamento está dentro do dia de referência; false quando
   * está num dia vizinho (ver `PLATFORM_NEIGHBOUR_DAYS`). Só lançamento `core`
   * pode virar pendência: o do dia vizinho é conciliado no dia dele.
   */
  core: boolean;
  /** Instante do lançamento. A Trio não informa, então fica nulo no banco. */
  occurredAt?: Date;
  /**
   * Identificador do gateway, o único critério de casamento:
   * `gateway_external_id` do mart contra `external_id` do extrato. Ausente é
   * anomalia de origem — o lançamento vira pendência em vez de casar por
   * aproximação.
   */
  externalKey?: string;
  endToEndId?: string;
  counterpartyName?: string;
  counterpartyTaxNumber?: string;
  /**
   * `ref_type` do extrato: que operação a linha é (`collection`, `payment`,
   * `payment_refund`). Só o lado do banco preenche — a plataforma não tem o
   * conceito. É o que distingue estorno de depósito, coisa que o sinal do valor
   * não distingue. Ver `refund-settlement.ts`.
   */
  refType?: string;
}

/**
 * Um estorno liquidado, com a nota que explica a liquidação.
 *
 * Não é pendência: entra na tela já tratada, para o operador ver que houve
 * devolução sem ter trabalho com ela.
 */
export interface SettledMovement {
  movement: Movement;
  note: string;
  /**
   * true quando a operação estornada **ainda está aprovada na plataforma**. O
   * caixa está fechado, mas o jogador teve saldo movimentado por um pagamento
   * que o banco desfez: alguém precisa reprocessar ou devolver o saldo. É o que
   * a tela sinaliza para o operador cobrar o time de pagamentos.
   */
  platformReprocessPending: boolean;
}

export interface SideTotals {
  total: number;
  count: number;
}

export interface FlowMatch {
  flow: ReconciliationFlow;
  matchedCount: number;
  /**
   * Pares em que um lado caiu dentro do dia e o outro num dia vizinho — o PIX
   * que o banco postou hoje e a plataforma registrou ontem ou amanhã. `total` é
   * quanto isso desloca a diferença `banco − plataforma`, e é o que explica
   * diferença de valor sem nenhuma pendência aberta.
   */
  crossEdge: SideTotals;
  /**
   * Chaves repetidas do mesmo lado na janela.
   *
   * **Não é necessariamente defeito.** A chave do gateway identifica a
   * *cobrança*, não a transferência: jogador que paga o mesmo QR duas vezes gera
   * dois créditos com a mesma chave e EndToEnd diferente. O casamento pareia um
   * e deixa o outro como pendência, que é o certo — há dinheiro a mais na conta.
   */
  duplicateKeys: number;
  /**
   * Pendências que sobraram por **não ter chave**, não por não ter par. Também
   * esperado zero, pelo mesmo motivo.
   */
  withoutKey: number;
  /** Sobras dentro do dia — as pendências. */
  pending: Movement[];
  /** Sobras nos dias vizinhos: são conciliadas no dia delas, não são pendência. */
  edgeLeftovers: Movement[];
}

export interface RunTotals {
  platformDeposits: SideTotals;
  bankDeposits: SideTotals;
  platformWithdrawals: SideTotals;
  bankWithdrawals: SideTotals;
  treasury: SideTotals;
  fees: SideTotals;
  /** Depósitos que atravessaram a virada do dia (ver `FlowMatch.crossEdge`). */
  depositsCrossover: SideTotals;
  /** Saques que atravessaram a virada do dia. */
  withdrawalsCrossover: SideTotals;
}

/**
 * Confiança do candidato a explicação da pendência, do mais forte ao mais fraco.
 *
 * - `EXACT_SAME_BRAND`: correção do mesmo jogador, na mesma marca do pagamento,
 *   com o valor no centavo.
 * - `EXACT_OTHER_BRAND`: mesmo CPF, valor exato, mas a correção está em outra
 *   marca do grupo.
 * - `SUM`: soma de 2 ou 3 correções do mesmo CPF fecha o valor do pagamento.
 * - `PARTIAL`: existe correção do mesmo CPF na janela, com **valor diferente**.
 *   Não explica o pagamento; é o fio para investigar.
 */
export type CorrectionConfidence = 'EXACT_SAME_BRAND' | 'EXACT_OTHER_BRAND' | 'SUM' | 'PARTIAL';

/**
 * Views da API (Fase 13) — portadas só agora porque dependiam de `BrandKey`
 * (ver Fase 01). Ficam como `brand: string`, não `BrandKey`: mesma decisão já
 * tomada em `reconciliation.repository.types.ts` (este módulo não importa
 * arquivo de outro módulo — decisão 10 do CLAUDE.md).
 */

/** Resultado de uma marca depois de `RunReconciliationUseCase.execute`. */
export interface RunOutcome {
  referenceDate: string;
  brand: string;
  matchedCount?: number;
  pendingCount?: number;
  /** Presente quando a marca não pôde ser conciliada (config ausente, exceção, reentrância). */
  error?: string;
}

export type ReconciliationStatus = 'NOT_RUN' | 'RUNNING' | 'FAILED' | 'DONE';

export interface ReconciliationItemView {
  id: number;
  flow: ReconciliationFlow;
  side: ReconciliationSide;
  amount: number;
  occurredAt: Date | null;
  endToEndId: string | null;
  counterpartyName: string | null;
  /** Formatado e completo (`formatTaxNumber`) — ver DADOS-FINANCE.md/REGRAS-NEGOCIO-ROTAS.md §3.8. */
  counterpartyTaxNumber: string | null;
  status: string;
  note: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  stillPending: boolean;
  platformReprocessPending: boolean;
}

export interface ReconciliationBrandView {
  brand: string;
  status: ReconciliationStatus;
  message?: string;
  /** Reflete só o `Set` em memória do processo que respondeu — ver §3.1. */
  running: boolean;
  matchedCount: number;
  openCount: number;
  resolvedCount: number;
  reprocessPendingCount: number;
  itemsTruncated: boolean;
  totals: RunTotals;
  depositsDifference: number;
  withdrawalsDifference: number;
  reconciled: boolean;
  items: ReconciliationItemView[];
}

export interface ReconciliationResult {
  referenceDate: string;
  brands: ReconciliationBrandView[];
  allReconciled: boolean;
}

export type ReconciliationDayStatus = 'NOT_RUN' | 'FAILED' | 'RUNNING' | 'PENDING' | 'RECONCILED';

export interface ReconciliationHistoryBrandRow {
  brand: string;
  status: ReconciliationDayStatus;
}

export interface ReconciliationHistoryDay {
  referenceDate: string;
  status: ReconciliationDayStatus;
  brands: ReconciliationHistoryBrandRow[];
}

export interface ReconciliationHistoryResult {
  from: string;
  to: string;
  rangeDays: number;
  days: ReconciliationHistoryDay[];
  reconciledDays: number;
  pendingDays: number;
  missingDays: number;
  openCount: number;
  openAmount: number;
  resolvedCount: number;
  allReconciled: boolean;
}
