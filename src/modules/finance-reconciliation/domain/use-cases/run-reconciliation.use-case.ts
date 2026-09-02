import { Injectable, Logger } from '@nestjs/common';

import { brtMidnightUtc, nextDay, shiftDays } from '../../../../common/utils/date.util';
import { PlatformMovementsService } from '../../infrastructure/clickhouse/platform-movements.service';
import { ReconciliationItemRepository } from '../../infrastructure/reconciliation-item.repository';
import { ReconciliationRunRepository } from '../../infrastructure/reconciliation-run.repository';
import { TrioMovementsService } from '../../infrastructure/trio/trio-movements.service';
import { PLATFORM_NEIGHBOUR_DAYS, RECONCILIATION_BANK_TRIO } from '../../reconciliation.constants';
import { ReconciliationMatchKey } from '../../reconciliation.enums';
import { filterFlow, matchFlow, sumCore } from '../matcher';
import { settleRefunds } from '../refund-settlement';
import type { RunOutcome, RunTotals } from '../reconciliation.types';

interface RunReconciliationParams {
  referenceDate: string;
  brands: string[];
  /** Usado pelo CLI (Fase 15) para reportar progresso; a rota não passa. */
  onBrand?: (outcome: RunOutcome) => void;
}

/**
 * A operação mais cara e mais importante do módulo: varre o extrato do banco
 * (bisseção, ~2 min/marca) e casa contra a plataforma. Ver
 * `docs/migracao-finance/REGRAS-NEGOCIO-ROTAS.md` §3.0/§3.3 para as regras de
 * casamento, janela e liquidação de estorno.
 *
 * A guarda de reentrância (`inFlight`) é um `Set` **em memória do processo**:
 * não é lock distribuído. Com réplicas > 1, cada réplica calcula
 * independentemente — a última gravação vale, mas nunca há corrupção, porque
 * `saveResult` é upsert por chave natural.
 */
@Injectable()
export class RunReconciliationUseCase {
  private readonly logger = new Logger(RunReconciliationUseCase.name);
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly runRepository: ReconciliationRunRepository,
    private readonly itemRepository: ReconciliationItemRepository,
    private readonly platformMovements: PlatformMovementsService,
    private readonly bankMovements: TrioMovementsService,
  ) {}

  isRunning(referenceDate: string, brand: string): boolean {
    return this.inFlight.has(this.key(referenceDate, brand));
  }

  /** Uma marca por vez, em paralelo — a falha de uma nunca derruba as outras. */
  async execute(params: RunReconciliationParams): Promise<RunOutcome[]> {
    const outcomes = await Promise.all(
      params.brands.map((brand) => this.runBrand(params.referenceDate, brand)),
    );

    for (const outcome of outcomes) params.onBrand?.(outcome);
    return outcomes;
  }

  private key(referenceDate: string, brand: string): string {
    return `${referenceDate}:${brand}`;
  }

  private async runBrand(referenceDate: string, brand: string): Promise<RunOutcome> {
    const key = this.key(referenceDate, brand);

    if (this.inFlight.has(key)) {
      return { referenceDate, brand, error: 'Conciliação desta marca já está em andamento' };
    }

    const accountId = this.bankMovements.accountIdFor(brand);
    if (!this.bankMovements.isConfigured || !accountId) {
      return {
        referenceDate,
        brand,
        error: 'Integração com o banco não configurada para esta marca',
      };
    }

    this.inFlight.add(key);
    try {
      return await this.runWithAccount(referenceDate, brand, accountId);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async runWithAccount(
    referenceDate: string,
    brand: string,
    accountId: string,
  ): Promise<RunOutcome> {
    const runId = await this.runRepository.startRun({
      referenceDate,
      brand,
      bank: RECONCILIATION_BANK_TRIO,
      matchKey: ReconciliationMatchKey.EXTERNAL_KEY,
    });

    try {
      const coreFrom = brtMidnightUtc(referenceDate);
      const coreTo = brtMidnightUtc(nextDay(referenceDate));

      const [platform, bank] = await Promise.all([
        this.platformMovements.fetchMovements({
          brand,
          from: brtMidnightUtc(shiftDays(referenceDate, -PLATFORM_NEIGHBOUR_DAYS)),
          to: brtMidnightUtc(shiftDays(referenceDate, PLATFORM_NEIGHBOUR_DAYS + 1)),
          coreFrom,
          coreTo,
        }),
        this.bankMovements.fetchMovements({ brand, accountId, coreFrom, coreTo }),
      ]);

      const settlement = settleRefunds(platform, bank.movements);
      const deposits = matchFlow(
        'DEPOSIT',
        filterFlow(settlement.platform, 'DEPOSIT'),
        filterFlow(settlement.bank, 'DEPOSIT'),
      );
      const withdrawals = matchFlow(
        'WITHDRAWAL',
        filterFlow(settlement.platform, 'WITHDRAWAL'),
        filterFlow(settlement.bank, 'WITHDRAWAL'),
      );

      const totals: RunTotals = {
        platformDeposits: sumCore(filterFlow(settlement.platform, 'DEPOSIT')),
        bankDeposits: sumCore(filterFlow(settlement.bank, 'DEPOSIT')),
        platformWithdrawals: sumCore(filterFlow(settlement.platform, 'WITHDRAWAL')),
        bankWithdrawals: sumCore(filterFlow(settlement.bank, 'WITHDRAWAL')),
        treasury: sumCore(filterFlow(settlement.bank, 'TREASURY')),
        fees: bank.fees,
        depositsCrossover: deposits.crossEdge,
        withdrawalsCrossover: withdrawals.crossEdge,
      };

      const matchedCount = deposits.matchedCount + withdrawals.matchedCount;
      const pending = [...deposits.pending, ...withdrawals.pending];

      await this.itemRepository.saveResult({
        runId,
        referenceDate,
        brand,
        bank: RECONCILIATION_BANK_TRIO,
        totals,
        matchedCount,
        pending,
        settled: settlement.settled,
      });

      return { referenceDate, brand, matchedCount, pendingCount: pending.length };
    } catch (error) {
      const message = (error as Error).message;
      // As outras marcas seguem — cada `runBrand` é independente (Promise.all).
      await this.runRepository.failRun(runId, message);
      this.logger.error(`Conciliação falhou para ${brand} em ${referenceDate}: ${message}`);
      return { referenceDate, brand, error: message };
    }
  }
}
