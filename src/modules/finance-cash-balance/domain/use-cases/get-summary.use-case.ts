import { Injectable, Logger } from '@nestjs/common';

import { type BrandKey } from '../../cash-balance.constants';
import { ClickHouseReadService } from '../../infrastructure/clickhouse/clickhouse-read.service';
import { buildKpiCard, subtractByBrand } from '../kpi-card.util';
import type { CashBalanceSummary } from '../cash-balance.types';

interface GetSummaryParams {
  referenceDate: string;
  brands: BrandKey[];
}

/**
 * KPIs do topo da tela. Depósito/saque nunca são persistidos como fonte
 * primária: são sempre lidos do data warehouse (REGRAS-NEGOCIO-ROTAS.md §2.1).
 */
@Injectable()
export class GetSummaryUseCase {
  private readonly logger = new Logger(GetSummaryUseCase.name);

  constructor(private readonly clickhouse: ClickHouseReadService) {}

  async execute({ referenceDate, brands }: GetSummaryParams): Promise<CashBalanceSummary> {
    const empty = this.emptySummary(referenceDate, brands);

    if (!this.clickhouse.isConfigured) return empty;

    try {
      const [daily, monthly] = await Promise.all([
        this.clickhouse.fetchDailyKpis(referenceDate),
        this.clickhouse.fetchMonthlyKpis(referenceDate),
      ]);

      const dailyDeposits = this.toAmountMap(daily, (row) => row.depositsTotal);
      const dailyWithdrawals = this.toAmountMap(daily, (row) => row.withdrawalsTotal);
      const monthDeposits = this.toAmountMap(monthly, (row) => row.depositsTotal);
      const monthWithdrawals = this.toAmountMap(monthly, (row) => row.withdrawalsTotal);

      return {
        referenceDate,
        available: true,
        depositsYesterday: buildKpiCard(brands, dailyDeposits),
        withdrawalsYesterday: buildKpiCard(brands, dailyWithdrawals),
        netDepositYesterday: buildKpiCard(brands, subtractByBrand(dailyDeposits, dailyWithdrawals)),
        depositsMonth: buildKpiCard(brands, monthDeposits),
        withdrawalsMonth: buildKpiCard(brands, monthWithdrawals),
        netDepositMonth: buildKpiCard(brands, subtractByBrand(monthDeposits, monthWithdrawals)),
      };
    } catch (error) {
      // KPI indisponível não bloqueia a tela: o bloco de bancos segue editável.
      this.logger.warn(`KPIs indisponíveis para ${referenceDate}: ${(error as Error).message}`);
      return empty;
    }
  }

  private toAmountMap<T extends { brand: BrandKey }>(
    rows: T[],
    pick: (row: T) => number,
  ): Map<BrandKey, number> {
    return new Map(rows.map((row) => [row.brand, pick(row)]));
  }

  private emptySummary(referenceDate: string, brands: BrandKey[]): CashBalanceSummary {
    const card = buildKpiCard(brands, new Map());
    return {
      referenceDate,
      available: false,
      depositsYesterday: card,
      withdrawalsYesterday: card,
      netDepositYesterday: card,
      depositsMonth: card,
      withdrawalsMonth: card,
      netDepositMonth: card,
    };
  }
}
