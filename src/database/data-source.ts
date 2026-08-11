import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

/**
 * DataSource usado exclusivamente pela CLI do TypeORM (migrations):
 *   npm run migration:generate / migration:run / migration:revert
 * A aplicação NÃO usa este arquivo — a conexão dela vem do DatabaseModule.
 */
config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
});
