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
  manualBalances: Map<string, number>;
  saldoJogadores: number;
  saldoTransacional: number;
  totalBalanco: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  /** Marcas que precisam estar confirmadas para o dia fechar. */
  requiredBrands: number;
}

export interface RegisterBrandOutcome {
  acumuladoMensal: number;
  dayClosed: boolean;
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
