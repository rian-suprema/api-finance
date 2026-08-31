import { envValidationSchema } from './env.validation';

/**
 * As 14 variáveis novas do Finance (Fase 03) — nenhuma delas tem default de
 * valor perigoso: `TRIO_AMOUNT_DIVISOR` é o caso extremo (1 = reais, 100 =
 * centavos, ver `docs/migracao-finance/INFRA-FINANCE.md` §4.2).
 */
const VALID_ENV = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_USERNAME: 'test',
  DB_PASSWORD: 'test',
  DB_NAME: 'test',
  CLICKHOUSE_URL: 'http://localhost:8123',
  CLICKHOUSE_USER: 'default',
  CLICKHOUSE_PASSWORD: 'default',
  TRIO_BASE_URL: 'http://localhost:9001',
  TRIO_CLIENT_ID: 'dev',
  TRIO_CLIENT_SECRET: 'dev',
  TRIO_AMOUNT_DIVISOR: '1',
  TRIO_ACCOUNT_ID_SUPREMA: 'acc-suprema',
  TRIO_ACCOUNT_ID_ULTRA: 'acc-ultra',
  TRIO_ACCOUNT_ID_MAXIMA: 'acc-maxima',
  SAYPLUS_API_URL: 'http://localhost:3100',
};

describe('envValidationSchema — variáveis do Finance', () => {
  it('boot passa com as 14 variáveis novas preenchidas', () => {
    const { error } = envValidationSchema.validate(VALID_ENV, { abortEarly: false });
    expect(error).toBeUndefined();
  });

  it('boot falha (fail-fast) sem TRIO_AMOUNT_DIVISOR — nunca assume 1 silenciosamente', () => {
    const withoutDivisor: Partial<typeof VALID_ENV> = { ...VALID_ENV };
    delete withoutDivisor.TRIO_AMOUNT_DIVISOR;
    const { error } = envValidationSchema.validate(withoutDivisor, { abortEarly: false });
    expect(error?.message).toContain('TRIO_AMOUNT_DIVISOR');
  });

  it('boot falha com TRIO_AMOUNT_DIVISOR fora de {1, 100}', () => {
    const { error } = envValidationSchema.validate(
      { ...VALID_ENV, TRIO_AMOUNT_DIVISOR: '50' },
      { abortEarly: false },
    );
    expect(error?.message).toContain('TRIO_AMOUNT_DIVISOR');
  });
});
