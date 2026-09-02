import { ServiceUnavailableException } from '@nestjs/common';

import { ApplyCorrectionMatchesUseCase } from './apply-correction-matches.use-case';

describe('ApplyCorrectionMatchesUseCase', () => {
  const buildItemRepository = (overrides: Record<string, unknown> = {}) => ({
    resolveItems: jest.fn().mockResolvedValue(0),
    ...overrides,
  });

  const buildSearch = (found: unknown) => ({ execute: jest.fn().mockResolvedValue(found) });

  it('dá baixa só na pendência cujo PRIMEIRO candidato é exato — PARTIAL em primeiro lugar fica aberta', async () => {
    const found = {
      referenceDate: '2026-06-15',
      brand: 'suprema',
      searchedCount: 2,
      items: [
        {
          itemId: 1,
          clientResolved: true,
          candidates: [{ confidence: 'EXACT_SAME_BRAND', exact: true, note: 'nota exata' }],
        },
        {
          itemId: 2,
          clientResolved: true,
          candidates: [{ confidence: 'PARTIAL', exact: false, note: 'nota parcial' }],
        },
      ],
    };
    const itemRepository = buildItemRepository();
    const useCase = new ApplyCorrectionMatchesUseCase(
      itemRepository as never,
      buildSearch(found) as never,
    );

    await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema', userId: 'user-1' });

    expect(itemRepository.resolveItems).toHaveBeenCalledWith(
      expect.objectContaining({ ids: [1], userId: 'user-1' }),
    );
  });

  it('resolvedBy gravado é o userId de quem apertou o botão, nunca "sistema"', async () => {
    const found = {
      referenceDate: '2026-06-15',
      brand: 'suprema',
      searchedCount: 1,
      items: [
        {
          itemId: 1,
          clientResolved: true,
          candidates: [{ confidence: 'SUM', exact: true, note: 'x' }],
        },
      ],
    };
    const itemRepository = buildItemRepository();
    const useCase = new ApplyCorrectionMatchesUseCase(
      itemRepository as never,
      buildSearch(found) as never,
    );

    await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema', userId: 'operador-42' });

    const [[params]] = itemRepository.resolveItems.mock.calls as [[{ userId: string }]];
    expect(params.userId).toBe('operador-42');
    expect(params.userId).not.toBe('sistema');
  });

  it('reusa a busca com os MESMOS parâmetros — nunca reimplementa a consulta ao warehouse', async () => {
    const found = { referenceDate: '2026-06-15', brand: 'suprema', searchedCount: 0, items: [] };
    const search = buildSearch(found);
    const useCase = new ApplyCorrectionMatchesUseCase(
      buildItemRepository() as never,
      search as never,
    );

    await useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema', userId: 'user-1' });

    expect(search.execute).toHaveBeenCalledTimes(1);
    expect(search.execute).toHaveBeenCalledWith({
      referenceDate: '2026-06-15',
      brand: 'suprema',
      userId: 'user-1',
    });
  });

  it('resume partialCount e withoutCandidateCount corretamente', async () => {
    const found = {
      referenceDate: '2026-06-15',
      brand: 'suprema',
      searchedCount: 3,
      items: [
        {
          itemId: 1,
          clientResolved: true,
          candidates: [{ confidence: 'EXACT_SAME_BRAND', exact: true, note: 'a' }],
        },
        {
          itemId: 2,
          clientResolved: true,
          candidates: [{ confidence: 'PARTIAL', exact: false, note: 'b' }],
        },
        { itemId: 3, clientResolved: false, candidates: [] },
      ],
    };
    const itemRepository = buildItemRepository({ resolveItems: jest.fn().mockResolvedValue(1) });
    const useCase = new ApplyCorrectionMatchesUseCase(
      itemRepository as never,
      buildSearch(found) as never,
    );

    const result = await useCase.execute({
      referenceDate: '2026-06-15',
      brand: 'suprema',
      userId: 'user-1',
    });

    expect(result).toEqual({
      referenceDate: '2026-06-15',
      brand: 'suprema',
      searchedCount: 3,
      resolvedCount: 1,
      partialCount: 1,
      withoutCandidateCount: 1,
    });
  });

  it('ClickHouse indisponível — propaga o 503 da busca, sem tocar no repositório', async () => {
    const itemRepository = buildItemRepository();
    const search = {
      execute: jest
        .fn()
        .mockRejectedValue(
          new ServiceUnavailableException('Integração com o data warehouse não configurada'),
        ),
    };
    const useCase = new ApplyCorrectionMatchesUseCase(itemRepository as never, search as never);

    await expect(
      useCase.execute({ referenceDate: '2026-06-15', brand: 'suprema', userId: 'user-1' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(itemRepository.resolveItems).not.toHaveBeenCalled();
  });
});
