import { Injectable, Logger } from '@nestjs/common';

import { roundCurrency } from '../../../../common/utils/number.util';
import {
  BANKS,
  BRANDS,
  TRIO_BANK_KEY,
  type BankConfig,
  type BrandKey,
} from '../../cash-balance.constants';
import { CashBalanceBrandStatus } from '../../cash-balance.enums';
import { CashBalanceRepository } from '../../infrastructure/cash-balance.repository';
import type {
  BankEntryRecord,
  BrandDailyRecord,
  DayRecord,
} from '../../infrastructure/cash-balance.repository.types';
import { ClickHouseReadService } from '../../infrastructure/clickhouse/clickhouse-read.service';
import type {
  BankState,
  BrandBanksState,
  CashBalanceBanksState,
  TrioBalance,
} from '../cash-balance.types';
import { RefreshTrioUseCase } from './refresh-trio.use-case';

interface GetBanksStateParams {
  referenceDate: string;
  brands: BrandKey[];
}

/**
 * Estado da tela de bancos: saldo do dia anterior por banco e por marca.
 * Trio é read-only e vem do fechamento capturado no Postgres (nunca da API da
 * Trio em tempo de request); manuais trazem o último saldo como sugestão.
 */
@Injectable()
export class GetBanksStateUseCase {
  private readonly logger = new Logger(GetBanksStateUseCase.name);

  constructor(
    private readonly repository: CashBalanceRepository,
    private readonly clickhouse: ClickHouseReadService,
    private readonly trioClosing: RefreshTrioUseCase,
  ) {}

  async execute({ referenceDate, brands }: GetBanksStateParams): Promise<CashBalanceBanksState> {
    const [day, lastKnown, monthlyTotals, trioBalances, playersBalances] = await Promise.all([
      this.repository.findDay(referenceDate),
      this.repository.findLastKnownBalances(brands, referenceDate),
      this.repository.sumMonthlyBalances(brands, referenceDate),
      this.trioClosing.execute({ referenceDate, brands }),
      this.loadPlayersBalances(referenceDate),
    ]);

    const trioByBrand = new Map(trioBalances.map((item) => [item.brand, item]));

    const brandStates = brands.map((brand) =>
      this.buildBrandState({
        brand,
        daily: day?.brands.find((item) => item.brand === brand) ?? null,
        lastKnown: lastKnown.get(brand) ?? new Map<string, number>(),
        trio: trioByBrand.get(brand),
        saldoJogadores: playersBalances?.get(brand) ?? null,
        acumuladoMensal: monthlyTotals.get(brand) ?? 0,
      }),
    );

    return {
      referenceDate,
      dayStatus: day?.status ?? 'OPEN',
      allBrandsConfirmed: this.allBrandsConfirmed(day),
      brands: brandStates,
    };
  }

  private allBrandsConfirmed(day: DayRecord | null): boolean {
    if (!day) return false;
    const confirmed = day.brands.filter(
      (brand) => brand.status === CashBalanceBrandStatus.CONFIRMED,
    ).length;
    return confirmed >= BRANDS.length;
  }

  private async loadPlayersBalances(referenceDate: string): Promise<Map<BrandKey, number> | null> {
    if (!this.clickhouse.isConfigured) return null;

    try {
      return await this.clickhouse.fetchPlayersBalances(referenceDate);
    } catch (error) {
      this.logger.warn(`Saldo de jogadores indisponível: ${(error as Error).message}`);
      return null;
    }
  }

  private buildBrandState(params: {
    brand: BrandKey;
    daily: BrandDailyRecord | null;
    lastKnown: Map<string, number>;
    trio?: TrioBalance;
    saldoJogadores: number | null;
    acumuladoMensal: number;
  }): BrandBanksState {
    const { brand, daily, lastKnown, trio, saldoJogadores, acumuladoMensal } = params;
    const persisted = new Map((daily?.entries ?? []).map((entry) => [entry.bank, entry]));

    const banks: BankState[] = BANKS.map((bank) =>
      bank.key === TRIO_BANK_KEY
        ? this.buildTrioBankState(bank, persisted.get(bank.key), trio)
        : this.buildManualBankState(bank, persisted.get(bank.key), lastKnown),
    );

    const saldoTransacional = roundCurrency(banks.reduce((total, bank) => total + bank.balance, 0));
    const pendingBanks = banks.filter((bank) => !bank.confirmed).map((bank) => bank.bank);

    return {
      brand,
      label: BRANDS.find((item) => item.key === brand)?.label ?? brand,
      status: daily?.status ?? 'DRAFT',
      allBanksConfirmed: pendingBanks.length === 0,
      pendingBanks,
      banks,
      saldoTransacional,
      saldoJogadores: saldoJogadores === null ? null : roundCurrency(saldoJogadores),
      // Transacional menos jogadores: é o excedente a retirar da conta
      // transacional. Positivo = sobra a transferir; negativo = a transacional
      // está abaixo do que se deve aos jogadores, que é situação de alerta.
      totalBalanco:
        saldoJogadores === null ? null : roundCurrency(saldoTransacional - saldoJogadores),
      acumuladoMensal: roundCurrency(acumuladoMensal),
      confirmedAt: daily?.confirmedAt?.toISOString() ?? null,
    };
  }

  private buildTrioBankState(
    bank: BankConfig,
    entry: BankEntryRecord | undefined,
    trio: TrioBalance | undefined,
  ): BankState {
    const balance = trio?.balance ?? entry?.balance ?? 0;
    return {
      bank: bank.key,
      label: bank.label,
      type: bank.type,
      readOnly: true,
      balance: roundCurrency(balance),
      confirmed: trio?.available === true,
      suggested: trio?.available !== true,
      available: trio?.available ?? false,
      message: trio?.message,
      capturedAt: trio?.capturedAt ?? null,
      exact: trio?.exact ?? false,
    };
  }

  private buildManualBankState(
    bank: BankConfig,
    entry: BankEntryRecord | undefined,
    lastKnown: Map<string, number>,
  ): BankState {
    if (entry?.confirmed) {
      return {
        bank: bank.key,
        label: bank.label,
        type: bank.type,
        readOnly: false,
        balance: roundCurrency(entry.balance),
        confirmed: true,
        suggested: false,
        available: true,
      };
    }

    const suggestion = entry?.balance ?? lastKnown.get(bank.key) ?? 0;
    return {
      bank: bank.key,
      label: bank.label,
      type: bank.type,
      readOnly: false,
      balance: roundCurrency(suggestion),
      confirmed: false,
      suggested: true,
      available: true,
    };
  }
}
