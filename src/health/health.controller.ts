import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/public.decorator';

/**
 * Probes de saúde — contrato do archetype com o orquestrador (K8s):
 *
 * - `/health/liveness`: "o processo responde?" — SEM dependências externas.
 *   Se dependência entra aqui, indisponibilidade dela derruba o pod em
 *   restart-loop sem culpa dele.
 * - `/health/readiness`: "posso receber tráfego?" — verifica as dependências
 *   ESTRUTURAIS deste archetype. Nesta variante simples: PostgreSQL (TypeORM).
 *
 * As rotas ficam FORA do prefixo da API (ver main.ts): probe é contrato de
 * infraestrutura, não endpoint de negócio versionado.
 *
 * @Public: o kubelet não envia JWT — probe autenticado derrubaria o pod.
 * É o ÚNICO uso legítimo previsto do decorator neste archetype.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get('liveness')
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('readiness')
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.db.pingCheck('database', { timeout: 1_500 })]);
  }
}
