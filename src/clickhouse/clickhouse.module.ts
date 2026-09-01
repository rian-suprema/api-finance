import { Global, Module } from '@nestjs/common';

import { ClickHouseService } from './clickhouse.service';

/**
 * Conexão única e global — balanço de caixa e conciliação consultam o mesmo
 * warehouse; um pool por consumidor duplicaria a conexão sem necessidade.
 */
@Global()
@Module({
  providers: [ClickHouseService],
  exports: [ClickHouseService],
})
export class ClickHouseModule {}
