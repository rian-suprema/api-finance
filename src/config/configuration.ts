import { registerAs } from '@nestjs/config';

/**
 * Configuração tipada por namespace (`registerAs`), padrão da doc do NestJS.
 * Os módulos injetam via `@Inject(xxxConfig.KEY)` + `ConfigType<typeof xxxConfig>`,
 * ganhando autocomplete e checagem de tipos em vez de strings soltas.
 */
export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3005', 10),
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
  audience: process.env.JWT_AUDIENCE ?? 'finance',
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true',
}));

export const clickhouseConfig = registerAs('clickhouse', () => ({
  url: process.env.CLICKHOUSE_URL,
  user: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE ?? 'dw_bet',
}));

export const trioConfig = registerAs('trio', () => ({
  baseUrl: process.env.TRIO_BASE_URL,
  clientId: process.env.TRIO_CLIENT_ID,
  clientSecret: process.env.TRIO_CLIENT_SECRET,
  amountDivisor: parseInt(process.env.TRIO_AMOUNT_DIVISOR ?? '1', 10),
  accountIds: {
    suprema: process.env.TRIO_ACCOUNT_ID_SUPREMA,
    ultra: process.env.TRIO_ACCOUNT_ID_ULTRA,
    maxima: process.env.TRIO_ACCOUNT_ID_MAXIMA,
  },
}));

export const platformConfig = registerAs('platform', () => ({
  apiUrl: process.env.SAYPLUS_API_URL,
}));

export const reconciliationConfig = registerAs('reconciliation', () => ({
  bankKeyField: process.env.RECONCILIATION_BANK_KEY_FIELD ?? 'external_id',
}));
