import { CaptureTrioClosingUseCase } from './capture-trio-closing.use-case';

describe('CaptureTrioClosingUseCase', () => {
  const CAPTURE = {
    brand: 'suprema',
    accountId: 'acc-1',
    balance: 100,
    cutoffAt: new Date(),
    capturedAt: new Date(),
    exact: true,
    method: 'POINT_IN_TIME',
  };

  const buildSource = (overrides: Record<string, unknown> = {}) => ({
    capture: jest.fn().mockResolvedValue(CAPTURE),
    ...overrides,
  });

  const buildRepository = (overrides: Record<string, unknown> = {}) => ({
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  it('sem `brands`, captura o catálogo inteiro', async () => {
    const source = buildSource();
    const useCase = new CaptureTrioClosingUseCase(source, buildRepository() as never);

    const results = await useCase.execute({ referenceDate: '2026-07-29' });

    expect(results.map((result) => result.brand)).toEqual(['suprema', 'ultra', 'maxima']);
    expect(source.capture).toHaveBeenCalledTimes(3);
  });

  it('propaga `overwrite` para o repositório', async () => {
    const repository = buildRepository();
    const useCase = new CaptureTrioClosingUseCase(buildSource(), repository as never);

    await useCase.execute({ referenceDate: '2026-07-29', brands: ['suprema'], overwrite: true });

    expect(repository.save).toHaveBeenCalledWith('2026-07-29', CAPTURE, true);
  });

  it('sem `overwrite` explícito, propaga `false` — nunca sobrescreve por acidente', async () => {
    const repository = buildRepository();
    const useCase = new CaptureTrioClosingUseCase(buildSource(), repository as never);

    await useCase.execute({ referenceDate: '2026-07-29', brands: ['suprema'] });

    expect(repository.save).toHaveBeenCalledWith('2026-07-29', CAPTURE, false);
  });

  it('uma marca que falha não impede as outras', async () => {
    const source = buildSource({
      capture: jest
        .fn()
        .mockResolvedValueOnce(CAPTURE)
        .mockRejectedValueOnce(new Error('conta Trio não configurada para a marca ultra'))
        .mockResolvedValueOnce({ ...CAPTURE, brand: 'maxima' }),
    });
    const useCase = new CaptureTrioClosingUseCase(source, buildRepository() as never);

    const results = await useCase.execute({
      referenceDate: '2026-07-29',
      brands: ['suprema', 'ultra', 'maxima'],
    });

    expect(results[0]).toMatchObject({ brand: 'suprema', saved: true });
    expect(results[1]).toMatchObject({
      brand: 'ultra',
      balance: null,
      saved: false,
      error: 'conta Trio não configurada para a marca ultra',
    });
    expect(results[2]).toMatchObject({ brand: 'maxima', saved: true });
  });
});
