import type { BrandKey } from '../cash-balance.types';

export const CLOSING_BALANCE_SOURCE = Symbol('CLOSING_BALANCE_SOURCE');

export type ClosingBalanceMethod = 'POINT_IN_TIME' | 'SNAPSHOT' | 'RECONSTRUCTED';

export interface ClosingBalanceCapture {
  brand: BrandKey;
  accountId: string;
  balance: number;
  cutoffAt: Date;
  capturedAt: Date;
  exact: boolean;
  method: ClosingBalanceMethod;
}

/**
 * Porta de saída (Ports & Adapters) — o domínio depende desta interface,
 * nunca do adapter concreto da Trio. Permite trocar a fonte de fechamento
 * sem tocar use-cases.
 */
export interface ClosingBalanceSource {
  capture(brand: BrandKey, referenceDate: string): Promise<ClosingBalanceCapture>;
}
