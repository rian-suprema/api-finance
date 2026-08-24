import * as Joi from 'joi';

/**
 * Validação de ambiente (fail-fast): variável obrigatória ausente ou inválida
 * derruba o boot com mensagem clara, em vez de falhar em runtime.
 * Joi é o validador usado na documentação oficial do NestJS (@nestjs/config).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3005),
  API_PREFIX: Joi.string()
    .pattern(/^[a-z0-9/-]+$/)
    .default('api/v1'),
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  // Pretty-print de logs SÓ no host de dev (pino-pretty é devDependency —
  // não existe na imagem de produção; ligar lá derruba o boot)
  LOG_PRETTY: Joi.boolean().default(false),

  // Observabilidade (OpenTelemetry) — TODAS opcionais: sem endpoint, o SDK
  // nem inicia (interruptor fail-safe em src/telemetry/otel.ts).
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional(),
  OTEL_SERVICE_NAME: Joi.string().optional(),

  // Auth SayPlus (JWT RS256, validação passiva — só a chave PÚBLICA).
  // JWT_PUBLIC_KEY_PATH é opcional de propósito: ausente, o app sobe e as
  // rotas protegidas respondem 401 (fail-closed) — decisão registrada.
  // allow(''): values do Helm renderizam string vazia — vazio = ausente,
  // nunca boot derrubado (defeito real pego na demo do Step 1).
  JWT_PUBLIC_KEY_PATH: Joi.string().allow('').optional(),
  JWT_ISSUER: Joi.string().default('sayplus'),
  JWT_AUDIENCE: Joi.string().default('petshop'),

  // RDS Aurora PostgreSQL
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.boolean().default(false),

  // Separação de papéis da RLS (Step 5). Opcionais: ausentes, migrations e app
  // usam o mesmo DB_USERNAME (fluxo simples de dev, sem RLS efetiva).
  //   • DB_MIGRATION_USERNAME/PASSWORD → role OWNER que roda migrations;
  //   • DB_APP_ROLE → nome do role de RUNTIME, p/ a migration conceder os grants.
  DB_MIGRATION_USERNAME: Joi.string().optional(),
  DB_MIGRATION_PASSWORD: Joi.string().optional(),
  DB_APP_ROLE: Joi.string().optional(),
});
