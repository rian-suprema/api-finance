import type { BrandKey } from '../cash-balance.constants';
import type { CashBalanceBrandStatus, CashBalanceDayStatus } from '../cash-balance.enums';

export interface BankEntryRecord {
  bank: string;
  balance: number;
  confirmed: boolean;
}

export interface BrandDailyRecord {
  id: number;
  brand: BrandKey;
  status: CashBalanceBrandStatus;
  confirmedAt: Date | null;
  entries: BankEntryRecord[];
  snapshot: {
    saldoTransacional: number;
    saldoJogadores: number;
    totalBalanco: number;
    acumuladoMensal: number;
  } | null;
}

export interface DayRecord {
  status: CashBalanceDayStatus;
  brands: BrandDailyRecord[];
}

export interface ConfirmBankParams {
  referenceDate: string;
  brand: BrandKey;
  tenantId: string;
  bank: string;
  balance: number;
  userId: string;
}

export interface RegisterBrandParams {
  referenceDate: string;
  brand: BrandKey;
  tenantId: string;
  userId: string;
  trioBalance: number;
  saldoJogadores: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  /** Marcas que precisam estar confirmadas para o dia fechar. */
  requiredBrands: number;
}

/**
 * Valida e extrai os saldos manuais confirmados a partir das linhas de
 * `cash_balance_bank_entries` já travadas (`SELECT ... FOR UPDATE`) dentro da
 * transação de `registerBrand` — nunca de uma leitura anterior à transação,
 * que é justamente a janela de corrida que este contrato fecha (uma
 * confirmação concorrente entre a leitura e o commit não pode ser
 * sobrescrita por um valor obsoleto). Deve lançar se algum banco obrigatório
 * não estiver confirmado.
 */
export type ResolveManualBalances = (lockedEntries: BankEntryRecord[]) => Map<string, number>;

export interface RegisterBrandOutcome {
  acumuladoMensal: number;
  dayClosed: boolean;
  saldoTransacional: number;
  totalBalanco: number;
}

/** Carga de um dia + marca a partir de fonte externa (planilha histórica). */
export interface ImportBrandBalanceParams {
  referenceDate: string;
  brand: BrandKey;
  tenantId: string;
  /** Marcador de origem gravado em `confirmed_by`, para auditoria. */
  importedBy: string;
  /** Saldo de cada banco do catálogo — chave do banco para valor. */
  bankBalances: Map<string, number>;
  saldoTransacional: number;
  saldoJogadores: number;
  totalBalanco: number;
}

/** Uma linha do histórico: um dia + uma marca já registrada. */
export interface RegisteredBalanceRecord {
  referenceDate: string;
  brand: BrandKey;
  dayStatus: CashBalanceDayStatus;
  saldoTransacional: number;
  saldoJogadores: number;
  totalBalanco: number;
  acumuladoMensal: number;
}
