import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injeta o header `Authorization` bruto ("Bearer ...") no handler:
 * `@AuthToken() authorization: string`. Usado para repassar o Bearer do
 * próprio usuário a integrações externas que exigem o token literal (ex.:
 * `GET /auth/me` da SayPlus, via `PlatformIdentityService`) — diferente de
 * `@CurrentUser()`, que devolve o payload já decodificado.
 */
export const AuthToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<{ headers: { authorization: string } }>().headers.authorization,
);
