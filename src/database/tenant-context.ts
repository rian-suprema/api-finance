import { AsyncLocalStorage } from 'node:async_hooks';

import { DataSource, EntityManager } from 'typeorm';

/**
 * Contexto de tenant por unidade de trabalho (Step 5 — GUC da RLS).
 *
 * A RLS do banco corta pelo GUC `app.tenant_id`, que só vale via `SET LOCAL`
 * DENTRO de uma transação. Com pool de conexões, a única forma correta de
 * garantir que TODAS as queries de uma operação vejam o mesmo GUC é rodá-las
 * no MESMO EntityManager transacional — propagado aqui por AsyncLocalStorage
 * (nativo do Node; sem dependência nova, coerente com o archetype).
 *
 * Quem abre o contexto:
 * - requisições HTTP → TenantTransactionInterceptor (tenant do claim JWT);
 * - consumidores de eventos → o próprio consumidor (tenant do evento).
 * Fora de um contexto (migrations, health), cai no manager default.
 */
const storage = new AsyncLocalStorage<EntityManager>();

/**
 * EntityManager a usar nas queries: o transacional do contexto (com o GUC de
 * tenant setado) ou, fora de um contexto, o default do DataSource. Os services
 * resolvem o repositório a partir daqui — nunca de um `Repository` injetado
 * fixo, que ignoraria a transação com o GUC.
 */
export function tenantManager(dataSource: DataSource): EntityManager {
  return storage.getStore() ?? dataSource.manager;
}

/**
 * Executa `work` numa transação com `SET LOCAL app.tenant_id = <tenantId>`,
 * propagando o EntityManager transacional pelo AsyncLocalStorage. Toda query
 * feita via tenantManager() dentro de `work` roda sob esse GUC — a RLS a
 * confina ao tenant.
 */
export async function runInTenantContext<T>(
  dataSource: DataSource,
  tenantId: string,
  work: () => Promise<T>,
): Promise<T> {
  return dataSource.transaction(async (manager) => {
    // set_config(..., true) = SET LOCAL: escopo da transação, sem vazar no pool
    await manager.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return storage.run(manager, work);
  });
}
