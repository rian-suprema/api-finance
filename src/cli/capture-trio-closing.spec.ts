import { parseArgs } from './capture-trio-closing';

describe('capture-trio-closing CLI — parseArgs', () => {
  it('exige data — sem ela, lança', () => {
    expect(() => parseArgs([])).toThrow(/informe a data de referência/);
  });

  it('data inválida → lança', () => {
    expect(() => parseArgs(['29/07/2026'])).toThrow(/informe a data de referência/);
  });

  it('com --overwrite, propaga overwrite: true', () => {
    const options = parseArgs(['2026-07-29', '--overwrite']);

    expect(options.overwrite).toBe(true);
  });

  it('sem --overwrite, propaga overwrite: false — nunca sobrescreve por acidente', () => {
    const options = parseArgs(['2026-07-29']);

    expect(options.overwrite).toBe(false);
  });

  it('sem --brands=, usa o catálogo inteiro', () => {
    const options = parseArgs(['2026-07-29']);

    expect(options.brands).toEqual(['suprema', 'ultra', 'maxima']);
  });

  it('marca fora do catálogo → lança', () => {
    expect(() => parseArgs(['2026-07-29', '--brands=inexistente'])).toThrow(/marca desconhecida/);
  });
});
