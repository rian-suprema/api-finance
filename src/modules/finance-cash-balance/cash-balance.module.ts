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
import { TrioClosingBalanceRepository } from './infrastructure/trio-closing-balance.repository';

/**
 * Ganha conteúdo progressivamente — use-cases, controller e o provider
 * `CLOSING_BALANCE_SOURCE` (Trio) chegam na Fase 08/09.
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
  providers: [CashBalanceRepository, TrioClosingBalanceRepository, ClickHouseReadService],
  exports: [CashBalanceRepository, TrioClosingBalanceRepository, ClickHouseReadService],
})
export class CashBalanceModule {}
