import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { JwtPayload } from './jwt-payload.interface';
import { PermissionsGuard } from './permissions.guard';

/**
 * O contrato central do guard é o DENY-BY-DEFAULT: rota sem declaração de
 * segurança falha FECHADA. Estes testes fixam esse comportamento — se alguém
 * "relaxar" o guard no futuro, este spec quebra antes do CI.
 */
describe('PermissionsGuard (deny-by-default)', () => {
  const contextFor = (user?: Partial<JwtPayload>): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  /** Simula os metadados da rota: [resultado de @Public, resultado de @Permissions]. */
  const guardFor = (isPublic: boolean | undefined, permissions: string[] | undefined) => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(isPublic).mockReturnValueOnce(permissions),
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  };

  it('rota @Public passa sem token', () => {
    expect(guardFor(true, undefined).canActivate(contextFor())).toBe(true);
  });

  it('rota SEM @Permissions e SEM @Public → 403 (deny-by-default)', () => {
    const guard = guardFor(undefined, undefined);
    expect(() => guard.canActivate(contextFor({ permissions: ['petshop.users.read'] }))).toThrow(
      ForbiddenException,
    );
  });

  it('token sem o code exigido → 403 apontando o que falta', () => {
    const guard = guardFor(undefined, ['petshop.users.delete']);
    expect(() => guard.canActivate(contextFor({ permissions: ['petshop.users.read'] }))).toThrow(
      /petshop\.users\.delete/,
    );
  });

  it('token com o code exigido passa', () => {
    const guard = guardFor(undefined, ['petshop.users.read']);
    expect(guard.canActivate(contextFor({ permissions: ['petshop.users.read'] }))).toBe(true);
  });

  it('request sem user (defensivo) → 403, nunca aberto', () => {
    const guard = guardFor(undefined, ['petshop.users.read']);
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
