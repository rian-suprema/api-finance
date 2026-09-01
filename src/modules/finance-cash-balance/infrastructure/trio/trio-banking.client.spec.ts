import axios from 'axios';

import { TrioBankingClient } from './trio-banking.client';

jest.mock('axios');

interface HttpGetMock {
  get: jest.Mock;
}

interface TrioConfigShape {
  baseUrl: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  amountDivisor: number;
  accountIds: { suprema: string; ultra: string; maxima: string };
}

describe('TrioBankingClient', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const mockedCreate = jest.spyOn(axios, 'create');

  const buildConfig = (overrides: Partial<TrioConfigShape> = {}): TrioConfigShape => ({
    baseUrl: 'https://trio.example.com',
    clientId: 'client-id-secreto',
    clientSecret: 'client-secret-secreto',
    amountDivisor: 1,
    accountIds: { suprema: 'acc-suprema', ultra: 'acc-ultra', maxima: 'acc-maxima' },
    ...overrides,
  });

  const buildHttpMock = (): HttpGetMock => ({ get: jest.fn() });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('toCurrency', () => {
    it('usa trioConfig.amountDivisor, nunca um valor fixo — divisor 100 (centavos)', () => {
      const httpMock = buildHttpMock();
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig({ amountDivisor: 100 }));

      expect(client.toCurrency(250)).toBe(2.5);
    });

    it('usa trioConfig.amountDivisor, nunca um valor fixo — divisor 1 (reais)', () => {
      const httpMock = buildHttpMock();
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig({ amountDivisor: 1 }));

      expect(client.toCurrency(250)).toBe(250);
    });
  });

  describe('findTransactionalVirtualAccount', () => {
    it('devolve a conta quando exatamente 1 está approved', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({
        data: {
          data: [{ id: 'va-1', status: 'approved', number: '123', description: 'Transacional' }],
        },
      });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      const account = await client.findTransactionalVirtualAccount('bank-1');

      expect(account).toEqual({ id: 'va-1', number: '123', description: 'Transacional' });
    });

    it('lança erro quando nenhuma conta está approved', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({ data: { data: [{ id: 'va-1', status: 'pending' }] } });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.findTransactionalVirtualAccount('bank-1')).rejects.toThrow(
        'nenhuma conta virtual aprovada',
      );
    });

    it('lança erro quando mais de 1 aprovada — nunca escolhe, desempate não definido', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({
        data: {
          data: [
            { id: 'va-1', status: 'approved', number: '1', description: 'A' },
            { id: 'va-2', status: 'approved', number: '2', description: 'B' },
          ],
        },
      });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.findTransactionalVirtualAccount('bank-1')).rejects.toThrow(
        'desempate não definido',
      );
    });
  });

  describe('readBalanceAtCents', () => {
    it('lança erro quando a resposta não tem available_balance.amount', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({ data: { data: {} } });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.readBalanceAtCents('va-1', new Date())).rejects.toThrow(
        'sem available_balance.amount',
      );
    });

    it('lança erro quando amount não é numérico', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({ data: { data: { available_balance: { amount: 'abc' } } } });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.readBalanceAtCents('va-1', new Date())).rejects.toThrow('ilegível');
    });

    it('aceita amount numérico e converte', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({ data: { data: { available_balance: { amount: 12345 } } } });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.readBalanceAtCents('va-1', new Date())).resolves.toBe(12345);
    });

    it('aceita amount como string numérica e converte', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({
        data: { data: { available_balance: { amount: '12345' } } },
      });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.readBalanceAtCents('va-1', new Date())).resolves.toBe(12345);
    });
  });

  describe('listTransactions — bisseção', () => {
    it('janela sem has_more: uma única chamada, todas as linhas retornadas', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({
        data: {
          data: [{ amount: { amount: 10 } }, { amount: { amount: -5 } }],
          metadata: { has_more: false },
        },
      });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      const rows = await client.listTransactions(
        'acc-1',
        new Date('2026-08-15T00:00:00.000Z'),
        new Date('2026-08-15T01:00:00.000Z'),
      );

      expect(httpMock.get).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(2);
    });

    it('bisseção — janela com has_more: divide sem overlap e sem buraco (regressão do bug de cursor)', async () => {
      const httpMock = buildHttpMock();
      // 1ª chamada: janela cheia, precisa dividir.
      httpMock.get.mockResolvedValueOnce({ data: { data: [], metadata: { has_more: true } } });
      // 2ª chamada (metade esquerda, popada primeiro por ser LIFO): 1 linha exatamente no limite.
      httpMock.get.mockResolvedValueOnce({
        data: {
          data: [{ amount: { amount: 745 }, end_to_end_id: 'lancamento-no-limite' }],
          metadata: { has_more: false },
        },
      });
      // 3ª chamada (metade direita, começa 1µs depois — sem overlap, sem buraco): a tarifa do par.
      httpMock.get.mockResolvedValueOnce({
        data: {
          data: [{ amount: { amount: 745 }, end_to_end_id: 'tarifa-no-limite' }],
          metadata: { has_more: false },
        },
      });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      const rows = await client.listTransactions(
        'acc-1',
        new Date('2026-08-15T00:00:00.000Z'),
        new Date('2026-08-15T10:00:00.000Z'),
      );

      expect(httpMock.get).toHaveBeenCalledTimes(3);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.end_to_end_id)).toEqual(
        expect.arrayContaining(['lancamento-no-limite', 'tarifa-no-limite']),
      );

      const [, leftCall, rightCall] = httpMock.get.mock.calls as Array<
        [string, { params: { from_datetime: string; to_datetime: string } }]
      >;
      // Sem overlap e sem buraco: o fim da metade esquerda é exatamente 1µs antes do início da direita.
      expect(leftCall[1].params.to_datetime < rightCall[1].params.from_datetime).toBe(true);
    });

    it('bisseção — has_more no mesmo microssegundo lança erro em vez de repetir infinitamente', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockResolvedValue({ data: { data: [], metadata: { has_more: true } } });
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(
        client.listTransactions(
          'acc-1',
          new Date('2026-08-15T00:00:00.000Z'),
          new Date('2026-08-15T00:00:00.001Z'),
        ),
      ).rejects.toThrow('janela indivisível');
    });

    it('orçamento de requisições: ultrapassar REQUEST_BUDGET lança erro em vez de rodar para sempre', async () => {
      const httpMock = buildHttpMock();
      httpMock.get.mockImplementation(
        (_path: string, config: { params: { from_datetime: string; to_datetime: string } }) => {
          const hasMore = config.params.to_datetime > config.params.from_datetime;
          return Promise.resolve({
            data: {
              data: hasMore ? [] : [{ amount: { amount: 1 } }],
              metadata: { has_more: hasMore },
            },
          });
        },
      );
      mockedCreate.mockReturnValue(httpMock as never);
      const client = new TrioBankingClient(buildConfig());

      await expect(
        client.listTransactions(
          'acc-1',
          new Date('2026-08-15T00:00:00.000Z'),
          new Date('2026-08-15T00:00:00.050Z'),
        ),
      ).rejects.toThrow(/20.000|20000|requisições/);
    }, 15000);
  });

  describe('retry', () => {
    it('erro 429 tenta novamente e eventualmente resolve', async () => {
      jest.useFakeTimers();
      const httpMock = buildHttpMock();
      const rateLimitError = { response: { status: 429 } };
      httpMock.get
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ data: { data: { available_balance: { amount: 999 } } } });
      mockedCreate.mockReturnValue(httpMock as never);
      mockedAxios.isAxiosError.mockReturnValue(true);
      const client = new TrioBankingClient(buildConfig());

      const promise = client.readBalanceAtCents('va-1', new Date());
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(promise).resolves.toBe(999);
      expect(httpMock.get).toHaveBeenCalledTimes(3);
    });

    it('erro 5xx tenta novamente', async () => {
      jest.useFakeTimers();
      const httpMock = buildHttpMock();
      const serverError = { response: { status: 503 } };
      httpMock.get
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: { data: { available_balance: { amount: 1 } } } });
      mockedCreate.mockReturnValue(httpMock as never);
      mockedAxios.isAxiosError.mockReturnValue(true);
      const client = new TrioBankingClient(buildConfig());

      const promise = client.readBalanceAtCents('va-1', new Date());
      await jest.advanceTimersByTimeAsync(10_000);

      await expect(promise).resolves.toBe(1);
      expect(httpMock.get).toHaveBeenCalledTimes(2);
    });

    it('erro 4xx diferente de 429 não tenta de novo — é erro de contrato', async () => {
      const httpMock = buildHttpMock();
      const contractError = { response: { status: 404 } };
      httpMock.get.mockRejectedValue(contractError);
      mockedCreate.mockReturnValue(httpMock as never);
      mockedAxios.isAxiosError.mockReturnValue(true);
      const client = new TrioBankingClient(buildConfig());

      await expect(client.readBalanceAtCents('va-1', new Date())).rejects.toThrow('404');
      expect(httpMock.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('credenciais nunca em log', () => {
    it('falha de autenticação (401) não expõe clientId/clientSecret na mensagem lançada', async () => {
      const httpMock = buildHttpMock();
      const authError = { response: { status: 401 } };
      httpMock.get.mockRejectedValue(authError);
      mockedCreate.mockReturnValue(httpMock as never);
      mockedAxios.isAxiosError.mockReturnValue(true);
      const config = buildConfig();
      const client = new TrioBankingClient(config);

      await expect(client.readBalanceAtCents('va-1', new Date())).rejects.toThrow('401');

      let thrownMessage = '';
      try {
        await client.readBalanceAtCents('va-1', new Date());
      } catch (error) {
        thrownMessage = (error as Error).message;
      }

      expect(thrownMessage).not.toContain(config.clientId as string);
      expect(thrownMessage).not.toContain(config.clientSecret as string);
    });
  });

  describe('isConfigured', () => {
    it('false quando credenciais estão ausentes — nunca cria o client axios', () => {
      const client = new TrioBankingClient(
        buildConfig({ baseUrl: undefined, clientId: undefined, clientSecret: undefined }),
      );

      expect(client.isConfigured).toBe(false);
      expect(mockedCreate).not.toHaveBeenCalled();
    });
  });
});
