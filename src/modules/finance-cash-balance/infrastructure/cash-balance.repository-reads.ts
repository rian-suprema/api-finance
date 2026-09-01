import type { DataSource } from 'typeorm';

import { startOfMonth } from '../../../common/utils/date.util';
import type { BrandKey } from '../cash-balance.constants';
import { CashBalanceBrandStatus } from '../cash-balance.enums';
import { CashBalanceBrandSnapshot } from '../entities/cash-balance-brand-snapshot.entity';
import { CashBalanceDaily } from '../entities/cash-balance-daily.entity';
import { CashBalanceDay } from '../entities/cash-balance-day.entity';
import { toBrandDailyRecord } from './cash-balance.repository-upserts';
import type { DayRecord, RegisteredBalanceRecord } from './cash-balance.repository.types';

/**
 * Leituras puras de `CashBalanceRepository` — extraídas para arquivo próprio
 * só por tamanho (limite de 400 linhas do ESLint); recebem o `DataSource`
 * como parâmetro, nunca abrem transação (são todas fora de qualquer escrita).
 */

export async function findDay(
  dataSource: DataSource,
  referenceDate: string,
): Promise<DayRecord | null> {
  const day = await dataSource.getRepository(CashBalanceDay).findOne({
    where: { referenceDate },
    relations: { brands: { bankEntries: true, snapshot: true } },
  });

  if (!day) return null;

  return {
    status: day.status,
    brands: day.brands
      .filter((daily) => !daily.deletedAt)
      .map((daily) => toBrandDailyRecord(daily)),
  };
}

/**
 * Último saldo registrado por banco antes da data, para cada marca — a
 * sugestão que aparece nos campos manuais. Duas queries, nunca uma por marca.
 */
export async function findLastKnownBalances(
  dataSource: DataSource,
  brands: BrandKey[],
  referenceDate: string,
): Promise<Map<BrandKey, Map<string, number>>> {
  const result = new Map<BrandKey, Map<string, number>>();
  if (!brands.length) return result;

  const latestPerBrand: { brand: string; max_reference_date: string | null }[] =
    await dataSource.query(
      `SELECT brand, MAX(reference_date) AS max_reference_date
     FROM cash_balance_daily
     WHERE brand = ANY($1) AND deleted_at IS NULL AND reference_date < $2
     GROUP BY brand`,
      [brands, referenceDate],
    );

  const pairs = latestPerBrand.filter((row) => row.max_reference_date !== null);
  if (!pairs.length) return result;

  const pairPlaceholders = pairs
    .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
    .join(', ');

  const dailies: { id: number; brand: string; bank: string; balance: string }[] =
    await dataSource.query(
      `SELECT d.id, d.brand, e.bank, e.balance
     FROM cash_balance_daily d
     JOIN cash_balance_bank_entries e ON e.daily_id = d.id
     WHERE d.deleted_at IS NULL
       AND (d.brand, d.reference_date) IN (${pairPlaceholders})`,
      pairs.flatMap((pair) => [pair.brand, pair.max_reference_date]),
    );

  for (const row of dailies) {
    const brand = row.brand as BrandKey;
    const balances = result.get(brand) ?? new Map<string, number>();
    balances.set(row.bank, Number(row.balance));
    result.set(brand, balances);
  }

  return result;
}

/**
 * Balanços já registrados no intervalo, uma linha por dia + marca. Entram só
 * marcas `CONFIRMED` com snapshot gravado: o histórico não mostra rascunho.
 */
export async function findRegisteredRange(
  dataSource: DataSource,
  brands: BrandKey[],
  from: string,
  to: string,
): Promise<RegisteredBalanceRecord[]> {
  if (!brands.length) return [];

  const rows = await dataSource
    .getRepository(CashBalanceDaily)
    .createQueryBuilder('daily')
    .innerJoinAndSelect('daily.snapshot', 'snapshot')
    .innerJoinAndSelect('daily.day', 'day')
    .where('daily.brand IN (:...brands)', { brands })
    .andWhere('daily.deletedAt IS NULL')
    .andWhere('daily.status = :status', { status: CashBalanceBrandStatus.CONFIRMED })
    .andWhere('daily.referenceDate >= :from', { from })
    .andWhere('daily.referenceDate <= :to', { to })
    .orderBy('daily.referenceDate', 'DESC')
    .getMany();

  return rows.map((daily) => ({
    referenceDate: daily.referenceDate,
    brand: daily.brand as BrandKey,
    dayStatus: daily.day.status,
    saldoTransacional: daily.snapshot.saldoTransacional,
    saldoJogadores: daily.snapshot.saldoJogadores,
    totalBalanco: daily.snapshot.totalBalanco,
    acumuladoMensal: daily.snapshot.acumuladoMensal,
  }));
}

/** Marcas já registradas no intervalo, como `YYYY-MM-DD|brand`. */
export async function findRegisteredKeys(
  dataSource: DataSource,
  from: string,
  to: string,
): Promise<Set<string>> {
  const dailies = await dataSource
    .getRepository(CashBalanceDaily)
    .createQueryBuilder('daily')
    .select(['daily.referenceDate', 'daily.brand'])
    .where('daily.deletedAt IS NULL')
    .andWhere('daily.status = :status', { status: CashBalanceBrandStatus.CONFIRMED })
    .andWhere('daily.referenceDate >= :from', { from })
    .andWhere('daily.referenceDate <= :to', { to })
    .getMany();

  return new Set(dailies.map((daily) => `${daily.referenceDate}|${daily.brand}`));
}

/**
 * `tenant_id` de cada marca, tirado do que já foi registrado. A carga não
 * inventa tenant: se a marca nunca foi registrada, quem chama decide o que fazer.
 */
export async function findTenantIdsByBrand(dataSource: DataSource): Promise<Map<BrandKey, string>> {
  const rows: { brand: string; tenant_id: string }[] = await dataSource.query(
    `SELECT DISTINCT ON (brand) brand, tenant_id
     FROM cash_balance_daily
     WHERE deleted_at IS NULL
     ORDER BY brand, reference_date DESC`,
  );

  return new Map(rows.map((row) => [row.brand as BrandKey, row.tenant_id]));
}

/** Acumulado mensal por marca: soma dos balanços confirmados no mês. */
export async function sumMonthlyBalances(
  dataSource: DataSource,
  brands: BrandKey[],
  referenceDate: string,
): Promise<Map<BrandKey, number>> {
  const totals = new Map<BrandKey, number>();
  if (!brands.length) return totals;

  const rows = await dataSource
    .getRepository(CashBalanceBrandSnapshot)
    .createQueryBuilder('snapshot')
    .innerJoin('snapshot.daily', 'daily')
    .where('daily.brand IN (:...brands)', { brands })
    .andWhere('daily.deletedAt IS NULL')
    .andWhere('daily.status = :status', { status: CashBalanceBrandStatus.CONFIRMED })
    .andWhere('daily.referenceDate >= :start', { start: startOfMonth(referenceDate) })
    .andWhere('daily.referenceDate <= :referenceDate', { referenceDate })
    .select(['snapshot.totalBalanco', 'daily.brand'])
    .getMany();

  for (const row of rows) {
    const brand = row.daily.brand as BrandKey;
    totals.set(brand, (totals.get(brand) ?? 0) + row.totalBalanco);
  }

  return totals;
}
