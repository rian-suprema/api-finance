import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Repository } from 'typeorm';

import type { JwtPayload } from '../../../auth/jwt-payload.interface';
import { FinanceAuditLog } from '../entities/finance-audit-log.entity';

const MUTATION_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

const METHOD_ACTIONS: Record<string, string> = {
  POST: 'CREATE',
  PATCH: 'UPDATE',
  PUT: 'UPDATE',
  DELETE: 'DELETE',
};

// 'resolve'/'apply' são das rotas de mutação da Conciliação (Fase 13/14, que
// reusa este interceptor via export do TypeOrmModule — CLAUDE.md decisão 10);
// sem eles, o rótulo caía no genérico 'CREATE' do método HTTP, perdendo o
// sentido semântico exatamente nas 2 escritas mais relevantes para auditoria
// financeira do módulo (achado do /code-review da Fase 17).
const NAMED_ACTIONS = new Set(['register', 'confirm', 'reopen', 'close', 'resolve', 'apply']);

/** `finance_audit_logs.user_agent` é `varchar(255)` — Postgres rejeita em vez de truncar. */
const USER_AGENT_MAX_LENGTH = 255;

/**
 * Audita mutações autenticadas em `finance_audit_logs` (DADOS-FINANCE.md §5).
 * Fire-and-forget: falha de auditoria nunca afeta a resposta. `entity` é o
 * primeiro segmento da URL de negócio (sem o prefixo da API); `action` é o
 * último segmento quando é um dos 4 nomeados (`register`/`confirm`/`reopen`/
 * `close`), senão o método HTTP mapeado. Aplicado por controller via
 * `@UseInterceptors(AuditInterceptor)` — não é global no `main.ts`, porque a
 * tabela é exclusiva do Finance, não do archetype inteiro.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly prefixPath: string;

  constructor(
    @InjectRepository(FinanceAuditLog) private readonly repository: Repository<FinanceAuditLog>,
    config: ConfigService,
  ) {
    this.prefixPath = `/${config.getOrThrow<string>('app.apiPrefix')}`;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;

    if (!MUTATION_METHODS.includes(req.method) || !user) {
      return next.handle();
    }

    const { entity, action } = this.parseUrl(req.originalUrl ?? req.url, req.method);

    return next.handle().pipe(
      tap((responseBody) => {
        void this.repository
          .insert({
            userId: user.sub,
            tenantId: user.tenantId ?? null,
            action,
            entity,
            // `after` é jsonb/`unknown` na entidade — TypeORM não infere um tipo
            // parcial útil para `unknown`, então o valor é passado como está.
            after: (responseBody === undefined ? null : responseBody) as never,
            ip: req.ip ?? null,
            userAgent: req.headers['user-agent']?.slice(0, USER_AGENT_MAX_LENGTH),
          })
          .catch(() => {
            // Falha de auditoria é silenciada de propósito — nunca afeta a resposta.
          });
      }),
    );
  }

  private parseUrl(rawUrl: string, method: string): { entity: string; action: string } {
    const withoutQuery = rawUrl.split('?')[0] ?? rawUrl;
    const withoutPrefix = withoutQuery.startsWith(this.prefixPath)
      ? withoutQuery.slice(this.prefixPath.length)
      : withoutQuery;
    const parts = withoutPrefix.replace(/^\//, '').split('/').filter(Boolean);

    const entity = parts[0] ?? 'unknown';
    const last = parts[parts.length - 1] ?? '';
    const action = NAMED_ACTIONS.has(last)
      ? last.toUpperCase()
      : (METHOD_ACTIONS[method] ?? method);

    return { entity, action };
  }
}
