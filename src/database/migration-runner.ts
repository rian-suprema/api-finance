/**
 * Entrypoint de migrations executável por node puro (sem toolchain npm):
 *   node dist/database/migration-runner.js
 *
 * Existe porque a imagem de produção (Dockerfile) REMOVE npm/npx/corepack —
 * "npm run migration:run" não existe dentro do container. Este runner é
 * infraestrutura (não domínio): quem o invoca é o Job Helm hook do chart
 * (deploy/helm/api-finance/templates/migrations-job.yaml), sempre ANTES do
 * rollout da aplicação.
 *
 * Contrato de saída (o Job depende disso para backoff/retry):
 *   exit 0 — migrations aplicadas (ou nenhuma pendente);
 *   exit 1 — qualquer falha (conexão, SQL, lock) → o Job tenta de novo
 *            até backoffLimit e, persistindo, bloqueia o deploy.
 *
 * Diferença em relação ao archetype: sem a conferência de cobertura de RLS por
 * tenant — o Finance não usa RLS de tenant (decisão registrada no commit que
 * removeu o boilerplate do exemplo). A separação owner/runtime continua: ver
 * a migration GrantRuntimeRole.
 */
import dataSource from './data-source';

async function run(): Promise<void> {
  console.log('[migration-runner] inicializando DataSource…');
  await dataSource.initialize();
  try {
    const executed = await dataSource.runMigrations({ transaction: 'each' });
    if (executed.length === 0) {
      console.log('[migration-runner] nenhuma migration pendente — schema já atualizado.');
    } else {
      for (const migration of executed) {
        console.log(`[migration-runner] aplicada: ${migration.name}`);
      }
      console.log(`[migration-runner] total aplicadas: ${executed.length}.`);
    }
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[migration-runner] FALHA ao executar migrations:', error);
    process.exit(1);
  });
