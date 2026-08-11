import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

/**
 * Health checks (@nestjs/terminus) — parte do ESQUELETO do archetype:
 * o Helm chart da fase de CD aponta liveness/readiness para cá.
 * O DataSource vem do TypeORM (DatabaseModule).
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
