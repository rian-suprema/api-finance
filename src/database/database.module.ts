import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { databaseConfig } from '../config/configuration';

/**
 * Conexão com o RDS Aurora PostgreSQL via TypeORM (@nestjs/typeorm, integração
 * first-party do NestJS).
 *
 * Decisões importantes:
 * - `synchronize: false` SEMPRE — schema evolui exclusivamente por migrations
 *   versionadas (npm run migration:run). `synchronize: true` em produção pode
 *   destruir dados.
 * - `autoLoadEntities: true` — cada módulo registra suas entidades via
 *   TypeOrmModule.forFeature(); nada de lista central para esquecer de atualizar.
 * - Aurora: aponte DB_HOST para o endpoint do WRITER do cluster. Para réplicas
 *   de leitura, o TypeORM suporta `replication: { master, slaves }`.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.database,
        // Aurora exige TLS em trânsito (DB_SSL=true). Para validação estrita do
        // certificado, distribua o bundle CA da RDS na imagem e configure:
        //   ssl: { ca: readFileSync('/etc/ssl/rds-global-bundle.pem') }
        ssl: db.ssl ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: false,
        logging: ['error', 'warn'],
      }),
    }),
  ],
})
export class DatabaseModule {}
