import { ServiceUnavailableException } from '@nestjs/common';

import { SearchCorrectionsUseCase } from './search-corrections.use-case';

describe('SearchCorrectionsUseCase', () => {
  const ITEM = { id: 1, amount: 45, taxNumber: '66666666666' };

  const buildItemRepository = (overrides: Record<string, unknown> = {}) => ({
    findItemsForCorrectionSearch: jest.fn().mockResolvedValue([ITEM]),
    ...overrides,
  });

  const buildCorrections = (overrides: Record<string, unknown> = {}) => ({
    isConfigured: true,
    fetchDownCorrectionsByTaxNumber: jest.fn().mockResolvedValue([]),
    resolveClients: jest.fn().mockResolvedValue([]),
    fetchDownCorrections: jest.fn().mockResolvedValue([]),
    ...overrides,
  });

  it('ClickHouse não configurado → ServiceUnavailableException, sem consultar nada', async () => {
    const itemRepository = buildItemRepository();
    const useCase = new SearchCorrectionsUseCase(
      itemRepository as never,
      buildCorrections({ isConfigured: false }) as never,
    );

    await expect(
      useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(itemRepository.findItemsForCorrectionSearch).not.toHaveBeenCalled();
  });

  it('nenhuma pendência candidata → view vazia com contagens em zero', async () => {
    const useCase = new SearchCorrectionsUseCase(
      buildItemRepository({
        findItemsForCorrectionSearch: jest.fn().mockResolvedValue([]),
      }) as never,
      buildCorrections() as never,
    );

    const result = await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema' });

    expect(result).toMatchObject({
      searchedCount: 0,
      withEvidenceCount: 0,
      withoutClientCount: 0,
      items: [],
    });
  });

  it('CPF sem client_id conhecido (a ponte não alcança) → clientResolved:false, candidates:[]', async () => {
    const useCase = new SearchCorrectionsUseCase(
      buildItemRepository() as never,
      buildCorrections({
        fetchDownCorrectionsByTaxNumber: jest.fn().mockResolvedValue([]),
        resolveClients: jest.fn().mockResolvedValue([]),
      }) as never,
    );

    const result = await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema' });

    expect(result.items).toEqual([{ itemId: 1, clientResolved: false, candidates: [] }]);
    expect(result.withoutClientCount).toBe(1);
  });

  it('correção de valor exato, mesma marca → candidato EXACT_SAME_BRAND com exact:true', async () => {
    const useCase = new SearchCorrectionsUseCase(
      buildItemRepository() as never,
      buildCorrections({
        resolveClients: jest
          .fn()
          .mockResolvedValue([{ taxNumber: '66666666666', brand: 'suprema', clientId: '900001' }]),
        fetchDownCorrections: jest.fn().mockResolvedValue([
          {
            correctionId: 'bc:corr-1',
            brand: 'suprema',
            clientId: '900001',
            correctionDate: '2026-06-11',
            occurredAt: null,
            amountCents: 4500,
          },
        ]),
      }) as never,
    );

    const result = await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema' });

    expect(result.items[0].clientResolved).toBe(true);
    expect(result.items[0].candidates[0]).toMatchObject({
      confidence: 'EXACT_SAME_BRAND',
      exact: true,
      amount: 45,
      difference: 0,
    });
  });

  it('correção de valor diferente → candidato PARTIAL com exact:false', async () => {
    const useCase = new SearchCorrectionsUseCase(
      buildItemRepository({
        findItemsForCorrectionSearch: jest
          .fn()
          .mockResolvedValue([{ id: 2, amount: 80, taxNumber: '77777777777' }]),
      }) as never,
      buildCorrections({
        resolveClients: jest
          .fn()
          .mockResolvedValue([{ taxNumber: '77777777777', brand: 'suprema', clientId: '900002' }]),
        fetchDownCorrections: jest.fn().mockResolvedValue([
          {
            correctionId: 'bc:corr-2',
            brand: 'suprema',
            clientId: '900002',
            correctionDate: '2026-06-13',
            occurredAt: null,
            amountCents: 3000,
          },
        ]),
      }) as never,
    );

    const result = await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema' });

    expect(result.items[0].candidates[0]).toMatchObject({
      confidence: 'PARTIAL',
      exact: false,
      difference: -50,
    });
  });

  it('a mesma correção alcançada pelas duas fontes (CPF na linha + ponte) entra uma vez só', async () => {
    const useCase = new SearchCorrectionsUseCase(
      buildItemRepository() as never,
      buildCorrections({
        fetchDownCorrectionsByTaxNumber: jest.fn().mockResolvedValue([
          {
            correctionId: 'bc:corr-1',
            brand: 'suprema',
            clientId: '900001',
            correctionDate: '2026-06-11',
            occurredAt: null,
            amountCents: 4500,
            taxNumber: '66666666666',
          },
        ]),
        resolveClients: jest
          .fn()
          .mockResolvedValue([{ taxNumber: '66666666666', brand: 'suprema', clientId: '900001' }]),
        fetchDownCorrections: jest.fn().mockResolvedValue([
          {
            correctionId: 'bc:corr-1',
            brand: 'suprema',
            clientId: '900001',
            correctionDate: '2026-06-11',
            occurredAt: null,
            amountCents: 4500,
          },
        ]),
      }) as never,
    );

    const result = await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema' });

    expect(result.items[0].candidates).toHaveLength(1);
    expect(result.items[0].candidates[0].corrections).toHaveLength(1);
  });
});
