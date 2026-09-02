import { CorrectionSearchService } from './correction-search.service';

describe('CorrectionSearchService', () => {
  const buildClickhouseMock = (rows: unknown[] = []) => ({
    isConfigured: true,
    query: jest.fn().mockResolvedValue(rows),
  });

  describe('fetchDownCorrectionsByTaxNumber', () => {
    it('usa FINAL contra dw_bet.fct_correction', async () => {
      const clickhouseMock = buildClickhouseMock([]);
      const service = new CorrectionSearchService(clickhouseMock as never);

      await service.fetchDownCorrectionsByTaxNumber({
        taxNumbers: ['12345678901'],
        from: '2026-08-08',
        to: '2026-08-15',
      });

      const [query] = clickhouseMock.query.mock.calls[0] as [string, unknown];
      expect(query).toMatch(/FROM\s+dw_bet\.fct_correction\s+FINAL/);
    });

    it('devolve vazio sem consultar o ClickHouse quando não há CPF', async () => {
      const clickhouseMock = buildClickhouseMock([]);
      const service = new CorrectionSearchService(clickhouseMock as never);

      const result = await service.fetchDownCorrectionsByTaxNumber({
        taxNumbers: [],
        from: '2026-08-08',
        to: '2026-08-15',
      });

      expect(result).toEqual([]);
      expect(clickhouseMock.query).not.toHaveBeenCalled();
    });
  });

  describe('resolveClients — ponte por pix_key', () => {
    it('filtra pix_key_type = CPF e usa DISTINCT (não any()) na query', async () => {
      const clickhouseMock = buildClickhouseMock([]);
      const service = new CorrectionSearchService(clickhouseMock as never);

      await service.resolveClients(['12345678901']);

      const [query] = clickhouseMock.query.mock.calls[0] as [string, unknown];
      expect(query).toContain("pix_key_type = 'CPF'");
      expect(query).toContain('SELECT DISTINCT');
      expect(query).not.toContain('any(');
    });

    it('dois client_id para o mesmo CPF na mesma marca — ambos entram no resultado (DISTINCT não esconde nenhum)', async () => {
      const clickhouseMock = buildClickhouseMock([
        { tax_number: '12345678901', brand: 'suprema', client_id: '111' },
        { tax_number: '12345678901', brand: 'suprema', client_id: '222' },
      ]);
      const service = new CorrectionSearchService(clickhouseMock as never);

      const clients = await service.resolveClients(['12345678901']);

      expect(clients).toHaveLength(2);
      expect(clients.map((c) => c.clientId).sort((a, b) => a.localeCompare(b))).toEqual([
        '111',
        '222',
      ]);
    });
  });

  describe('query_params sem interpolação', () => {
    it('nenhuma das 3 queries interpola marca/CPF/client_id na string', async () => {
      const clickhouseMock = buildClickhouseMock([]);
      const service = new CorrectionSearchService(clickhouseMock as never);

      await service.fetchDownCorrectionsByTaxNumber({
        taxNumbers: ['99988877766'],
        from: '2026-08-08',
        to: '2026-08-15',
      });
      await service.resolveClients(['99988877766']);
      await service.fetchDownCorrections({
        clientIds: ['client-xyz'],
        from: '2026-08-08',
        to: '2026-08-15',
      });

      for (const [query] of clickhouseMock.query.mock.calls as [string, unknown][]) {
        expect(query).not.toContain('99988877766');
        expect(query).not.toContain('client-xyz');
        expect(query).not.toContain('2026-08-08');
      }

      const [, taxNumberParams] = clickhouseMock.query.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(taxNumberParams).toEqual({
        direcao: 'down',
        dia_inicio: '2026-08-08',
        dia_fim: '2026-08-15',
        documentos: ['99988877766'],
      });
    });
  });

  describe('nunca loga o CPF', () => {
    it('resolveClients registra só a contagem, nunca o valor do CPF, no log', async () => {
      const clickhouseMock = buildClickhouseMock([
        { tax_number: '55566677788', brand: 'suprema', client_id: '333' },
      ]);
      const service = new CorrectionSearchService(clickhouseMock as never);
      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.resolveClients(['55566677788']);

      const loggedMessages = logSpy.mock.calls.map((call) => String(call[0]));
      expect(loggedMessages.some((message) => message.includes('55566677788'))).toBe(false);
    });
  });

  describe('isConfigured', () => {
    it('reflete ClickHouseService.isConfigured', () => {
      const service = new CorrectionSearchService({ isConfigured: false } as never);
      expect(service.isConfigured).toBe(false);
    });
  });
});
