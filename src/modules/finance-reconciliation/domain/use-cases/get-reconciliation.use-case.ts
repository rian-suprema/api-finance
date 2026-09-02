import { Injectable } from '@nestjs/common';

import { formatTaxNumber } from '../../../../common/utils/tax-number.util';
import { roundCurrency } from '../../../../common/utils/number.util';
import type {
  ItemCounts,
  StoredItem,
  StoredRun,
} from '../../infrastructure/reconciliation.repository.types';
import { ReconciliationItemRepository } from '../../infrastructure/reconciliation-item.repository';
import { ReconciliationRunRepository } from '../../infrastructure/reconciliation-run.repository';
import { MAX_ITEMS_IN_RESPONSE } from '../../reconciliation.constants';
import { ReconciliationRunStatus } from '../../reconciliation.enums';
import { emptyTotals } from '../totals.util';
import type {
  ReconciliationBrandView,
  ReconciliationItemView,
  ReconciliationResult,
  ReconciliationStatus,
} from '../reconciliation.types';
import { RunReconciliationUseCase } from './run-reconciliation.use-case';

interface GetReconciliationParams {
  referenceDate: string;
  brands: string[];
}

const EMPTY_COUNTS: ItemCounts = { total: 0, open: 0, resolved: 0, reprocessPending: 0 };

/**
 * O resultado já calculado do dia — nunca dispara varredura (ver §3.1). Lê só
 * o Postgres do módulo, para a tela abrir instantânea.
 */
@Injectable()
export class GetReconciliationUseCase {
  constructor(
    private readonly runRepository: ReconciliationRunRepository,
    private readonly itemRepository: ReconciliationItemRepository,
    private readonly runReconciliation: RunReconciliationUseCase,
  ) {}

  async execute({ referenceDate, brands }: GetReconciliationParams): Promise<ReconciliationResult> {
    const [runs, items, counts] = await Promise.all([
      this.runRepository.findRuns(referenceDate, brands),
      this.itemRepository.findItems(referenceDate, brands, MAX_ITEMS_IN_RESPONSE),
      this.itemRepository.countItems(referenceDate, brands),
    ]);

    const brandViews = brands.map((brand) =>
      this.buildBrandView(
        brand,
        referenceDate,
        runs.get(brand),
        items.get(brand) ?? [],
        counts.get(brand),
      ),
    );

    return {
      referenceDate,
      brands: brandViews,
      // Falso para usuário sem marca nenhuma: nunca declarar "tudo conciliado" com zero informação.
      allReconciled: brandViews.length > 0 && brandViews.every((view) => view.reconciled),
    };
  }

  private buildBrandView(
    brand: string,
    referenceDate: string,
    run: StoredRun | undefined,
    items: StoredItem[],
    counts: ItemCounts | undefined,
  ): ReconciliationBrandView {
    const status = this.statusOf(run);
    const totals = run?.totals ?? emptyTotals();
    const itemCounts = counts ?? EMPTY_COUNTS;

    return {
      brand,
      status,
      message: this.messageOf(status, run),
      running: this.runReconciliation.isRunning(referenceDate, brand),
      matchedCount: run?.matchedCount ?? 0,
      openCount: itemCounts.open,
      resolvedCount: itemCounts.resolved,
      reprocessPendingCount: itemCounts.reprocessPending,
      itemsTruncated: itemCounts.total > items.length,
      totals,
      depositsDifference: roundCurrency(totals.bankDeposits.total - totals.platformDeposits.total),
      withdrawalsDifference: roundCurrency(
        totals.bankWithdrawals.total - totals.platformWithdrawals.total,
      ),
      // Estorno pendente de reprocessamento não bloqueia: o caixa fecha, falta é
      // trabalho na plataforma (reprocessPendingCount é exposto separado).
      reconciled: status === 'DONE' && itemCounts.open === 0,
      items: items.map((item) => this.toItemView(item)),
    };
  }

  private statusOf(run: StoredRun | undefined): ReconciliationStatus {
    if (!run) return 'NOT_RUN';
    if (run.status === ReconciliationRunStatus.FAILED) return 'FAILED';
    if (run.status === ReconciliationRunStatus.RUNNING) return 'RUNNING';
    return 'DONE';
  }

  private messageOf(status: ReconciliationStatus, run: StoredRun | undefined): string | undefined {
    switch (status) {
      case 'NOT_RUN':
        return 'Conciliação deste dia ainda não foi executada';
      case 'RUNNING':
        return 'Conciliação em andamento — o resultado aparece ao terminar';
      case 'FAILED':
        return run?.error ?? 'Conciliação falhou';
      case 'DONE':
        return undefined;
    }
  }

  private toItemView(item: StoredItem): ReconciliationItemView {
    return {
      id: item.id,
      flow: item.flow,
      side: item.side,
      amount: item.amount,
      occurredAt: item.occurredAt,
      endToEndId: item.endToEndId,
      counterpartyName: item.counterpartyName,
      counterpartyTaxNumber: formatTaxNumber(item.counterpartyTaxNumber),
      status: item.status,
      note: item.note,
      resolvedAt: item.resolvedAt,
      resolvedBy: item.resolvedBy,
      stillPending: item.stillPending,
      platformReprocessPending: item.platformReprocessPending,
    };
  }
}
