import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, type EntityManager } from 'typeorm';

import { startOfMonth, startOfNextMonth } from '../../../common/utils/date.util';
import { roundCurrency } from '../../../common/utils/number.util';
import { TRIO_BANK_KEY, type BrandKey } from '../cash-balance.constants';
import {
  CashBalanceBankType,
  CashBalanceBankSource,
  CashBalanceBrandStatus,
  CashBalanceDayStatus,
} from '../cash-balance.enums';
import { CashBalanceBrandSnapshot } from '../entities/cash-balance-brand-snapshot.entity';
import { CashBalanceDaily } from '../entities/cash-balance-daily.entity';
import { CashBalanceDay } from '../entities/cash-balance-day.entity';
import {
  findDay as findDayQuery,
  findLastKnownBalances as findLastKnownBalancesQuery,
  findRegisteredKeys as findRegisteredKeysQuery,
  findRegisteredRange as findRegisteredRangeQuery,
  findTenantIdsByBrand as findTenantIdsByBrandQuery,
  sumMonthlyBalances as sumMonthlyBalancesQuery,
} from './cash-balance.repository-reads';
import {
  lockBankEntries,
  upsertBankEntry,
  upsertDaily,
  upsertDay,
  upsertSnapshot,
} from './cash-balance.repository-upserts';
import type {
  ConfirmBankParams,
  DayRecord,
  ImportBrandBalanceParams,
  RegisterBrandOutcome,
  RegisterBrandParams,
  RegisteredBalanceRecord,
  ResolveManualBalances,
} from './cash-balance.repository.types';

export type {
  BankEntryRecord,
  BrandDailyRecord,
  ConfirmBankParams,
  DayRecord,
  ImportBrandBalanceParams,
  RegisterBrandOutcome,
  RegisterBrandParams,
  RegisteredBalanceRecord,
  ResolveManualBalances,
} from './cash-balance.repository.types';

/**
 * Única camada que toca o TypeORM para as 4 tabelas do balanço. Usa
 * `DataSource.transaction()` direto — Finance não usa a RLS de tenant único
 * do esqueleto (marca ≠ tenant, ver CLAUDE.md decisão 5), então nada aqui
 * passa por `tenantManager()`.
 *
 * `reference_date` (`date`) volta do driver `pg`/TypeORM já como `string`
 * `YYYY-MM-DD` (confirmado empiricamente contra Postgres real nesta fase) —
 * diferente da origem em Prisma, que exigia `Date` (`toDateOnly`/`fromDateOnly`
 * em toda borda). Aqui a data trafega como string do início ao fim, sem
 * conversão.
 *
 * Os upserts elementares (`upsertDay`/`upsertDaily`/`upsertBankEntry`/
 * `upsertSnapshot`) vivem em `cash-balance.repository-upserts.ts` — extraídos
 * só por tamanho de arquivo (limite de 400 linhas do ESLint), sem estado
 * próprio, recebendo o `EntityManager` transacional como parâmetro.
 */
