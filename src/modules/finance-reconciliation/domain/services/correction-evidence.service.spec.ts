import { CorrectionEvidenceService } from './correction-evidence.service';

describe('CorrectionEvidenceService', () => {
  const buildAccess = (overrides: Record<string, unknown> = {}) => ({
    resolveReferenceDate: jest.fn().mockReturnValue('2026-06-15'),
    requireBrand: jest.fn().mockResolvedValue({ brand: 'suprema' }),
    ...overrides,
  });

  it('search: resolve marca + data e delega ao SearchCorrectionsUseCase', async () => {
    const access = buildAccess();
    const searchCorrections = { execute: jest.fn().mockResolvedValue({ items: [] }) };
    const service = new CorrectionEvidenceService(
      access as never,
      searchCorrections as never,
      { execute: jest.fn() } as never,
    );

    await service.search('Bearer x', 'suprema', '2026-06-15');

    expect(access.requireBrand).toHaveBeenCalledWith('Bearer x', 'suprema');
    expect(searchCorrections.execute).toHaveBeenCalledWith({
      referenceDate: '2026-06-15',
      brand: 'suprema',
    });
  });

  it('apply: resolve marca + data e delega ao ApplyCorrectionMatchesUseCase com o userId', async () => {
    const access = buildAccess();
    const applyMatches = { execute: jest.fn().mockResolvedValue({ resolvedCount: 0 }) };
    const service = new CorrectionEvidenceService(
      access as never,
      { execute: jest.fn() } as never,
      applyMatches as never,
    );

    await service.apply('Bearer x', 'suprema', 'user-1', '2026-06-15');

    expect(applyMatches.execute).toHaveBeenCalledWith({
      referenceDate: '2026-06-15',
      brand: 'suprema',
      userId: 'user-1',
    });
  });
});
