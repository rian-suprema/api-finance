import { registerAs } from '@nestjs/config';

/**
 * Configuração tipada por namespace (`registerAs`), padrão da doc do NestJS.
 * Os módulos injetam via `@Inject(xxxConfig.KEY)` + `ConfigType<typeof xxxConfig>`,
 * ganhando autocomplete e checagem de tipos em vez de strings soltas.
 */
export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  // Prefixo da API de negócio. Default do archetype: api/v1.
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  httpRequestTimeoutMs: parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS ?? '30000', 10),
}));

// Consumo da auth SayPlus (validação passiva do JWT — ver src/auth/)
export const authConfig = registerAs('auth', () => ({
  // Caminho da CHAVE PÚBLICA (PEM) da SayPlus. Opcional no boot: ausente ou
  // vazio → app sobe, probes ok, rotas protegidas 401 (fail-closed + alarme)
  publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || undefined,
  issuer: process.env.JWT_ISSUER ?? 'sayplus',
  audience: process.env.JWT_AUDIENCE ?? 'petshop',
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true',
}));