@Injectable()
export class CashBalanceRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findDay(referenceDate: string): Promise<DayRecord | null> {
    return findDayQuery(this.dataSource, referenceDate);
  }

  /**
   * Último saldo registrado por banco antes da data, para cada marca — a
   * sugestão que aparece nos campos manuais. Duas queries, nunca uma por marca.
   */
  async findLastKnownBalances(
    brands: BrandKey[],
    referenceDate: string,
  ): Promise<Map<BrandKey, Map<string, number>>> {
    return findLastKnownBalancesQuery(this.dataSource, brands, referenceDate);
  }

  /**
   * Balanços já registrados no intervalo, uma linha por dia + marca. Entram só
   * marcas `CONFIRMED` com snapshot gravado: o histórico não mostra rascunho.
   */
  async findRegisteredRange(
    brands: BrandKey[],
    from: string,
    to: string,
  ): Promise<RegisteredBalanceRecord[]> {
    return findRegisteredRangeQuery(this.dataSource, brands, from, to);
  }

  /** Marcas já registradas no intervalo, como `YYYY-MM-DD|brand`. */
  async findRegisteredKeys(from: string, to: string): Promise<Set<string>> {
    return findRegisteredKeysQuery(this.dataSource, from, to);
  }

  /**
   * `tenant_id` de cada marca, tirado do que já foi registrado. A carga não
   * inventa tenant: se a marca nunca foi registrada, quem chama decide o que fazer.
   */
  async findTenantIdsByBrand(): Promise<Map<BrandKey, string>> {
    return findTenantIdsByBrandQuery(this.dataSource);
  }

  /**
   * Grava um dia + marca vindo de fonte externa. Diferente do `registerBrand`,
   * recebe os agregados prontos e não calcula acumulado: quem chama recalcula
   * o mês inteiro depois, via `recomputeMonthlyAccumulated`.
   *
   * `deposits`/`withdrawals` ficam em zero de propósito: depósito e saque não
   * são fonte primária no módulo, são lidos do data warehouse a cada consulta.
   */
  async importBrandBalance(params: ImportBrandBalanceParams): Promise<void> {
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const day = await upsertDay(manager, params.referenceDate);

      const daily = await upsertDaily(manager, {
        dayId: day.id,
        tenantId: params.tenantId,
        brand: params.brand,
        referenceDate: params.referenceDate,
        status: CashBalanceBrandStatus.CONFIRMED,
        confirmedAt: now,
        confirmedBy: params.importedBy,
        clearDeletedAt: true,
      });

      for (const [bank, balance] of params.bankBalances) {
        const isTrio = bank === TRIO_BANK_KEY;

        await upsertBankEntry(manager, {
          dailyId: daily.id,
          bank,
          type: isTrio ? CashBalanceBankType.API : CashBalanceBankType.MANUAL,
          source: isTrio ? CashBalanceBankSource.TRIO : CashBalanceBankSource.MANUAL,
          balance,
          confirmed: true,
          confirmedAt: now,
          confirmedBy: params.importedBy,
        });
      }

      await upsertSnapshot(manager, daily.id, {
        saldoTransacional: params.saldoTransacional,
        saldoJogadores: params.saldoJogadores,
        totalBalanco: params.totalBalanco,
        acumuladoMensal: 0,
        keepAcumuladoOnUpdate: true,
      });
    });
  }

  /**
   * Recalcula o acumulado mensal de todos os dias do mês da data informada, na
   * ordem das datas e por marca. Necessário depois de qualquer carga histórica:
   * o acumulado é soma corrente, então inserir um dia no meio do mês invalida
   * o valor gravado nos dias seguintes.
   */
  async recomputeMonthlyAccumulated(isoDate: string): Promise<number> {
    const dailies = await this.dataSource
      .getRepository(CashBalanceDaily)
      .createQueryBuilder('daily')
      .innerJoinAndSelect('daily.snapshot', 'snapshot')
      .where('daily.deletedAt IS NULL')
      .andWhere('daily.status = :status', { status: CashBalanceBrandStatus.CONFIRMED })
      .andWhere('daily.referenceDate >= :start', { start: startOfMonth(isoDate) })
      .andWhere('daily.referenceDate < :end', { end: startOfNextMonth(isoDate) })
      .orderBy('daily.referenceDate', 'ASC')
      .getMany();

    const running = new Map<string, number>();

    return this.dataSource.transaction(async (manager) => {
      let updated = 0;

      for (const daily of dailies) {
        if (!daily.snapshot) continue;

        const accumulated = (running.get(daily.brand) ?? 0) + daily.snapshot.totalBalanco;
        running.set(daily.brand, accumulated);

        await manager.update(
          CashBalanceBrandSnapshot,
          { dailyId: daily.id },
          { acumuladoMensal: roundCurrency(accumulated) },
        );
        updated++;
      }

      return updated;
    });
  }

  /** Fecha os dias do intervalo que já têm todas as marcas registradas. */
  async closeCompleteDays(
    from: string,
    to: string,
    requiredBrands: number,
    closedBy: string,
  ): Promise<string[]> {
    const counts: { reference_date: string; count: string }[] = await this.dataSource.query(
      `SELECT reference_date, COUNT(*) AS count
       FROM cash_balance_daily
       WHERE deleted_at IS NULL AND status = $1 AND reference_date >= $2 AND reference_date <= $3
       GROUP BY reference_date`,
      [CashBalanceBrandStatus.CONFIRMED, from, to],
    );

    const complete = counts
      .filter((row) => Number(row.count) >= requiredBrands)
      .map((row) => row.reference_date);

    if (!complete.length) return [];

    await this.dataSource
      .getRepository(CashBalanceDay)
      .createQueryBuilder()
      .update(CashBalanceDay)
      .set({ status: CashBalanceDayStatus.CLOSED, closedAt: new Date(), closedBy })
      .where('referenceDate IN (:...complete)', { complete })
      .andWhere('status = :status', { status: CashBalanceDayStatus.OPEN })
      .execute();

    return [...complete].sort((a, b) => a.localeCompare(b));
  }

  async confirmBank(params: ConfirmBankParams): Promise<void> {
    const daily = await this.ensureDaily(params);

    await upsertBankEntry(this.dataSource.manager, {
      dailyId: daily.id,
      bank: params.bank,
      type: CashBalanceBankType.MANUAL,
      source: CashBalanceBankSource.MANUAL,
      balance: params.balance,
      confirmed: true,
      confirmedAt: new Date(),
      confirmedBy: params.userId,
    });
  }

  /**
   * `resolveManualBalances` roda DEPOIS do `lockBankEntries` (`SELECT ... FOR
   * UPDATE`), nunca antes: é o que impede uma confirmação concorrente entre a
   * leitura e o commit de ser sobrescrita por um valor obsoleto (a mesma
   * transação lê e regrava exatamente o que travou, nunca um snapshot
   * anterior a ela).
   */
  async registerBrand(
    params: RegisterBrandParams,
    resolveManualBalances: ResolveManualBalances,
  ): Promise<RegisterBrandOutcome> {
    const monthStart = startOfMonth(params.referenceDate);
    const now = new Date();

    return this.dataSource.transaction(async (manager) => {
      const day = await upsertDay(manager, params.referenceDate);

      // Garante a existência do `daily` (sem tocar status) só para ter o id a
      // travar — a transição para CONFIRMED só acontece depois da validação.
      const daily = await upsertDaily(manager, {
        dayId: day.id,
        tenantId: params.tenantId,
        brand: params.brand,
        referenceDate: params.referenceDate,
      });

      const lockedEntries = await lockBankEntries(manager, daily.id);
      const manualBalances = resolveManualBalances(lockedEntries);

      const saldoTransacional = roundCurrency(
        [...manualBalances.values()].reduce(
          (total, balance) => total + balance,
          params.trioBalance,
        ),
      );
      const totalBalanco = roundCurrency(saldoTransacional - params.saldoJogadores);

      await upsertDaily(manager, {
        dayId: day.id,
        tenantId: params.tenantId,
        brand: params.brand,
        referenceDate: params.referenceDate,
        status: CashBalanceBrandStatus.CONFIRMED,
        confirmedAt: now,
        confirmedBy: params.userId,
        depositsTotal: params.depositsTotal,
        withdrawalsTotal: params.withdrawalsTotal,
        netDeposit: params.depositsTotal - params.withdrawalsTotal,
      });

      for (const [bank, balance] of manualBalances) {
        await upsertBankEntry(manager, {
          dailyId: daily.id,
          bank,
          type: CashBalanceBankType.MANUAL,
          source: CashBalanceBankSource.MANUAL,
          balance,
          confirmed: true,
          confirmedAt: now,
          confirmedBy: params.userId,
        });
      }

      await upsertBankEntry(manager, {
        dailyId: daily.id,
        bank: TRIO_BANK_KEY,
        type: CashBalanceBankType.API,
        source: CashBalanceBankSource.TRIO,
        balance: params.trioBalance,
        confirmed: true,
        confirmedAt: now,
        confirmedBy: null,
      });

      const acumuladoMensal = await this.computeAcumuladoMensal(manager, {
        brand: params.brand,
        monthStart,
        referenceDate: params.referenceDate,
        dailyId: daily.id,
        totalBalanco,
      });

      await upsertSnapshot(manager, daily.id, {
        saldoTransacional,
        saldoJogadores: params.saldoJogadores,
        totalBalanco,
        acumuladoMensal,
      });

      const dayClosed = await this.closeDayIfComplete(manager, day, {
        referenceDate: params.referenceDate,
        requiredBrands: params.requiredBrands,
        userId: params.userId,
        now,
      });

      return { acumuladoMensal, dayClosed, saldoTransacional, totalBalanco };
    });
  }

  /** Reabre a marca para nova edição e destrava o dia — nunca um sem o outro. */
  async reopenBrand(referenceDate: string, brand: BrandKey): Promise<boolean> {
    const daily = await this.dataSource.getRepository(CashBalanceDaily).findOne({
      where: { referenceDate, brand },
    });

    if (!daily || daily.deletedAt) return false;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(CashBalanceDaily, daily.id, {
        status: CashBalanceBrandStatus.DRAFT,
        confirmedAt: null,
        confirmedBy: null,
      });

      await manager.update(
        CashBalanceDay,
        { referenceDate },
        { status: CashBalanceDayStatus.OPEN, closedAt: null, closedBy: null },
      );
    });

    return true;
  }

  /** Acumulado mensal por marca: soma dos balanços confirmados no mês. */
  async sumMonthlyBalances(
    brands: BrandKey[],
    referenceDate: string,
  ): Promise<Map<BrandKey, number>> {
    return sumMonthlyBalancesQuery(this.dataSource, brands, referenceDate);
  }

  /** Soma dos `total_balanco` confirmados do mês até a data, excluindo o próprio `dailyId` (idempotência de re-registro). */
  private async computeAcumuladoMensal(
    manager: EntityManager,
    params: {
      brand: BrandKey;
      monthStart: string;
      referenceDate: string;
      dailyId: number;
      totalBalanco: number;
    },
  ): Promise<number> {
    const monthSnapshots = await manager
      .getRepository(CashBalanceBrandSnapshot)
      .createQueryBuilder('snapshot')
      .innerJoin('snapshot.daily', 'daily')
      .where('daily.brand = :brand', { brand: params.brand })
      .andWhere('daily.deletedAt IS NULL')
      .andWhere('daily.status = :status', { status: CashBalanceBrandStatus.CONFIRMED })
      .andWhere('daily.referenceDate >= :monthStart', { monthStart: params.monthStart })
      .andWhere('daily.referenceDate <= :referenceDate', { referenceDate: params.referenceDate })
      .select(['snapshot.dailyId', 'snapshot.totalBalanco'])
      .getMany();

    const previousMonthTotal = monthSnapshots
      .filter((snapshot) => snapshot.dailyId !== params.dailyId)
      .reduce((total, snapshot) => total + snapshot.totalBalanco, 0);

    return roundCurrency(previousMonthTotal + params.totalBalanco);
  }

  /** Fecha o dia quando as marcas exigidas já estão `CONFIRMED`. Devolve se fechou. */
  private async closeDayIfComplete(
    manager: EntityManager,
    day: CashBalanceDay,
    params: { referenceDate: string; requiredBrands: number; userId: string; now: Date },
  ): Promise<boolean> {
    const confirmedBrands = await manager.getRepository(CashBalanceDaily).count({
      where: {
        referenceDate: params.referenceDate,
        status: CashBalanceBrandStatus.CONFIRMED,
        deletedAt: IsNull(),
      },
    });

    const dayClosed = confirmedBrands >= params.requiredBrands;

    if (dayClosed && day.status !== CashBalanceDayStatus.CLOSED) {
      await manager.update(CashBalanceDay, day.id, {
        status: CashBalanceDayStatus.CLOSED,
        closedAt: params.now,
        closedBy: params.userId,
      });
    }

    return dayClosed;
  }

  private async ensureDaily(params: ConfirmBankParams): Promise<CashBalanceDaily> {
    const day = await upsertDay(this.dataSource.manager, params.referenceDate);

    return upsertDaily(this.dataSource.manager, {
      dayId: day.id,
      tenantId: params.tenantId,
      brand: params.brand,
      referenceDate: params.referenceDate,
    });
  }
}
