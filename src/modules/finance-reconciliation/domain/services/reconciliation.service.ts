import { Injectable, Logger } from '@nestjs/common';

import { BrandAccessService } from '../../../finance-cash-balance/domain/services/brand-access.service';
import type { ReconciliationHistoryResult, ReconciliationResult } from '../reconciliation.types';
import { GetReconciliationHistoryUseCase } from '../use-cases/get-reconciliation-history.use-case';
import { GetReconciliationUseCase } from '../use-cases/get-reconciliation.use-case';
import { ResolveItemUseCase } from '../use-cases/resolve-item.use-case';
import { RunReconciliationUseCase } from '../use-cases/run-reconciliation.use-case';

/**
 * Orquestra os 4 use-cases desta fase + `BrandAccessService` (reusado via
 * `CashBalanceModule` exportado — decisão 12). Único ponto que resolve marca
 * acessível e data de referência antes de delegar. `ResolveItemUseCase`
 * concentra as 2 transições de estado da pendência (resolve/reopen) — ver o
 * comentário da classe.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly brandAccess: BrandAccessService,
    private readonly getReconciliation: GetReconciliationUseCase,
    private readonly getHistory: GetReconciliationHistoryUseCase,
    private readonly runReconciliation: RunReconciliationUseCase,
    private readonly resolveItem: ResolveItemUseCase,
  ) {}

  async get(authorization: string, date?: string): Promise<ReconciliationResult> {
    const referenceDate = this.brandAccess.resolveReferenceDate(date);
    const brands = await this.accessibleBrandKeys(authorization);
    return this.getReconciliation.execute({ referenceDate, brands });
  }

  async history(
    authorization: string,
    from?: string,
    to?: string,
  ): Promise<ReconciliationHistoryResult> {
    const range = this.brandAccess.resolveRange(from, to);
    const brands = await this.accessibleBrandKeys(authorization);
    return this.getHistory.execute({ ...range, brands });
  }

  /** Dispara sem `await` — a rota nunca espera a varredura (§3.3). */
  async run(authorization: string, date?: string): Promise<{ referenceDate: string }> {
    const referenceDate = this.brandAccess.resolveReferenceDate(date);
    const brands = await this.accessibleBrandKeys(authorization);

    void this.runReconciliation
      .execute({ referenceDate, brands })
      .catch((error: unknown) =>
        this.logger.error(`Falha ao disparar conciliação: ${(error as Error).message}`),
      );

    return { referenceDate };
  }

  async resolve(authorization: string, id: number, note: string, userId: string): Promise<void> {
    const allowedBrands = await this.accessibleBrandKeys(authorization);
    await this.resolveItem.resolve({ id, note, userId, allowedBrands });
  }

  async reopen(authorization: string, id: number): Promise<void> {
    const allowedBrands = await this.accessibleBrandKeys(authorization);
    await this.resolveItem.reopen({ id, allowedBrands });
  }

  private async accessibleBrandKeys(authorization: string): Promise<string[]> {
    const access = await this.brandAccess.resolveBrands(authorization);
    return access.map((item) => item.brand);
  }
}
