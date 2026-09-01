import { Injectable } from '@nestjs/common';

import { GetBanksStateUseCase } from '../use-cases/get-banks-state.use-case';
import { GetHistoryUseCase } from '../use-cases/get-history.use-case';
import { GetSummaryUseCase } from '../use-cases/get-summary.use-case';
import { RefreshTrioUseCase } from '../use-cases/refresh-trio.use-case';
import type {
  CashBalanceBanksState,
  CashBalanceHistory,
  CashBalanceSummary,
  TrioBalance,
} from '../cash-balance.types';
import { BrandAccessService } from './brand-access.service';

/** Orquestra as leituras da tela. Sem regra de negócio. */
@Injectable()
export class CashBalanceReadService {
  constructor(
    private readonly access: BrandAccessService,
    private readonly getSummary: GetSummaryUseCase,
    private readonly getBanksState: GetBanksStateUseCase,
    private readonly getHistory: GetHistoryUseCase,
    private readonly refreshTrio: RefreshTrioUseCase,
  ) {}

  async summary(authorization: string, date?: string): Promise<CashBalanceSummary> {
    const { referenceDate, brands } = await this.resolveScope(authorization, date);
    return this.getSummary.execute({ referenceDate, brands });
  }

  async banks(authorization: string, date?: string): Promise<CashBalanceBanksState> {
    const { referenceDate, brands } = await this.resolveScope(authorization, date);
    return this.getBanksState.execute({ referenceDate, brands });
  }

  async history(authorization: string, from?: string, to?: string): Promise<CashBalanceHistory> {
    const range = this.access.resolveRange(from, to);
    const accessible = await this.access.resolveBrands(authorization);

    return this.getHistory.execute({
      ...range,
      brands: accessible.map((item) => item.brand),
    });
  }

  async trioBalances(authorization: string, date?: string): Promise<TrioBalance[]> {
    const { referenceDate, brands } = await this.resolveScope(authorization, date);
    return this.refreshTrio.execute({ referenceDate, brands });
  }

  private async resolveScope(authorization: string, date?: string) {
    const referenceDate = this.access.resolveReferenceDate(date);
    const accessible = await this.access.resolveBrands(authorization);
    return { referenceDate, brands: accessible.map((item) => item.brand) };
  }
}
