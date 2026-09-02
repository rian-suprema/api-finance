import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CashBalanceBankEntry } from './entities/cash-balance-bank-entry.entity';
import { CashBalanceBrandSnapshot } from './entities/cash-balance-brand-snapshot.entity';
import { CashBalanceDaily } from './entities/cash-balance-daily.entity';
import { CashBalanceDay } from './entities/cash-balance-day.entity';
import { FinanceAuditLog } from './entities/finance-audit-log.entity';
import { TrioClosingBalance } from './entities/trio-closing-balance.entity';
import { AuditInterceptor } from './infrastructure/audit.interceptor';
import { ClickHouseReadService } from './infrastructure/clickhouse/clickhouse-read.service';
import { CashBalanceRepository } from './infrastructure/cash-balance.repository';
import { PlatformIdentityService } from './infrastructure/platform/platform-identity.service';
import { TrioBankingClient } from './infrastructure/trio/trio-banking.client';
import { TrioClosingBalanceRepository } from './infrastructure/trio-closing-balance.repository';
import { BrandAccessService } from './domain/services/brand-access.service';
import { CashBalanceReadService } from './domain/services/cash-balance-read.service';
import { CashBalanceRegistryService } from './domain/services/cash-balance-registry.service';
import { ConfirmBankUseCase } from './domain/use-cases/confirm-bank.use-case';
import { GetBanksStateUseCase } from './domain/use-cases/get-banks-state.use-case';
import { GetHistoryUseCase } from './domain/use-cases/get-history.use-case';
import { GetSummaryUseCase } from './domain/use-cases/get-summary.use-case';
import { RefreshTrioUseCase } from './domain/use-cases/refresh-trio.use-case';
import { RegisterBrandUseCase } from './domain/use-cases/register-brand.use-case';
import { ReopenBrandUseCase } from './domain/use-cases/reopen-brand.use-case';
import { CashBalanceController } from './presenters/controllers/cash-balance.controller';

/**
 * `BrandAccessService`/`TrioBankingClient` são exportados para reuso pelo
 * `ReconciliationModule` (`TrioBankingClient` desde a Fase 12, para
 * `TrioMovementsService`; `BrandAccessService` a partir da Fase 13) —
 * colaboração entre módulos só via service exportado, nunca import direto de
 * arquivo de outro módulo. `AuditInterceptor` entra no `exports` pelo mesmo
 * motivo (Fase 13, decisão do usuário): `ReconciliationController` reusa a
 * mesma classe via `@UseInterceptors(AuditInterceptor)`.
 *
 * `TypeOrmModule` (o módulo dinâmico, não um token) também entra no
 * `exports` — descoberta empírica desta fase: `@UseInterceptors(Classe)`
 * resolve as dependências do enhancer no container do módulo que declara o
 * controller (`ReconciliationModule`), não no container onde a classe foi
 * originalmente registrada. Sem reexportar `TypeOrmModule`,
 * `FinanceAuditLogRepository` (dependência de `AuditInterceptor`) fica
 * invisível para `ReconciliationModule` e o boot falha com
 * `UnknownDependenciesException`. Reexportar o módulo dinâmico (em vez de só
 * um token específico) resolve sem duplicar `TypeOrmModule.forFeature(...)`
 * noutro módulo.
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
  controllers: [CashBalanceController],
  providers: [
    CashBalanceRepository,
    TrioClosingBalanceRepository,
    ClickHouseReadService,
    PlatformIdentityService,
    TrioBankingClient,
    BrandAccessService,
    AuditInterceptor,
    GetSummaryUseCase,
    GetBanksStateUseCase,
    GetHistoryUseCase,
    RefreshTrioUseCase,
    ConfirmBankUseCase,
    RegisterBrandUseCase,
    ReopenBrandUseCase,
    CashBalanceReadService,
    CashBalanceRegistryService,
  ],
  exports: [
    TypeOrmModule,
    CashBalanceRepository,
    TrioClosingBalanceRepository,
    ClickHouseReadService,
    TrioBankingClient,
    BrandAccessService,
    AuditInterceptor,
  ],
})
export class CashBalanceModule {}
