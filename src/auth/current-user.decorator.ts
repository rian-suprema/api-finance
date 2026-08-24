import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { JwtPayload } from './jwt-payload.interface';

/**
 * Injeta o payload do JWT validado no handler: `@CurrentUser() user: JwtPayload`.
 * É daqui (e SÓ daqui) que o código de negócio lê `tenantId` — nunca de body,
 * query ou header.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload =>
    ctx.switchToHttp().getRequest<{ user: JwtPayload }>().user,
);
