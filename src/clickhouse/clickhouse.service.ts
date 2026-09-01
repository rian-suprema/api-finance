import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

import { clickhouseConfig } from '../config/configuration';

/**
 * Conexão única com o data warehouse.
 *
 * Duas telas leem do ClickHouse (balanço e conciliação) e cada uma tem o seu
 * serviço de consulta; a conexão é a mesma para as duas, senão o processo abre
 * um pool por consumidor.
 *
 * Regras que valem para qualquer query montada sobre este serviço:
 * - datas, marcas e listas dinâmicas sempre via `query_params`, nunca
 *   interpoladas na string da query;
 * - `client === null` só é alcançável em teste unitário com `clickhouseConfig`
 *   mockado — em boot real `CLICKHOUSE_URL` é obrigatório no Joi (fail-fast),
 *   então este caminho nunca ocorre em produção.
 */
@Injectable()
export class ClickHouseService implements OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseService.name);
  private readonly client: ClickHouseClient | null;

  constructor(
    @Inject(clickhouseConfig.KEY)
    config: ConfigType<typeof clickhouseConfig>,
  ) {
    if (!config.url) {
      this.client = null;
      this.logger.warn('CLICKHOUSE_URL não configurada — leituras do warehouse indisponíveis');
      return;
    }

    this.client = createClient({
      url: config.url,
      username: config.user,
      password: config.password,
      database: config.database,
    });
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * `params` aceita array para os filtros `IN ({x:Array(String)})` — o cliente
   * do ClickHouse serializa a lista, então continua não havendo interpolação
   * de valor na string da query.
   */
  async query<T>(query: string, params: Record<string, string | readonly string[]>): Promise<T[]> {
    if (!this.client) {
      throw new ServiceUnavailableException('Integração com o data warehouse não configurada');
    }

    try {
      const result = await this.client.query({
        query,
        query_params: params,
        format: 'JSONEachRow',
      });
      return await result.json<T>();
    } catch (error) {
      this.logger.error(`Falha ao consultar ClickHouse: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Data warehouse indisponível');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }
}
