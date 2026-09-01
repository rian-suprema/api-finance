import { Injectable, Logger } from '@nestjs/common';

import { daysInRange } from '../../../../common/utils/date.util';
import { roundCurrency } from '../../../../common/utils/number.util';
import { BRAND_KEYS, BRANDS, type BrandKey } from '../../cash-balance.constants';
import type { RegisteredBalanceRecord } from '../../infrastructure/cash-balance.repository.types';
import { CashBalanceRepository } from '../../infrastructure/cash-balance.repository';
import {
  ClickHouseReadService,
  type DailyBrandKpi,
} from '../../infrastructure/clickhouse/clickhouse-read.service';
import { buildKpiCard, divideByBrand, subtractByBrand } from '../kpi-card.util';
import type {
  CashBalanceHistory,
  HistoryAmounts,
  HistoryBrandRow,
  HistoryDay,
  HistoryKpis,
  HistoryTotals,
} from '../cash-balance.types';

interface GetHistoryParams {
  from: string;
  to: string;
  brands: BrandKey[];
}

interface KpiRowsResult {
  rows: DailyBrandKpi[];
  available: boolean;
}

const EMPTY_AMOUNTS: HistoryAmounts = {
  deposits: 0,
  withdrawals: 0,
  netDeposit: 0,
  saldoTransacional: 0,
  saldoJogadores: 0,
  totalBalanco: 0,
  acumuladoMensal: 0,
};

/**
 * Histórico de balanços do intervalo. A tabela lista só dias registrados
 * (fonte: snapshots do próprio módulo); os KPIs cobrem o intervalo inteiro
 * (fonte: data warehouse), então podem divergir dos totais da tabela quando
 * algum dia do intervalo não foi registrado — a tela informa a diferença.
 */
@Injectable()
export class GetHistoryUseCase {
  private readonly logger = new Logger(GetHistoryUseCase.name);

  constructor(
    private readonly repository: CashBalanceRepository,
    private readonly clickhouse: ClickHouseReadService,
  ) {}

  async execute({ from, to, brands }: GetHistoryParams): Promise<CashBalanceHistory> {
    const [records, kpis] = await Promise.all([
      this.repository.findRegisteredRange(brands, from, to),
      this.fetchKpiRows(from, to),
    ]);

    const days = this.buildDays(records, kpis.rows);
    const rangeDays = daysInRange(from, to);

    return {
      from,
      to,
      rangeDays,
      registeredDays: days.length,
      kpisAvailable: kpis.available,
      kpis: this.buildKpis({ brands, days, rows: kpis.rows, rangeDays }),
      days,
      totals: this.buildTotals(days),
    };
  }

  /** KPI indisponível não derruba o histórico: a tabela continua respondendo. */
  private async fetchKpiRows(from: string, to: string): Promise<KpiRowsResult> {
    if (!this.clickhouse.isConfigured) return { rows: [], available: false };

    try {
      return { rows: await this.clickhouse.fetchKpisByDayAndBrand(from, to), available: true };
    } catch (error) {
      this.logger.warn(`KPIs indisponíveis para ${from}..${to}: ${(error as Error).message}`);
      return { rows: [], available: false };
    }
  }

  private buildDays(records: RegisteredBalanceRecord[], kpiRows: DailyBrandKpi[]): HistoryDay[] {
    const kpiByDayAndBrand = new Map(kpiRows.map((row) => [`${row.date}|${row.brand}`, row]));
    const byDate = new Map<string, RegisteredBalanceRecord[]>();

    for (const record of records) {
      const dayRecords = byDate.get(record.referenceDate) ?? [];
      dayRecords.push(record);
      byDate.set(record.referenceDate, dayRecords);
    }

    // Mais recente primeiro, como na leitura de extrato.
    const dates = [...byDate.keys()].sort((left, right) => right.localeCompare(left));

    return dates.map((referenceDate) => {
      const dayRecords = this.sortByBrandOrder(byDate.get(referenceDate) ?? []);
      const brandRows = dayRecords.map((record) => this.toBrandRow(record, kpiByDayAndBrand));

      return {
        referenceDate,
        dayStatus: dayRecords[0].dayStatus,
        brands: brandRows,
        subtotal: this.sumAmounts(brandRows),
      };
    });
  }

  /** Ordem do catálogo (Suprema, Ultra, Maxima), não a do banco. */
  private sortByBrandOrder(records: RegisteredBalanceRecord[]): RegisteredBalanceRecord[] {
    return [...records].sort(
      (left, right) => BRAND_KEYS.indexOf(left.brand) - BRAND_KEYS.indexOf(right.brand),
    );
  }

