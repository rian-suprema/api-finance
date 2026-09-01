import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CashBalanceBankEntry } from './entities/cash-balance-bank-entry.entity';
import { CashBalanceBrandSnapshot } from './entities/cash-balance-brand-snapshot.entity';
import { CashBalanceDaily } from './entities/cash-balance-daily.entity';
import { CashBalanceDay } from './entities/cash-balance-day.entity';
import { FinanceAuditLog } from './entities/finance-audit-log.entity';
import { TrioClosingBalance } from './entities/trio-closing-balance.entity';
import { ClickHouseReadService } from './infrastructure/clickhouse/clickhouse-read.service';
import { CashBalanceRepository } from './infrastructure/cash-balance.repository';
import { PlatformIdentityService } from './infrastructure/platform/platform-identity.service';
import { TrioClosingBalanceRepository } from './infrastructure/trio-closing-balance.repository';
import { BrandAccessService } from './domain/services/brand-access.service';

/**
 * Ganha conteúdo progressivamente — use-cases e controller chegam na Fase 09.
 * `BrandAccessService` é exportado para reuso pelo `ReconciliationModule`
 * (Fase 13) — colaboração entre módulos só via service exportado, nunca
 * import direto de arquivo de outro módulo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashBalanceDay,
      CashBalanceDaily,
      CashBalanceBankEntry,
      CashBalanceBrandSnapshot,
      TrioClosingBalance,
      FinanceAuditLog,
    ]),
  ],
  providers: [
    CashBalanceRepository,
    TrioClosingBalanceRepository,
    ClickHouseReadService,
    PlatformIdentityService,
    BrandAccessService,
  ],
  exports: [
    CashBalanceRepository,
    TrioClosingBalanceRepository,
    ClickHouseReadService,
    BrandAccessService,
  ],
})
export class CashBalanceModule {}
