import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager } from 'typeorm';

import { ReconciliationRun } from '../entities/reconciliation-run.entity';
import { ReconciliationRunStatus } from '../reconciliation.enums';

/**
 * `useDefineForClassFields` (tsconfig) faz `repo.create()` gravar `undefined`
 * como propriedade própria em toda coluna não informada — o `decimalTransformer`
 * então converte esse `undefined` em `NULL` explícito no INSERT, ignorando o
 * `default: 0` da coluna. Por isso os 16 totais + as 2 contagens de um run
 * novo têm que ser zerados aqui, nunca deixados para o default do banco (mesma
 * causa, mesma correção do `upsertDaily` em `cash-balance.repository-upserts.ts`).
 */
const ZERO_TOTALS = {
  platformDepositsTotal: 0,
  platformDepositsCount: 0,
  bankDepositsTotal: 0,
  bankDepositsCount: 0,
  platformWithdrawalsTotal: 0,
  platformWithdrawalsCount: 0,
  bankWithdrawalsTotal: 0,
  bankWithdrawalsCount: 0,
  treasuryTotal: 0,
  treasuryCount: 0,
  feesTotal: 0,
  feesCount: 0,
  depositsCrossoverTotal: 0,
  depositsCrossoverCount: 0,
  withdrawalsCrossoverTotal: 0,
  withdrawalsCrossoverCount: 0,
  matchedCount: 0,
  pendingCount: 0,
};
import type {
  RangeRun,
  StartRunParams,
  StoredRun,
  UpdateRunTotalsParams,
} from './reconciliation.repository.types';

function toStoredRun(row: ReconciliationRun): StoredRun {
  return {
    id: row.id,
    referenceDate: row.referenceDate,
    brand: row.brand,
    bank: row.bank,
    status: row.status,
    matchKey: row.matchKey,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    error: row.error ?? null,
    matchedCount: row.matchedCount,
    pendingCount: row.pendingCount,
    totals: {
      platformDeposits: { total: row.platformDepositsTotal, count: row.platformDepositsCount },
      bankDeposits: { total: row.bankDepositsTotal, count: row.bankDepositsCount },
      platformWithdrawals: {
        total: row.platformWithdrawalsTotal,
        count: row.platformWithdrawalsCount,
      },
      bankWithdrawals: { total: row.bankWithdrawalsTotal, count: row.bankWithdrawalsCount },
      treasury: { total: row.treasuryTotal, count: row.treasuryCount },
      fees: { total: row.feesTotal, count: row.feesCount },
      depositsCrossover: {
        total: row.depositsCrossoverTotal,
        count: row.depositsCrossoverCount,
      },
      withdrawalsCrossover: {
        total: row.withdrawalsCrossoverTotal,
        count: row.withdrawalsCrossoverCount,
      },
    },
  };
}

/**
 * Persistência de `ReconciliationRun`. `startRun` é upsert por
 * `(referenceDate, brand, bank)` — preserva o `id` entre reexecuções, nunca
 * duplica (ver DADOS-FINANCE.md §4.1/§4.2).
 *
 * `updateRunTotals`/`refreshPendingCount` recebem o `EntityManager` de uma
 * transação aberta por `ReconciliationItemRepository` — a mesma transação que
 * grava as pendências, para o run e os itens fecharem juntos ou nenhum fechar.
 */
