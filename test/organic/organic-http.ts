import request from 'supertest';

/**
 * A aplicação real do `docker compose --profile full`, porta publicada
 * `3005`, viva num container separado do processo de teste — por isso
 * `supertest` recebe uma URL, não `app.getHttpServer()` como nas suítes
 * `test/*.e2e-spec.ts`. Ver PLANO-TESTES-ORGANICOS-FINANCE.md §3.
 */
export const BASE_URL = process.env.ORGANIC_BASE_URL ?? 'http://localhost:3005';
export const PREFIX = '/api/v1';

export const api = () => request(BASE_URL);

/**
 * Só confere que o servidor responde (qualquer status HTTP) — alguns destes
 * endpoints respondem 4xx de propósito sem os parâmetros certos (ex.:
 * `/banking/virtual_accounts` sem `bank_account_id` → 422). O que importa é
 * a conexão TCP/HTTP ter acontecido, não o código de status.
 */
async function ping(url: string, label: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    throw new Error(`${label} indisponível em ${url} — ver §4.2 do plano de testes orgânicos`, {
      cause: err,
    });
  }
}

/** Confere que o ambiente Docker completo + stubs do host estão de pé antes de rodar qualquer teste. */
export async function ensureOrganicEnvironmentUp(): Promise<void> {
  await ping(`${BASE_URL}/health/readiness`, 'API (readiness)');
  await ping('http://localhost:3100/auth/me', 'stub identidade SayPlus (:3100)');
  await ping('http://localhost:8123/ping', 'stub ClickHouse (:8123)');
  await ping('http://localhost:9001/banking/virtual_accounts', 'stub Trio (:9001)');
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
