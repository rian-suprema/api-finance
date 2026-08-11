import * as Joi from 'joi';

/**
 * Validação de ambiente (fail-fast): variável obrigatória ausente ou inválida
 * derruba o boot com mensagem clara, em vez de falhar em runtime.
 * Joi é o validador usado na documentação oficial do NestJS (@nestjs/config).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string()
    .pattern(/^[a-z0-9/-]+$/)
    .default('api/v1'),
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),

  // RDS Aurora PostgreSQL
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.boolean().default(false),
});
