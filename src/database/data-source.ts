import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

/**
 * DataSource usado exclusivamente pela CLI do TypeORM (migrations):
 *   npm run migration:generate / migration:run / migration:revert
 * A aplicação NÃO usa este arquivo — a conexão dela vem do DatabaseModule.
 *
 * Também é o DataSource do Job de migrations no cluster, pelo compilado:
 *   node dist/database/migration-runner.js
 *
 * Migrations rodam como o role de MIGRAÇÃO/OWNER (DB_MIGRATION_USERNAME), que
 * cria o schema e concede DML ao runtime; a aplicação conecta como o role de
 * RUNTIME (DB_USERNAME), não-owner. Se as vars de migração não existirem, cai
 * nas de runtime — o fluxo simples de dev (usuário único) segue funcionando.
 */
config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_MIGRATION_USERNAME ?? process.env.DB_USERNAME,
  password: process.env.DB_MIGRATION_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Globs relativos a __dirname e aceitando {.ts,.js} DE PROPÓSITO: a CLI roda
  // sobre src/ (ts-node), mas o Job PreSync no cluster roda o COMPILADO em
  // dist/ (node puro — a imagem não tem npm/src). Glob fixo em 'src/*.ts'
  // encontra ZERO migrations no container e o Job "passa" sem migrar nada —
  // defeito capturado pela POC de CI/CD no archetype. Guardado pelo job
  // `deploy-path` do CI.
  entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
});
