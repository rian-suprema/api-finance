import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CashBalanceModule } from '../finance-cash-balance/cash-balance.module';
import { ReconciliationItem } from './entities/reconciliation-item.entity';
import { ReconciliationRun } from './entities/reconciliation-run.entity';
import { CorrectionSearchService } from './infrastructure/clickhouse/correction-search.service';
import { PlatformMovementsService } from './infrastructure/clickhouse/platform-movements.service';
import { ReconciliationItemRepository } from './infrastructure/reconciliation-item.repository';
import { ReconciliationRunRepository } from './infrastructure/reconciliation-run.repository';
import { TrioMovementsService } from './infrastructure/trio/trio-movements.service';
import { CorrectionEvidenceService } from './domain/services/correction-evidence.service';
import { ReconciliationService } from './domain/services/reconciliation.service';
import { ApplyCorrectionMatchesUseCase } from './domain/use-cases/apply-correction-matches.use-case';
import { GetReconciliationHistoryUseCase } from './domain/use-cases/get-reconciliation-history.use-case';
import { GetReconciliationUseCase } from './domain/use-cases/get-reconciliation.use-case';
import { ResolveItemUseCase } from './domain/use-cases/resolve-item.use-case';
import { RunReconciliationUseCase } from './domain/use-cases/run-reconciliation.use-case';
import { SearchCorrectionsUseCase } from './domain/use-cases/search-corrections.use-case';
import { ReconciliationController } from './presenters/controllers/reconciliation.controller';

/**
 * Ganha conteúdo progressivamente nas Fases 10–14. Repositórios e serviços de
 * leitura são exportados para a Fase 14 (evidência de correção) e Fase 15
 * (CLI/CronJob).
 *
 * Importa `CashBalanceModule` para reusar `TrioBankingClient`/`BrandAccessService`/
 * `AuditInterceptor` (exportados de lá — Fases 12/13) — colaboração entre
 * módulos só via provider exportado, nunca duplicando cliente/lógica/tabela.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReconciliationRun, ReconciliationItem]), CashBalanceModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationRunRepository,
    ReconciliationItemRepository,
    PlatformMovementsService,
    CorrectionSearchService,
    TrioMovementsService,
    RunReconciliationUseCase,
    GetReconciliationUseCase,
    GetReconciliationHistoryUseCase,
    ResolveItemUseCase,
    ReconciliationService,
    SearchCorrectionsUseCase,
    ApplyCorrectionMatchesUseCase,
    CorrectionEvidenceService,
  ],
  exports: [
    ReconciliationRunRepository,
    ReconciliationItemRepository,
    PlatformMovementsService,
    CorrectionSearchService,
    TrioMovementsService,
    RunReconciliationUseCase,
    ReconciliationService,
  ],
})
export class ReconciliationModule {}
