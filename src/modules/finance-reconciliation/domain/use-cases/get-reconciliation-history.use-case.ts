import { Injectable } from '@nestjs/common';

import { daysInRange, shiftDays } from '../../../../common/utils/date.util';
import { roundCurrency } from '../../../../common/utils/number.util';
import type {
  RangeItemCounts,
  RangeRun,
} from '../../infrastructure/reconciliation.repository.types';
import { ReconciliationItemRepository } from '../../infrastructure/reconciliation-item.repository';
import { ReconciliationRunRepository } from '../../infrastructure/reconciliation-run.repository';
import { ReconciliationRunStatus } from '../../reconciliation.enums';
import type {
  ReconciliationDayStatus,
  ReconciliationHistoryDay,
  ReconciliationHistoryResult,
} from '../reconciliation.types';

interface GetReconciliationHistoryParams {
  from: string;
  to: string;
  brands: string[];
}

/** Pior status primeiro — `NOT_RUN` é pior que `PENDING` (§3.2). */
const SEVERITY: Record<ReconciliationDayStatus, number> = {
  NOT_RUN: 4,
  FAILED: 3,
  RUNNING: 2,
  PENDING: 1,
  RECONCILED: 0,
};

/**
 * Fechamento de período: cada dia do intervalo aparece, mesmo sem execução —
 * é o contrário do histórico de balanço, porque aqui o dia sem execução é
 * exatamente o que impede o mês de fechar (ver §3.2). Nunca carrega itens:
 * agrega no banco.
 */
@Injectable()
export class GetReconciliationHistoryUseCase {
  constructor(
    private readonly runRepository: ReconciliationRunRepository,
    private readonly itemRepository: ReconciliationItemRepository,
  ) {}

  async execute({
    from,
    to,
    brands,
  }: GetReconciliationHistoryParams): Promise<ReconciliationHistoryResult> {
    const [runs, itemCounts] = await Promise.all([
      this.runRepository.findRunsInRange(brands, from, to),
      this.itemRepository.countItemsInRange(brands, from, to),
    ]);

    const rangeDays = daysInRange(from, to);
    // Do `to` para o `from` — mais recente primeiro, como no extrato.
    const days = Array.from({ length: rangeDays }, (_, index) =>
      this.buildDay(shiftDays(to, -index), brands, runs, itemCounts),
    );

    const totals = this.aggregate(itemCounts);

    return {
      from,
      to,
      rangeDays,
      days,
      reconciledDays: days.filter((day) => day.status === 'RECONCILED').length,
      pendingDays: days.filter((day) => day.status === 'PENDING').length,
      // RUNNING é transitório, não buraco — nunca entra em missingDays.
      missingDays: days.filter((day) => day.status === 'NOT_RUN' || day.status === 'FAILED').length,
      ...totals,
      allReconciled: days.length > 0 && days.every((day) => day.status === 'RECONCILED'),
    };
  }

  private buildDay(
    referenceDate: string,
    brands: string[],
    runs: Map<string, RangeRun>,
    itemCounts: Map<string, RangeItemCounts>,
  ): ReconciliationHistoryDay {
    const brandRows = brands.map((brand) => {
      const key = `${referenceDate}|${brand}`;
      return { brand, status: this.statusOf(runs.get(key), itemCounts.get(key)) };
    });

    const status = brandRows.reduce<ReconciliationDayStatus>(
      (worst, row) => (SEVERITY[row.status] > SEVERITY[worst] ? row.status : worst),
      'RECONCILED',
    );

    return { referenceDate, status, brands: brandRows };
  }

  private statusOf(
    run: RangeRun | undefined,
    counts: RangeItemCounts | undefined,
  ): ReconciliationDayStatus {
    if (!run) return 'NOT_RUN';
    if (run.status === ReconciliationRunStatus.FAILED) return 'FAILED';
    if (run.status === ReconciliationRunStatus.RUNNING) return 'RUNNING';
    return (counts?.open ?? 0) > 0 ? 'PENDING' : 'RECONCILED';
  }

  private aggregate(itemCounts: Map<string, RangeItemCounts>): {
    openCount: number;
    openAmount: number;
    resolvedCount: number;
  } {
    let openCount = 0;
    let openAmount = 0;
    let resolvedCount = 0;

    for (const counts of itemCounts.values()) {
      openCount += counts.open;
      openAmount += counts.openAmount;
      resolvedCount += counts.resolved;
    }

    return { openCount, openAmount: roundCurrency(openAmount), resolvedCount };
  }
}