@Injectable()
export class ReconciliationRunRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Marca a execução como em andamento e devolve o id (cria ou reaproveita). */
  async startRun(params: StartRunParams): Promise<number> {
    const repo = this.dataSource.getRepository(ReconciliationRun);
    const key = { referenceDate: params.referenceDate, brand: params.brand, bank: params.bank };
    const existing = await repo.findOne({ where: key });
    const startedAt = new Date();

    if (existing) {
      repo.merge(existing, {
        status: ReconciliationRunStatus.RUNNING,
        matchKey: params.matchKey,
        startedAt,
        finishedAt: null,
        error: null,
      });
      const saved = await repo.save(existing);
      return saved.id;
    }

    const created = await repo.save(
      repo.create({
        ...key,
        ...ZERO_TOTALS,
        status: ReconciliationRunStatus.RUNNING,
        matchKey: params.matchKey,
        startedAt,
      }),
    );
    return created.id;
  }

  async failRun(runId: number, message: string): Promise<void> {
    await this.dataSource.getRepository(ReconciliationRun).update(runId, {
      status: ReconciliationRunStatus.FAILED,
      finishedAt: new Date(),
      error: message,
    });
  }

  async findRuns(referenceDate: string, brands: string[]): Promise<Map<string, StoredRun>> {
    if (!brands.length) return new Map();

    const rows = await this.dataSource
      .getRepository(ReconciliationRun)
      .find({ where: { referenceDate, brand: In(brands) } });

    return new Map(rows.map((row) => [row.brand, toStoredRun(row)]));
  }

  /**
   * Execuções de um intervalo, indexadas por `dia|marca`. Devolve só o que o
   * histórico usa — trazer os 16 campos de totais de cada execução para
   * montar uma tabela de status carregaria dezenas de colunas por linha para
   * não exibir nenhuma.
   */
  async findRunsInRange(
    brands: string[],
    from: string,
    to: string,
  ): Promise<Map<string, RangeRun>> {
    if (!brands.length) return new Map();

    const rows = await this.dataSource
      .getRepository(ReconciliationRun)
      .createQueryBuilder('run')
      .select(['run.referenceDate', 'run.brand', 'run.status', 'run.matchedCount'])
      .where('run.referenceDate BETWEEN :from AND :to', { from, to })
      .andWhere('run.brand IN (:...brands)', { brands })
      .getMany();

    return new Map(
      rows.map((row) => [
        `${row.referenceDate}|${row.brand}`,
        {
          referenceDate: row.referenceDate,
          brand: row.brand,
          status: row.status,
          matchedCount: row.matchedCount,
        },
      ]),
    );
  }

  /** Grava os totais + contagens do run, dentro da transação de `saveResult`. */
  async updateRunTotals(
    manager: EntityManager,
    runId: number,
    params: UpdateRunTotalsParams,
  ): Promise<void> {
    await manager.update(ReconciliationRun, runId, {
      status: ReconciliationRunStatus.DONE,
      finishedAt: new Date(),
      error: null,
      matchedCount: params.matchedCount,
      pendingCount: params.pendingCount,
      platformDepositsTotal: params.totals.platformDeposits.total,
      platformDepositsCount: params.totals.platformDeposits.count,
      bankDepositsTotal: params.totals.bankDeposits.total,
      bankDepositsCount: params.totals.bankDeposits.count,
      platformWithdrawalsTotal: params.totals.platformWithdrawals.total,
      platformWithdrawalsCount: params.totals.platformWithdrawals.count,
      bankWithdrawalsTotal: params.totals.bankWithdrawals.total,
      bankWithdrawalsCount: params.totals.bankWithdrawals.count,
      treasuryTotal: params.totals.treasury.total,
      treasuryCount: params.totals.treasury.count,
      feesTotal: params.totals.fees.total,
      feesCount: params.totals.fees.count,
      depositsCrossoverTotal: params.totals.depositsCrossover.total,
      depositsCrossoverCount: params.totals.depositsCrossover.count,
      withdrawalsCrossoverTotal: params.totals.withdrawalsCrossover.total,
      withdrawalsCrossoverCount: params.totals.withdrawalsCrossover.count,
    });
  }

  /** Recalcula `pending_count` — chamado após `resolveItem`/`reopenItem`/`resolveItems`. */
  async refreshPendingCount(
    manager: EntityManager,
    runId: number,
    openCount: number,
  ): Promise<void> {
    await manager.update(ReconciliationRun, runId, { pendingCount: openCount });
  }
}
