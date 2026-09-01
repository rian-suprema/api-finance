import { ServiceUnavailableException } from '@nestjs/common';
import { createClient } from '@clickhouse/client';

import { ClickHouseService } from './clickhouse.service';

jest.mock('@clickhouse/client');

interface QueryCallArgs {
  query: string;
  query_params: Record<string, string | readonly string[]>;
  format: string;
}

describe('ClickHouseService', () => {
  const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

  const buildClientMock = () => ({
    query: jest.fn<Promise<unknown>, [QueryCallArgs]>(),
    close: jest.fn().mockResolvedValue(undefined),
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('reflete a config: true quando CLICKHOUSE_URL está presente', () => {
      mockedCreateClient.mockReturnValue(buildClientMock() as never);

      const service = new ClickHouseService({
        url: 'https://clickhouse.local:8123',
        user: 'default',
        password: 'secret',
        database: 'dw_bet',
      });

      expect(service.isConfigured).toBe(true);
    });

    it('reflete a config: false quando CLICKHOUSE_URL está ausente', () => {
      const service = new ClickHouseService({
        url: undefined,
        user: undefined,
        password: undefined,
        database: 'dw_bet',
      });

      expect(service.isConfigured).toBe(false);
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });
  });

  describe('query', () => {
    it('usa query_params nomeados, nunca interpola valor dinâmico na string', async () => {
      const clientMock = buildClientMock();
      clientMock.query.mockResolvedValue({ json: jest.fn().mockResolvedValue([{ total: 1 }]) });
      mockedCreateClient.mockReturnValue(clientMock as never);

      const service = new ClickHouseService({
        url: 'https://clickhouse.local:8123',
        user: 'default',
        password: 'secret',
        database: 'dw_bet',
      });

      const referenceDate = '2026-08-15';
      await service.query(
        'SELECT total FROM dw_bet.mart WHERE reference_date = {referenceDate:Date}',
        {
          referenceDate,
        },
      );

      expect(clientMock.query).toHaveBeenCalledTimes(1);
      const callArgs = clientMock.query.mock.calls[0][0];
      expect(callArgs.query).toBe(
        'SELECT total FROM dw_bet.mart WHERE reference_date = {referenceDate:Date}',
      );
      expect(callArgs.query).not.toContain(referenceDate);
      expect(callArgs.query_params).toEqual({ referenceDate });
    });

    it('aceita array em query_params (filtro IN) sem erro de tipo', async () => {
      const clientMock = buildClientMock();
      clientMock.query.mockResolvedValue({ json: jest.fn().mockResolvedValue([]) });
      mockedCreateClient.mockReturnValue(clientMock as never);

      const service = new ClickHouseService({
        url: 'https://clickhouse.local:8123',
        user: 'default',
        password: 'secret',
        database: 'dw_bet',
      });

      const documents: readonly string[] = ['12345678900', '98765432100'];
      await service.query(
        'SELECT 1 FROM dw_bet.mart WHERE document IN ({documents:Array(String)})',
        {
          documents,
        },
      );

      const callArgs = clientMock.query.mock.calls[0][0];
      expect(callArgs.query_params).toEqual({ documents });
    });

    it('propaga falha do driver como ServiceUnavailableException, nunca o erro cru', async () => {
      const clientMock = buildClientMock();
      clientMock.query.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8123'));
      mockedCreateClient.mockReturnValue(clientMock as never);

      const service = new ClickHouseService({
        url: 'https://clickhouse.local:8123',
        user: 'default',
        password: 'secret',
        database: 'dw_bet',
      });

      await expect(service.query('SELECT 1', {})).rejects.toThrow(ServiceUnavailableException);
      await expect(service.query('SELECT 1', {})).rejects.toThrow('Data warehouse indisponível');
    });

    it('lança ServiceUnavailableException quando não configurado', async () => {
      const service = new ClickHouseService({
        url: undefined,
        user: undefined,
        password: undefined,
        database: 'dw_bet',
      });

      await expect(service.query('SELECT 1', {})).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('onModuleDestroy', () => {
    it('fecha a conexão do client', async () => {
      const clientMock = buildClientMock();
      mockedCreateClient.mockReturnValue(clientMock as never);

      const service = new ClickHouseService({
        url: 'https://clickhouse.local:8123',
        user: 'default',
        password: 'secret',
        database: 'dw_bet',
      });

      await service.onModuleDestroy();

      expect(clientMock.close).toHaveBeenCalledTimes(1);
    });

    it('não lança quando o client nunca foi criado', async () => {
      const service = new ClickHouseService({
        url: undefined,
        user: undefined,
        password: undefined,
        database: 'dw_bet',
      });

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
