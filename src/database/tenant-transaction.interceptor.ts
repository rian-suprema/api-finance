import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { firstValueFrom, from, Observable } from 'rxjs';
import { DataSource } from 'typeorm';

import { JwtPayload } from '../auth/jwt-payload.interface';
import { runInTenantContext } from './tenant-context';

/**
 * Abre a transação-por-requisição que carrega o GUC de tenant da RLS (Step 5).
 *
 * Roda DEPOIS dos guards (o `request.user` já existe). Requisições sem tenant
 * — rotas @Public como os health probes — passam direto, sem transação. As
 * demais executam o handler inteiro dentro de runInTenantContext: todas as
 * queries feitas via tenantManager() enxergam `app.tenant_id`, e a RLS as
 * confina ao tenant do claim.
 *
 * Registrado como APP_INTERCEPTOR mais interno (último), para envolver o
 * handler — a serialização (@Exclude) acontece depois, sobre objetos já lidos.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const tenantId = request.user?.tenantId;
    if (!tenantId) {
      return next.handle();
    }
    return from(
      // Consome o Observable do handler DENTRO do contexto do tenant
      runInTenantContext(this.dataSource, tenantId, () => firstValueFrom(next.handle())),
    );
  }
}
