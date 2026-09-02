import { Injectable, Logger } from '@nestjs/common';

import { roundCurrency } from '../../../../common/utils/number.util';
import { BANKS, BRANDS, type BrandKey } from '../../cash-balance.constants';
import { CashBalanceRepository } from '../../infrastructure/cash-balance.repository';

/** Uma linha da fonte externa: um dia + uma marca, com os saldos já apurados. */
export interface ImportBalanceRow {
  referenceDate: string;
  brand: BrandKey;
  /** Saldo por banco. Banco do catálogo ausente aqui entra como zero. */
  bankBalances: Map<string, number>;
  saldoTransacional: number;
  saldoJogadores: number;
  totalBalanco: number;
}

export interface ImportBalanceHistoryParams {
  rows: ImportBalanceRow[];
  importedBy: string;
  /** false apenas valida e relata, sem escrever nada. */
  apply: boolean;
  /** true regrava dias que já estão registrados. */
  overwrite: boolean;
}

export interface ImportBalanceHistoryReport {
  totalRows: number;
  imported: number;
  skipped: Array<{ referenceDate: string; brand: BrandKey; reason: string }>;
  problems: string[];
  daysClosed: string[];
  accumulatedRecomputed: number;
  range: { from: string; to: string } | null;
}

/** Diferença aceita entre valor informado e recalculado, em reais. */
const TOLERANCE = 0.01;

/**
 * Carga de balanços históricos a partir de fonte externa (planilha da operação).
 *
 * Não passa pelo fluxo normal de registro de propósito: aquele exige fechamento
 * da Trio capturado no dia e recalcula o saldo de jogadores no data warehouse —
 * nada disso existe para dias passados. Aqui a planilha **é** a fonte, e cada
 * linha é validada contra as próprias fórmulas do módulo antes de entrar.
 */
@Injectable()
export class ImportBalanceHistoryUseCase {
  private readonly logger = new Logger(ImportBalanceHistoryUseCase.name);

  constructor(private readonly repository: CashBalanceRepository) {}

  async execute(params: ImportBalanceHistoryParams): Promise<ImportBalanceHistoryReport> {
    const { rows, importedBy, apply, overwrite } = params;

    const report: ImportBalanceHistoryReport = {
      totalRows: rows.length,
      imported: 0,
      skipped: [],
      problems: [],
      daysClosed: [],
      accumulatedRecomputed: 0,
      range: null,
    };

    if (!rows.length) return report;

    const ordered = [...rows].sort(
      (left, right) =>
        left.referenceDate.localeCompare(right.referenceDate) ||
        BRANDS.findIndex((item) => item.key === left.brand) -
          BRANDS.findIndex((item) => item.key === right.brand),
    );

    const from = ordered[0].referenceDate;
    const to = ordered[ordered.length - 1].referenceDate;
    report.range = { from, to };

    report.problems = this.validate(ordered);

    const [registered, tenantIds] = await Promise.all([
      this.repository.findRegisteredKeys(from, to),
      this.repository.findTenantIdsByBrand(),
    ]);

    for (const row of ordered) {
      const tenantId = tenantIds.get(row.brand);

      if (!tenantId) {
        report.skipped.push({
          referenceDate: row.referenceDate,
          brand: row.brand,
          reason: 'marca sem tenant conhecido no banco — registre um dia por ela primeiro',
        });
        continue;
      }

      if (registered.has(`${row.referenceDate}|${row.brand}`) && !overwrite) {
        report.skipped.push({
          referenceDate: row.referenceDate,
          brand: row.brand,
          reason: 'já registrado no banco',
        });
        continue;
      }

      if (apply) {
        await this.repository.importBrandBalance({
          referenceDate: row.referenceDate,
          brand: row.brand,
          tenantId,
          importedBy,
          bankBalances: this.completeBanks(row.bankBalances),
          saldoTransacional: row.saldoTransacional,
          saldoJogadores: row.saldoJogadores,
          totalBalanco: row.totalBalanco,
        });
      }

      report.imported++;
    }

    if (apply && report.imported > 0) {
      report.daysClosed = await this.repository.closeCompleteDays(
        from,
        to,
        BRANDS.length,
        importedBy,
      );
      report.accumulatedRecomputed = await this.recomputeMonths(ordered);
    }

    return report;
  }

  /**
   * Banco do catálogo que a fonte não traz entra como zero: o total de bancos
   * da planilha é a soma apenas das colunas que ela tem, então os demais
   * estavam zerados no período.
   */
  private completeBanks(bankBalances: Map<string, number>): Map<string, number> {
    const complete = new Map<string, number>();

    for (const bank of BANKS) {
      complete.set(bank.key, roundCurrency(bankBalances.get(bank.key) ?? 0));
    }

    return complete;
  }

  /**
   * Confere cada linha contra as fórmulas do módulo. Divergência não bloqueia a
   * carga — a planilha é a fonte —, mas vai no relatório para conferência.
   */
  private validate(rows: ImportBalanceRow[]): string[] {
    const problems: string[] = [];

    for (const row of rows) {
      const label = `${row.referenceDate} ${row.brand}`;

      const banksSum = roundCurrency(
        [...row.bankBalances.values()].reduce((total, balance) => total + balance, 0),
      );

      if (Math.abs(banksSum - row.saldoTransacional) > TOLERANCE) {
        problems.push(
          `${label}: soma dos bancos ${banksSum} diverge do saldo transacional informado ${row.saldoTransacional}`,
        );
      }

      const expectedBalanco = roundCurrency(row.saldoTransacional - row.saldoJogadores);

      if (Math.abs(expectedBalanco - row.totalBalanco) > TOLERANCE) {
        problems.push(
          `${label}: total do balanço informado ${row.totalBalanco} diverge de transacional − jogadores ${expectedBalanco}`,
        );
      }
    }

    return problems;
  }

  /** Um recálculo por mês afetado, não por linha. */
  private async recomputeMonths(rows: ImportBalanceRow[]): Promise<number> {
    const months = new Set(rows.map((row) => row.referenceDate.slice(0, 7)));
    let updated = 0;

    for (const month of months) {
      updated += await this.repository.recomputeMonthlyAccumulated(`${month}-01`);
      this.logger.log(`Acumulado mensal recalculado para ${month}`);
    }

    return updated;
  }
}
