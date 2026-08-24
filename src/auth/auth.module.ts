import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from './jwt-auth.guard';
import { jwtPublicKeyProvider } from './jwt-public-key.provider';
import { JwtStrategy } from './jwt.strategy';
import { PermissionsGuard } from './permissions.guard';

/**
 * Consumo da auth da plataforma SayPlus — o módulo VALIDA, nunca emite.
 *
 * Guards globais em ordem (a ordem de registro é a ordem de execução):
 *   1. JwtAuthGuard    → quem é?     (JWT RS256 válido, senão 401)
 *   2. PermissionsGuard → o que pode? (@Permissions × claim, senão 403;
 *                          rota sem declaração → 403, deny-by-default)
 *
 * Globais de propósito: valem para toda rota que existir ou vier a existir —
 * módulos de negócio novos nascem fechados sem precisar lembrar de nada.
 */
@Module({
  imports: [PassportModule],
  providers: [
    jwtPublicKeyProvider,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
