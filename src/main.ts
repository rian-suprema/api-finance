// PRIMEIRO import de todos: a auto-instrumentação do OTel precisa aplicar os
// patches antes de http/express/pg serem carregados por qualquer módulo.
import './telemetry/otel';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // bufferLogs: nada é perdido entre o create e o useLogger abaixo
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Todo Logger do Nest passa a emitir JSON estruturado (pino) — com
  // trace_id/span_id injetados automaticamente quando o OTel está ligado.
  app.useLogger(app.get(PinoLogger));
  const config = app.get(ConfigService);

  // Prefixo da API de negócio (API_PREFIX; default do archetype: api/v1).
  // As probes de saúde ficam FORA do prefixo: /health/* é contrato com o
  // orquestrador e não muda quando a API for versionada.
  app.setGlobalPrefix(config.getOrThrow<string>('app.apiPrefix'), {
    exclude: ['health/liveness', 'health/readiness'],
  });

  // Garante que onModuleDestroy/onApplicationShutdown rodem em SIGTERM
  // (fechamento das conexões do TypeORM)
  app.enableShutdownHooks();

  // Contrato code-first: o OpenAPI publicado é derivado dos controllers/DTOs,
  // portanto nunca diverge do código. Disponível em /docs (+ /docs-json).
  const documentBuilder = new DocumentBuilder()
    .setTitle('Users API')
    .setDescription(
      'Exemplo simples construído a partir do Archetype Backend NestJS (SUPREMA) — sem cache e sem mensageria',
    )
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, documentBuilder));

  const port = config.getOrThrow<number>('app.port');
  const prefix = config.getOrThrow<string>('app.apiPrefix');
  await app.listen(port);
  Logger.log(`API no ar em http://localhost:${port}/${prefix} (Swagger UI: /docs)`, 'Bootstrap');
}

void bootstrap();
