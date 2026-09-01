import type { EntityManager } from 'typeorm';

import type { BrandKey } from '../cash-balance.constants';
import { CashBalanceBrandStatus } from '../cash-balance.enums';
import type { CashBalanceBankSource, CashBalanceBankType } from '../cash-balance.enums';
import { CashBalanceBankEntry } from '../entities/cash-balance-bank-entry.entity';
import { CashBalanceBrandSnapshot } from '../entities/cash-balance-brand-snapshot.entity';
import { CashBalanceDaily } from '../entities/cash-balance-daily.entity';
import { CashBalanceDay } from '../entities/cash-balance-day.entity';
import type { BankEntryRecord, BrandDailyRecord } from './cash-balance.repository.types';

/**
 * Upserts elementares usados por `CashBalanceRepository` dentro de uma
 * transação — extraídos para arquivo próprio só por tamanho (limite de 400
 * linhas por arquivo do ESLint); não têm estado e recebem o `EntityManager`
 * transacional como parâmetro, nunca abrem transação própria.
 */

export function toBrandDailyRecord(daily: CashBalanceDaily): BrandDailyRecord {
  return {
    id: daily.id,
    brand: daily.brand as BrandKey,
    status: daily.status,
    confirmedAt: daily.confirmedAt ?? null,
    entries: daily.bankEntries.map((entry) => ({
      bank: entry.bank,
      balance: entry.balance,
      confirmed: entry.confirmed,
    })),
    snapshot: daily.snapshot
      ? {
          saldoTransacional: daily.snapshot.saldoTransacional,
          saldoJogadores: daily.snapshot.saldoJogadores,
          totalBalanco: daily.snapshot.totalBalanco,
          acumuladoMensal: daily.snapshot.acumuladoMensal,
        }
      : null,
  };
}

export async function upsertDay(
  manager: EntityManager,
  referenceDate: string,
): Promise<CashBalanceDay> {
  const existing = await manager
    .getRepository(CashBalanceDay)
    .findOne({ where: { referenceDate } });
  if (existing) return existing;

  return manager
    .getRepository(CashBalanceDay)
    .save(manager.getRepository(CashBalanceDay).create({ referenceDate }));
}

export interface UpsertDailyParams {
  dayId: number;
  tenantId: string;
  brand: BrandKey;
  referenceDate: string;
  status?: CashBalanceBrandStatus;
  confirmedAt?: Date;
  confirmedBy?: string;
  depositsTotal?: number;
  withdrawalsTotal?: number;
  netDeposit?: number;
  clearDeletedAt?: boolean;
}

export async function upsertDaily(
  manager: EntityManager,
  params: UpsertDailyParams,
): Promise<CashBalanceDaily> {
  const repo = manager.getRepository(CashBalanceDaily);
  const existing = await repo.findOne({
    where: { referenceDate: params.referenceDate, brand: params.brand },
  });

  if (existing) {
    repo.merge(existing, {
      ...(params.status && { status: params.status }),
      ...(params.confirmedAt !== undefined && { confirmedAt: params.confirmedAt }),
      ...(params.confirmedBy !== undefined && { confirmedBy: params.confirmedBy }),
      ...(params.depositsTotal !== undefined && { depositsTotal: params.depositsTotal }),
      ...(params.withdrawalsTotal !== undefined && { withdrawalsTotal: params.withdrawalsTotal }),
      ...(params.netDeposit !== undefined && { netDeposit: params.netDeposit }),
      ...(params.clearDeletedAt && { deletedAt: null }),
    });
    return repo.save(existing);
  }

  return repo.save(
    repo.create({
      dayId: params.dayId,
      tenantId: params.tenantId,
      brand: params.brand,
      referenceDate: params.referenceDate,
      status: params.status ?? CashBalanceBrandStatus.DRAFT,
      confirmedAt: params.confirmedAt,
      confirmedBy: params.confirmedBy,
      depositsTotal: params.depositsTotal ?? 0,
      withdrawalsTotal: params.withdrawalsTotal ?? 0,
      netDeposit: params.netDeposit ?? 0,
    }),
  );
}

/**
 * Trava as linhas de bank_entries do `daily` (`SELECT ... FOR UPDATE`) —
 * qualquer `UPDATE` concorrente na mesma linha (ex.: `confirmBank` de outro
 * request) bloqueia até esta transação terminar. É o que fecha a janela de
 * corrida entre ler o saldo confirmado e gravar o snapshot do `registerBrand`.
 */
export async function lockBankEntries(
  manager: EntityManager,
  dailyId: number,
): Promise<BankEntryRecord[]> {
  const rows = await manager
    .getRepository(CashBalanceBankEntry)
    .createQueryBuilder('entry')
    .setLock('pessimistic_write')
    .where('entry.dailyId = :dailyId', { dailyId })
    .getMany();

  return rows.map((row) => ({ bank: row.bank, balance: row.balance, confirmed: row.confirmed }));
}

export interface UpsertBankEntryParams {
  dailyId: number;
  bank: string;
  type: CashBalanceBankType;
  source: CashBalanceBankSource;
  balance: number;
  confirmed: boolean;
  confirmedAt: Date;
  confirmedBy: string | null;
}

export async function upsertBankEntry(
  manager: EntityManager,
  params: UpsertBankEntryParams,
): Promise<void> {
  const repo = manager.getRepository(CashBalanceBankEntry);
  const existing = await repo.findOne({ where: { dailyId: params.dailyId, bank: params.bank } });

  if (existing) {
    repo.merge(existing, {
      balance: params.balance,
      confirmed: params.confirmed,
      confirmedAt: params.confirmedAt,
      confirmedBy: params.confirmedBy,
    });
    await repo.save(existing);
    return;
  }

  await repo.save(
    repo.create({
      dailyId: params.dailyId,
      bank: params.bank,
      type: params.type,
      source: params.source,
      balance: params.balance,
      confirmed: params.confirmed,
      confirmedAt: params.confirmedAt,
      confirmedBy: params.confirmedBy,
    }),
  );
}

export interface UpsertSnapshotParams {
  saldoTransacional: number;
  saldoJogadores: number;
  totalBalanco: number;
  acumuladoMensal: number;
  keepAcumuladoOnUpdate?: boolean;
}

export async function upsertSnapshot(
  manager: EntityManager,
  dailyId: number,
  params: UpsertSnapshotParams,
): Promise<void> {
  const repo = manager.getRepository(CashBalanceBrandSnapshot);
  const existing = await repo.findOne({ where: { dailyId } });

  if (existing) {
    repo.merge(existing, {
      saldoTransacional: params.saldoTransacional,
      saldoJogadores: params.saldoJogadores,
      totalBalanco: params.totalBalanco,
      ...(!params.keepAcumuladoOnUpdate && { acumuladoMensal: params.acumuladoMensal }),
    });
    await repo.save(existing);
    return;
  }

  await repo.save(
    repo.create({
      dailyId,
      saldoTransacional: params.saldoTransacional,
      saldoJogadores: params.saldoJogadores,
      totalBalanco: params.totalBalanco,
      acumuladoMensal: params.acumuladoMensal,
    }),
  );
}
