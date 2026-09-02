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

/**
 * Ganha conteúdo progressivamente nas Fases 10–14. Repositórios e serviços de
 * leitura são exportados para a Fase 13 (use-cases/controller).
 *
 * Importa `CashBalanceModule` para reusar `TrioBankingClient` (exportado de
 * lá desde a Fase 12, para `TrioMovementsService`) — colaboração entre
 * módulos só via provider exportado, nunca duplicando o cliente Trio.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReconciliationRun, ReconciliationItem]), CashBalanceModule],
  providers: [
    ReconciliationRunRepository,
    ReconciliationItemRepository,
    PlatformMovementsService,
    CorrectionSearchService,
    TrioMovementsService,
  ],
  exports: [
    ReconciliationRunRepository,
    ReconciliationItemRepository,
    PlatformMovementsService,
    CorrectionSearchService,
    TrioMovementsService,
  ],
})
export class ReconciliationModule {}
