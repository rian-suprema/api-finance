import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtPayload } from './jwt-payload.interface';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * 2º guard global (autorização): confere o que a rota EXIGE (@Permissions)
 * contra o que o token CONCEDE (claim `permissions[]`).
 *
 * DENY-BY-DEFAULT (decisão de arquitetura): rota sem @Permissions e sem
 * @Public → 403 sempre. O esquecimento de um dev falha FECHADO, nunca aberto.
 * A regra "pilares de segurança" do architecture.spec.ts pega o mesmo erro
 * em tempo de build — este guard é a autoridade final em runtime.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      throw new ForbiddenException(
        'Rota sem declaração de segurança (@Permissions ou @Public) — negada por padrão',
      );
    }

    const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    const granted = user?.permissions ?? [];
    const missing = required.filter((code) => !granted.includes(code));
    if (missing.length > 0) {
      throw new ForbiddenException(`Permissão insuficiente: requer ${missing.join(', ')}`);
    }
    return true;
  }
}
