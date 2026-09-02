import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AuthToken } from '../../../../auth/auth-token.decorator';
import { CurrentUser } from '../../../../auth/current-user.decorator';
import type { JwtPayload } from '../../../../auth/jwt-payload.interface';
import { FINANCE_RECONCILIATION } from '../../../../auth/permissions.constants';
import { Permissions } from '../../../../auth/permissions.decorator';
import { AuditInterceptor } from '../../../finance-cash-balance/infrastructure/audit.interceptor';
import { ReconciliationService } from '../../domain/services/reconciliation.service';
import {
  ReconciliationHistoryQueryDto,
  ReconciliationQueryDto,
  ResolveItemDto,
  RunReconciliationDto,
} from '../../dto/reconciliation.dto';

@ApiTags('reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
@UseInterceptors(AuditInterceptor)
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get()
  @Permissions(FINANCE_RECONCILIATION.READ)
  @ApiOperation({ summary: 'Resultado já calculado do dia, por marca, com as pendências' })
  @ApiResponse({ status: 200, description: 'Situação de cada marca acessível' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  get(@AuthToken() authorization: string, @Query() query: ReconciliationQueryDto) {
    return this.service.get(authorization, query.date);
  }

  @Get('history')
  @Permissions(FINANCE_RECONCILIATION.READ)
  @ApiOperation({ summary: 'Fechamento de período — todo dia do intervalo, mesmo sem execução' })
  @ApiResponse({ status: 200, description: 'Um dia por linha, com a severidade de cada marca' })
  @ApiResponse({ status: 400, description: 'Formato de data, from > to, ou intervalo > 180 dias' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  history(@AuthToken() authorization: string, @Query() query: ReconciliationHistoryQueryDto) {
    return this.service.history(authorization, query.from, query.to);
  }

  @Post('run')
  @HttpCode(202)
  @Permissions(FINANCE_RECONCILIATION.RUN)
  @ApiOperation({
    summary:
      'Dispara a conciliação de forma assíncrona — a tela acompanha pelo status do GET /reconciliation',
  })
  @ApiResponse({ status: 202, description: 'Disparada; resultado aparece no GET quando terminar' })
  @ApiResponse({ status: 503, description: '/auth/me indisponível' })
  run(@AuthToken() authorization: string, @Body() dto: RunReconciliationDto) {
    return this.service.run(authorization, dto.date);
  }

  @Post('items/:id/resolve')
  @HttpCode(204)
  @Permissions(FINANCE_RECONCILIATION.RESOLVE)
  @ApiOperation({ summary: 'Registra a nota do operador e trata a pendência' })
  @ApiResponse({ status: 204, description: 'Tratada' })
  @ApiResponse({ status: 400, description: 'Nota fora do tamanho permitido' })
  @ApiResponse({ status: 403, description: 'Usuário sem acesso à marca da pendência' })
  @ApiResponse({ status: 404, description: 'Pendência não encontrada' })
  @ApiResponse({ status: 409, description: 'Pendência já tratada' })
  async resolve(
    @AuthToken() authorization: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveItemDto,
  ): Promise<void> {
    await this.service.resolve(authorization, id, dto.note, user.sub);
  }

  @Post('items/:id/reopen')
  @HttpCode(204)
  @Permissions(FINANCE_RECONCILIATION.RESOLVE)
  @ApiOperation({ summary: 'Devolve a pendência para a fila, apagando o tratamento anterior' })
  @ApiResponse({ status: 204, description: 'Reaberta' })
  @ApiResponse({ status: 403, description: 'Usuário sem acesso à marca da pendência' })
  @ApiResponse({ status: 404, description: 'Pendência não encontrada' })
  async reopen(
    @AuthToken() authorization: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.service.reopen(authorization, id);
  }
}
