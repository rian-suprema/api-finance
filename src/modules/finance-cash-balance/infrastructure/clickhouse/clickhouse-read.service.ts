import { Injectable } from '@nestjs/common';

import { ClickHouseService } from '../../../../clickhouse/clickhouse.service';
import { startOfMonth } from '../../../../common/utils/date.util';
import { toNumber } from '../../../../common/utils/number.util';
import { BRAND_KEYS, type BrandKey } from '../../cash-balance.constants';

/**
 * Leitura somente de marts dbt em `dw_bet.*` (ADR-034). Nunca ler tabelas raw.
 * Datas sempre via `query_params` — nunca interpolar string na query.
 */

const BRAND_NORMALIZATION = `multiIf(brand = 'suprema', 'Suprema', brand = 'maxima', 'Maxima', brand = 'ultra', 'Ultra', brand)`;

const DAILY_KPI_QUERY = `
  SELECT
    ${BRAND_NORMALIZATION} AS marca,
    sum(deposit_total) AS total_deposito,
    sum(deposit_count) AS qtd_depositos,
    sum(saque_total)   AS total_saque,
    sum(saque_count)   AS qtd_saques
  FROM dw_bet.fct_kpi_daily
  WHERE dia_brt = toDate({data_referencia:String})
  GROUP BY marca
`;

const MONTHLY_KPI_QUERY = `
  SELECT
    ${BRAND_NORMALIZATION} AS marca,
    sum(deposit_total) AS total_deposito,
    sum(saque_total)   AS total_saque
  FROM dw_bet.fct_kpi_daily
  WHERE dia_brt >= toDate({data_inicio:String})
    AND dia_brt <= toDate({data_final:String})
  GROUP BY marca
`;

/**
 * Depósito e saque por dia e marca no intervalo — alimenta a tabela do
 * histórico e, somada em memória, os KPIs do período. Mantida separada da
 * mensal de propósito: a mensal é o caminho da tela do dia, já conferido.
 */
const DAILY_KPI_BY_BRAND_RANGE_QUERY = `
  SELECT
    toString(dia_brt) AS dia,
    ${BRAND_NORMALIZATION} AS marca,
    sum(deposit_total) AS total_deposito,
    sum(saque_total)   AS total_saque
  FROM dw_bet.fct_kpi_daily
  WHERE dia_brt >= toDate({data_inicio:String})
    AND dia_brt <= toDate({data_final:String})
  GROUP BY dia, marca
`;

/** `FINAL` obrigatório: sem ele, linha não deduplicada infla o saldo. */
const PLAYERS_BALANCE_QUERY = `
  SELECT
    ${BRAND_NORMALIZATION} AS marca,
    saldo_financeiro_total_disponivel_apostadores AS saldo
  FROM dw_bet.fct_sigap_saldo_diario FINAL
  WHERE summary_date BETWEEN parseDateTimeBestEffort({data_inicio:String})
                         AND parseDateTimeBestEffort({data_final:String})
  ORDER BY summary_date DESC, marca
`;

interface DailyKpiRow {
  marca: string;
  total_deposito: unknown;
  qtd_depositos: unknown;
  total_saque: unknown;
  qtd_saques: unknown;
}

interface MonthlyKpiRow {
  marca: string;
  total_deposito: unknown;
  total_saque: unknown;
}

interface DailyBrandKpiRow {
  dia: unknown;
  marca: string;
  total_deposito: unknown;
  total_saque: unknown;
}

interface PlayersBalanceRow {
  marca: string;
  saldo: unknown;
}

export interface DailyKpi {
  brand: BrandKey;
  depositsTotal: number;
  depositsCount: number;
  withdrawalsTotal: number;
  withdrawalsCount: number;
}

export interface MonthlyKpi {
  brand: BrandKey;
  depositsTotal: number;
  withdrawalsTotal: number;
}

export interface DailyBrandKpi {
  /** `YYYY-MM-DD` em BRT. */
  date: string;
  brand: BrandKey;
  depositsTotal: number;
  withdrawalsTotal: number;
}

@Injectable()
export class ClickHouseReadService {
  constructor(private readonly clickhouse: ClickHouseService) {}

  get isConfigured(): boolean {
    return this.clickhouse.isConfigured;
  }

  async fetchDailyKpis(referenceDate: string): Promise<DailyKpi[]> {
    const rows = await this.clickhouse.query<DailyKpiRow>(DAILY_KPI_QUERY, {
      data_referencia: referenceDate,
    });

    return this.mapByBrand(rows, (row) => ({
      depositsTotal: toNumber(row.total_deposito),
      depositsCount: toNumber(row.qtd_depositos),
      withdrawalsTotal: toNumber(row.total_saque),
      withdrawalsCount: toNumber(row.qtd_saques),
    }));
  }

  async fetchMonthlyKpis(referenceDate: string): Promise<MonthlyKpi[]> {
    const rows = await this.clickhouse.query<MonthlyKpiRow>(MONTHLY_KPI_QUERY, {
      data_inicio: startOfMonth(referenceDate),
      data_final: referenceDate,
    });

    return this.mapByBrand(rows, (row) => ({
      depositsTotal: toNumber(row.total_deposito),
      withdrawalsTotal: toNumber(row.total_saque),
    }));
  }

  /** Depósito e saque de cada dia do intervalo, por marca. */
  async fetchKpisByDayAndBrand(from: string, to: string): Promise<DailyBrandKpi[]> {
    const rows = await this.clickhouse.query<DailyBrandKpiRow>(DAILY_KPI_BY_BRAND_RANGE_QUERY, {
      data_inicio: from,
      data_final: to,
    });

    const result: DailyBrandKpi[] = [];

    for (const row of rows) {
      const brand = this.toBrandKey(row.marca);
      if (!brand) continue;

      result.push({
        date: String(row.dia).slice(0, 10),
        brand,
        depositsTotal: toNumber(row.total_deposito),
        withdrawalsTotal: toNumber(row.total_saque),
      });
    }

    return result;
  }

  /** Saldo dos jogadores do dia informado, por marca. */
  async fetchPlayersBalances(referenceDate: string): Promise<Map<BrandKey, number>> {
    const rows = await this.clickhouse.query<PlayersBalanceRow>(PLAYERS_BALANCE_QUERY, {
      data_inicio: referenceDate,
      data_final: referenceDate,
    });

    const balances = new Map<BrandKey, number>();

    for (const row of rows) {
      const brand = this.toBrandKey(row.marca);
      // A query ordena por data desc: a primeira linha da marca é a mais recente.
      if (brand && !balances.has(brand)) balances.set(brand, toNumber(row.saldo));
    }

    return balances;
  }

  private mapByBrand<TRow extends { marca: string }, TValue>(
    rows: TRow[],
    map: (row: TRow) => TValue,
  ): Array<TValue & { brand: BrandKey }> {
    const result: Array<TValue & { brand: BrandKey }> = [];

    for (const row of rows) {
      const brand = this.toBrandKey(row.marca);
      if (brand) result.push({ ...map(row), brand });
    }

    return result;
  }

  private toBrandKey(marca: string): BrandKey | null {
    const normalized = marca?.toLowerCase() as BrandKey;
    return BRAND_KEYS.includes(normalized) ? normalized : null;
  }
}