  private toBrandRow(
    record: RegisteredBalanceRecord,
    kpis: Map<string, DailyBrandKpi>,
  ): HistoryBrandRow {
    const kpi = kpis.get(`${record.referenceDate}|${record.brand}`);
    const deposits = roundCurrency(kpi?.depositsTotal ?? 0);
    const withdrawals = roundCurrency(kpi?.withdrawalsTotal ?? 0);

    return {
      brand: record.brand,
      label: BRANDS.find((item) => item.key === record.brand)?.label ?? record.brand,
      deposits,
      withdrawals,
      netDeposit: roundCurrency(deposits - withdrawals),
      saldoTransacional: record.saldoTransacional,
      saldoJogadores: record.saldoJogadores,
      totalBalanco: record.totalBalanco,
      acumuladoMensal: record.acumuladoMensal,
    };
  }

  private sumAmounts(rows: HistoryAmounts[]): HistoryAmounts {
    const total = rows.reduce<HistoryAmounts>(
      (accumulated, row) => ({
        deposits: accumulated.deposits + row.deposits,
        withdrawals: accumulated.withdrawals + row.withdrawals,
        netDeposit: accumulated.netDeposit + row.netDeposit,
        saldoTransacional: accumulated.saldoTransacional + row.saldoTransacional,
        saldoJogadores: accumulated.saldoJogadores + row.saldoJogadores,
        totalBalanco: accumulated.totalBalanco + row.totalBalanco,
        acumuladoMensal: accumulated.acumuladoMensal + row.acumuladoMensal,
      }),
      { ...EMPTY_AMOUNTS },
    );

    return {
      deposits: roundCurrency(total.deposits),
      withdrawals: roundCurrency(total.withdrawals),
      netDeposit: roundCurrency(total.netDeposit),
      saldoTransacional: roundCurrency(total.saldoTransacional),
      saldoJogadores: roundCurrency(total.saldoJogadores),
      totalBalanco: roundCurrency(total.totalBalanco),
      acumuladoMensal: roundCurrency(total.acumuladoMensal),
    };
  }

  private buildKpis(params: {
    brands: BrandKey[];
    days: HistoryDay[];
    rows: DailyBrandKpi[];
    rangeDays: number;
  }): HistoryKpis {
    const { brands, days, rows, rangeDays } = params;

    const deposits = this.sumByBrand(rows, (row) => row.depositsTotal);
    const withdrawals = this.sumByBrand(rows, (row) => row.withdrawalsTotal);
    const netDeposit = subtractByBrand(deposits, withdrawals);
    const totalBalanco = this.balancoByBrand(days);

    return {
      deposits: buildKpiCard(brands, deposits),
      withdrawals: buildKpiCard(brands, withdrawals),
      netDeposit: buildKpiCard(brands, netDeposit),
      totalBalanco: buildKpiCard(brands, totalBalanco),
      // Net deposit tem dado do warehouse em cada dia: média sobre o intervalo.
      netDepositDailyAverage: buildKpiCard(brands, divideByBrand(netDeposit, rangeDays)),
      // Balanço só existe em dia registrado: dia sem registro não entra na média.
      totalBalancoDailyAverage: buildKpiCard(brands, divideByBrand(totalBalanco, days.length)),
    };
  }

  private sumByBrand(
    rows: DailyBrandKpi[],
    pick: (row: DailyBrandKpi) => number,
  ): Map<BrandKey, number> {
    const totals = new Map<BrandKey, number>();

    for (const row of rows) {
      totals.set(row.brand, (totals.get(row.brand) ?? 0) + pick(row));
    }

    return totals;
  }

  private balancoByBrand(days: HistoryDay[]): Map<BrandKey, number> {
    const totals = new Map<BrandKey, number>();

    for (const day of days) {
      for (const row of day.brands) {
        totals.set(row.brand, (totals.get(row.brand) ?? 0) + row.totalBalanco);
      }
    }

    return totals;
  }

  private buildTotals(days: HistoryDay[]): HistoryTotals {
    const flow = this.sumAmounts(days.map((day) => day.subtotal));
    // days já vem do mais recente para o mais antigo.
    const lastDay = days.at(0);

    return {
      deposits: flow.deposits,
      withdrawals: flow.withdrawals,
      netDeposit: flow.netDeposit,
      totalBalanco: flow.totalBalanco,
      lastDay: lastDay
        ? {
            referenceDate: lastDay.referenceDate,
            saldoTransacional: lastDay.subtotal.saldoTransacional,
            saldoJogadores: lastDay.subtotal.saldoJogadores,
            acumuladoMensal: lastDay.subtotal.acumuladoMensal,
          }
        : null,
    };
  }
}
