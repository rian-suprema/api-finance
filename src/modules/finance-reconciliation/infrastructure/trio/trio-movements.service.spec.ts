import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';

import type { TrioTransaction } from '../../../finance-cash-balance/infrastructure/trio/trio-banking.client';
import { TrioBankingClient } from '../../../finance-cash-balance/infrastructure/trio/trio-banking.client';
import { TrioMovementsService } from './trio-movements.service';

jest.mock('axios');

interface HttpGetMock {
  get: jest.Mock;
}

describe('TrioMovementsService', () => {
  const buildConfigService = (keyField?: string): ConfigService =>
    ({ get: jest.fn().mockReturnValue(keyField) }) as unknown as ConfigService;

  const buildTrioMock = (transactions: TrioTransaction[]) => ({
    isConfigured: true,
    accountIdFor: jest.fn(),
    // amountDivisor=100 (centavos): toCurrency(cents) devolve reais, e o
    // serviço multiplica de volta por 100 — resultado numérico igual a
    // Math.abs(cents), o que simplifica a asserção nos testes.
    toCurrency: (cents: number) => cents / 100,
    listTransactions: jest.fn().mockResolvedValue(transactions),
  });

  const buildTransaction = (overrides: Partial<TrioTransaction> = {}): TrioTransaction => ({
    amount: { amount: -1000 },
    transaction_type: 'regular',
    ref_id: '01926a3a-0000-7000-8000-000000000001',
    external_id: 'ext-1',
    ...overrides,
  });

  const fetchOne = async (
    trioMock: ReturnType<typeof buildTrioMock>,
    keyField?: string,
  ): Promise<Awaited<ReturnType<TrioMovementsService['fetchMovements']>>> => {
    const service = new TrioMovementsService(trioMock as never, buildConfigService(keyField));
    return service.fetchMovements({
      brand: 'suprema',
      accountId: 'acc-1',
      coreFrom: new Date('2026-08-15T00:00:00.000Z'),
      coreTo: new Date('2026-08-16T00:00:00.000Z'),
    });
  };

  describe('classificação por sinal', () => {
    it('amount < 0 (convenção Trio: negativo entra) → DEPOSIT', async () => {
      const trioMock = buildTrioMock([buildTransaction({ amount: { amount: -500 } })]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].flow).toBe('DEPOSIT');
    });

    it('amount > 0 → WITHDRAWAL', async () => {
      const trioMock = buildTrioMock([buildTransaction({ amount: { amount: 500 } })]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].flow).toBe('WITHDRAWAL');
    });
  });

  describe('tesouraria', () => {
    it('contraparte no CNPJ próprio → TREASURY, independente do sinal (crédito)', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ amount: { amount: -500 }, counterparty_tax_number: '56183358000151' }),
      ]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].flow).toBe('TREASURY');
    });

    it('contraparte no CNPJ próprio → TREASURY, independente do sinal (débito)', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ amount: { amount: 500 }, counterparty_tax_number: '56183358000151' }),
      ]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].flow).toBe('TREASURY');
    });
  });

  describe('estorno herda o fluxo da operação original, não o sinal', () => {
    it('payment_refund (crédito, sinal indicaria DEPOSIT) → WITHDRAWAL — regressão do incidente de 15/08/2026 na Maxima (chave 778446251, R$1.000,00)', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({
          amount: { amount: -100_000 },
          ref_type: 'payment_refund',
          end_to_end_id: '778446251',
        }),
      ]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].flow).toBe('WITHDRAWAL');
    });

    it('collection_refund → DEPOSIT (prefixo collection)', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ amount: { amount: 100_000 }, ref_type: 'collection_refund' }),
      ]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].flow).toBe('DEPOSIT');
    });
  });

  describe('tarifa', () => {
    it("transaction_type = 'fee' não entra em movements[] — soma em fees.total/count, valor absoluto", async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ amount: { amount: 745 }, transaction_type: 'fee' }),
      ]);
      const { movements, fees } = await fetchOne(trioMock);

      expect(movements).toHaveLength(0);
      expect(fees).toEqual({ total: 7.45, count: 1 });
    });
  });

  describe('transaction_type desconhecido', () => {
    it("diferente de 'regular'/'fee' é ignorado — nem movements, nem fees", async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ transaction_type: 'reversal_pending_something_else' }),
      ]);
      const { movements, fees } = await fetchOne(trioMock);

      expect(movements).toHaveLength(0);
      expect(fees).toEqual({ total: 0, count: 0 });
    });
  });

  describe('chave do casamento', () => {
    it('RECONCILIATION_BANK_KEY_FIELD não configurado — usa external_id', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ external_id: 'ext-key', end_to_end_id: 'e2e-key' }),
      ]);
      const { movements } = await fetchOne(trioMock);
      expect(movements[0].externalKey).toBe('ext-key');
    });

    it('valor inválido no config cai para external_id, com log de erro (não derruba o processo)', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({ external_id: 'ext-key', end_to_end_id: 'e2e-key' }),
      ]);
      const configService = buildConfigService('campo_invalido');
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const service = new TrioMovementsService(trioMock as never, configService);

      const { movements } = await service.fetchMovements({
        brand: 'suprema',
        accountId: 'acc-1',
        coreFrom: new Date('2026-08-15T00:00:00.000Z'),
        coreTo: new Date('2026-08-16T00:00:00.000Z'),
      });

      expect(movements[0].externalKey).toBe('ext-key');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('campo_invalido'));
      errorSpy.mockRestore();
    });
  });

  describe('occurredAt', () => {
    it('vem do UUIDv7 do ref_id, não de transaction_date (sempre nulo na Trio)', async () => {
      // UUIDv7 cujos 48 bits iniciais codificam 2026-08-15T12:00:00.000Z (epoch ms em hex).
      const epochMs = new Date('2026-08-15T12:00:00.000Z').getTime();
      const hex = epochMs.toString(16).padStart(12, '0');
      const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;

      const trioMock = buildTrioMock([buildTransaction({ ref_id: uuid })]);
      const { movements } = await fetchOne(trioMock);

      expect(movements[0].occurredAt?.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    });
  });

  describe('aviso de lançamento sem chave', () => {
    it('contagem de withoutKey exclui tesouraria — transferência do painel sem external_id não é alarme', async () => {
      const trioMock = buildTrioMock([
        buildTransaction({
          amount: { amount: -500 },
          counterparty_tax_number: '56183358000151',
          external_id: undefined,
          end_to_end_id: undefined,
          ref_id: undefined,
        }),
      ]);
      const service = new TrioMovementsService(trioMock as never, buildConfigService());
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service.fetchMovements({
        brand: 'suprema',
        accountId: 'acc-1',
        coreFrom: new Date('2026-08-15T00:00:00.000Z'),
        coreTo: new Date('2026-08-16T00:00:00.000Z'),
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('regressão do bug de cursor — via TrioBankingClient real, mockado só na camada HTTP', () => {
    it('2 lançamentos no mesmo microssegundo (lançamento + tarifa), separados por has_more no meio — as 2 linhas aparecem, nunca 1', async () => {
      const mockedCreate = jest.spyOn(axios, 'create');
      const httpMock: HttpGetMock = { get: jest.fn() };

      // 1ª chamada: janela cheia, precisa dividir (mesmo padrão da Fase 06).
      httpMock.get.mockResolvedValueOnce({ data: { data: [], metadata: { has_more: true } } });
      // 2ª chamada (metade esquerda): o lançamento.
      httpMock.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              amount: { amount: -745 },
              transaction_type: 'regular',
              ref_id: '01926a3a-0000-7000-8000-000000000002',
              external_id: 'lancamento-no-limite',
            },
          ],
          metadata: { has_more: false },
        },
      });
      // 3ª chamada (metade direita, sem overlap/buraco): a tarifa do mesmo par.
      httpMock.get.mockResolvedValueOnce({
        data: {
          data: [
            {
              amount: { amount: 745 },
              transaction_type: 'fee',
              ref_id: '01926a3a-0000-7000-8000-000000000003',
            },
          ],
          metadata: { has_more: false },
        },
      });
      mockedCreate.mockReturnValue(httpMock as never);

      const realClient = new TrioBankingClient({
        baseUrl: 'https://trio.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        amountDivisor: 100,
        accountIds: { suprema: 'acc-1', ultra: 'acc-2', maxima: 'acc-3' },
      });
      const service = new TrioMovementsService(realClient, buildConfigService());

      const { movements, fees } = await service.fetchMovements({
        brand: 'suprema',
        accountId: 'acc-1',
        coreFrom: new Date('2026-08-15T00:00:00.000Z'),
        coreTo: new Date('2026-08-15T10:00:00.000Z'),
      });

      expect(httpMock.get).toHaveBeenCalledTimes(3);
      expect(movements).toHaveLength(1);
      expect(fees.count).toBe(1);

      mockedCreate.mockRestore();
    });
  });

  describe('isConfigured', () => {
    it('reflete TrioBankingClient.isConfigured', () => {
      const trioMock = buildTrioMock([]);
      trioMock.isConfigured = false;
      const service = new TrioMovementsService(trioMock as never, buildConfigService());
      expect(service.isConfigured).toBe(false);
    });
  });
});
