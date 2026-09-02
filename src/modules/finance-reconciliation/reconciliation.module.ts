import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ReconciliationItem } from './entities/reconciliation-item.entity';
import { ReconciliationRun } from './entities/reconciliation-run.entity';
import { CorrectionSearchService } from './infrastructure/clickhouse/correction-search.service';
import { PlatformMovementsService } from './infrastructure/clickhouse/platform-movements.service';
import { ReconciliationItemRepository } from './infrastructure/reconciliation-item.repository';
import { ReconciliationRunRepository } from './infrastructure/reconciliation-run.repository';

/**
 * Ganha conteúdo progressivamente nas Fases 10–14. Repositórios e serviços de
 * leitura são exportados para a Fase 13 (use-cases/controller).
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReconciliationRun, ReconciliationItem])],
  providers: [
    ReconciliationRunRepository,
    ReconciliationItemRepository,
    PlatformMovementsService,
    CorrectionSearchService,
  ],
  exports: [
    ReconciliationRunRepository,
    ReconciliationItemRepository,
    PlatformMovementsService,
    CorrectionSearchService,
  ],
})
export class ReconciliationModule {}
