import type { Movement, RunTotals, SettledMovement } from '../domain/reconciliation.types';
import type {
  ReconciliationFlow,
  ReconciliationItemStatus,
  ReconciliationMatchKey,
  ReconciliationRunStatus,
  ReconciliationSide,
} from '../reconciliation.enums';

/**
 * `brand`/`bank` são `string` nesta camada, não `BrandKey` — este módulo não
 * importa arquivo de outro módulo (decisão 10 do CLAUDE.md, "colaboração só
 * via service exportado"), e a coluna da entidade já é `varchar`. A validação
 * contra o catálogo de marcas conhecidas é responsabilidade do use-case
 * (Fase 13), via `BrandAccessService`.
 */

export interface StartRunParams {
  referenceDate: string;
  brand: string;
  bank: string;
  matchKey: ReconciliationMatchKey;
}

export interface StoredRun {
  id: number;
  referenceDate: string;
  brand: string;
  bank: string;
  status: ReconciliationRunStatus;
  matchKey: ReconciliationMatchKey;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  totals: RunTotals;
  matchedCount: number;
  pendingCount: number;
}

/** Execução como o histórico precisa: status e nada de totais. */
export interface RangeRun {
  referenceDate: string;
  brand: string;
  status: ReconciliationRunStatus;
  matchedCount: number;
}

export interface UpdateRunTotalsParams {
  matchedCount: number;
  pendingCount: number;
  totals: RunTotals;
}

export interface StoredItem {
  id: number;
  flow: ReconciliationFlow;
  side: ReconciliationSide;
  itemKey: string;
  amount: number;
  occurredAt: Date | null;
  endToEndId: string | null;
  counterpartyName: string | null;
  counterpartyTaxNumber: string | null;
  status: ReconciliationItemStatus;
  note: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  stillPending: boolean;
  platformReprocessPending: boolean;
}

export interface ItemCounts {
  total: number;
  /** Pendências que ainda bloqueiam a conciliação da marca. */
  open: number;
  /** Pendências já tratadas com nota. */
  resolved: number;
  /**
   * Estornos cuja operação segue aprovada na plataforma. Fora de `open`: não
   * bloqueia o dia, é reprocessamento a cobrar do time de pagamentos.
   */
  reprocessPending: number;
}

/** Pendências de um dia + marca, já agregadas pelo banco. */
export interface RangeItemCounts {
  open: number;
  /** Soma das pendências abertas, em reais. */
  openAmount: number;
  resolved: number;
}

/** Pendência reduzida ao que a busca de correção precisa. */
export interface CorrectionSearchItem {
  id: number;
  amount: number;
  /** CPF da contraparte, só dígitos. */
  taxNumber: string;
}

export interface SaveResultParams {
  runId: number;
  referenceDate: string;
  brand: string;
  bank: string;
  totals: RunTotals;
  matchedCount: number;
  pending: Movement[];
  /**
   * Estornos liquidados. Entram como item `RESOLVED` do sistema: não bloqueiam
   * o fechamento e ficam na lista de tratadas, porque devolução que desaparece
   * sem rastro é pior que pendência falsa.
   */
  settled?: SettledMovement[];
}

export interface ResolveItemsParams {
  ids: number[];
  noteById: Map<number, string>;
  userId: string;
}
