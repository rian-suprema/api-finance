import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthToken } from '../../../../auth/auth-token.decorator';
import { CurrentUser } from '../../../../auth/current-user.decorator';
import { Permissions } from '../../../../auth/permissions.decorator';
import { FINANCE_CASH_BALANCE } from '../../../../auth/permissions.constants';
import type { JwtPayload } from '../../../../auth/jwt-payload.interface';
import { AuditInterceptor } from '../../infrastructure/audit.interceptor';
import { CashBalanceReadService } from '../../domain/services/cash-balance-read.service';
import { CashBalanceRegistryService } from '../../domain/services/cash-balance-registry.service';
import {
  CashBalanceHistoryQueryDto,
  CashBalanceQueryDto,
  ConfirmBankDto,
  RegisterBrandDto,
} from '../../dto/cash-balance.dto';

@ApiTags('cash-balance')
@ApiBearerAuth()
@Controller('cash-balance')
@UseInterceptors(AuditInterceptor)
export class CashBalanceController {
  constructor(
    private readonly readService: CashBalanceReadService,
    private readonly registryService: CashBalanceRegistryService,
  ) {}

  @Get('summary')
  @Permissions(FINANCE_CASH_BALANCE.SUMMARY_READ)
  @ApiOperation({ summary: 'KPIs de depósito e saque (dia anterior e mês vigente)' })
  @ApiResponse({ status: 200, description: 'KPIs do topo da tela' })
  @ApiResponse({ status: 400, description: 'Formato de data inválido' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  summary(@AuthToken() authorization: string, @Query() query: CashBalanceQueryDto) {
    return this.readService.summary(authorization, query.date);
  }

  @Get('banks')
  @Permissions(FINANCE_CASH_BALANCE.BANKS_READ)
  @ApiOperation({ summary: 'Estado dos bancos por marca, com saldos sugeridos' })
  @ApiResponse({ status: 200, description: 'Estado editável do dia por banco e marca' })
  @ApiResponse({ status: 400, description: 'Formato de data inválido' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  banks(@AuthToken() authorization: string, @Query() query: CashBalanceQueryDto) {
    return this.readService.banks(authorization, query.date);
  }

  @Get('history')
  @Permissions(FINANCE_CASH_BALANCE.SUMMARY_READ)
  @ApiOperation({ summary: 'Histórico de balanços por dia e marca, com KPIs do período' })
  @ApiResponse({ status: 200, description: 'Tabela de dias registrados + KPIs do período' })
  @ApiResponse({ status: 400, description: 'Formato de data, from > to, ou intervalo > 180 dias' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  history(@AuthToken() authorization: string, @Query() query: CashBalanceHistoryQueryDto) {
    return this.readService.history(authorization, query.from, query.to);
  }

  @Get('trio/refresh')
  @Permissions(FINANCE_CASH_BALANCE.BANKS_READ)
  @ApiOperation({ summary: 'Releitura dos saldos das contas Trio (lê do Postgres, não da Trio)' })
  @ApiResponse({ status: 200, description: 'Fechamento capturado por marca' })
  @ApiResponse({ status: 400, description: 'Formato de data inválido' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  refreshTrio(@AuthToken() authorization: string, @Query() query: CashBalanceQueryDto) {
    return this.readService.trioBalances(authorization, query.date);
  }

  @Post(':brand/banks/:bank/confirm')
  @HttpCode(204)
  @Permissions(FINANCE_CASH_BALANCE.BANKS_CONFIRM)
  @ApiOperation({ summary: 'Confirma o saldo de um banco manual da marca' })
  @ApiResponse({ status: 204, description: 'Confirmado' })
  @ApiResponse({ status: 400, description: 'Corpo inválido, marca inexistente ou banco Trio' })
  @ApiResponse({ status: 403, description: 'Usuário sem vínculo com a marca' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  async confirmBank(
    @AuthToken() authorization: string,
    @CurrentUser() user: JwtPayload,
    @Param('brand') brand: string,
    @Param('bank') bank: string,
    @Body() dto: ConfirmBankDto,
  ): Promise<void> {
    await this.registryService.confirm({
      authorization,
      brandParam: brand,
      bank,
      balance: dto.balance,
      date: dto.date,
      userId: user.sub,
    });
  }

  @Post(':brand/register')
  @Permissions(FINANCE_CASH_BALANCE.REGISTER_CREATE)
  @ApiOperation({ summary: 'Botão OK da marca — grava o balanço do dia+marca' })
  @ApiResponse({ status: 201, description: 'Balanço registrado' })
  @ApiResponse({
    status: 400,
    description: 'Corpo com campo extra, marca inexistente ou bancos pendentes',
  })
  @ApiResponse({ status: 403, description: 'Usuário sem vínculo com a marca' })
  @ApiResponse({
    status: 503,
    description: 'Trio não capturada, jogadores indisponível ou /auth/me fora',
  })
  register(
    @AuthToken() authorization: string,
    @CurrentUser() user: JwtPayload,
    @Param('brand') brand: string,
    @Body() dto: RegisterBrandDto,
  ) {
    return this.registryService.register({
      authorization,
      brandParam: brand,
      date: dto.date,
      userId: user.sub,
    });
  }

  @Post(':brand/reopen')
  @HttpCode(204)
  @Permissions(FINANCE_CASH_BALANCE.REGISTER_CREATE)
  @ApiOperation({ summary: 'Reabre a marca para nova edição' })
  @ApiResponse({ status: 204, description: 'Reaberto' })
  @ApiResponse({ status: 403, description: 'Usuário sem vínculo com a marca' })
  @ApiResponse({ status: 404, description: 'Não há balanço registrado para esta marca na data' })
  async reopen(
    @AuthToken() authorization: string,
    @Param('brand') brand: string,
    @Body() dto: CashBalanceQueryDto,
  ): Promise<void> {
    await this.registryService.reopen({ authorization, brandParam: brand, date: dto.date });
  }
}
