import { parseArgs } from './export-trio-statement';

describe('export-trio-statement CLI — parseArgs', () => {
  it('exige --from e --to no formato YYYY-MM-DD', () => {
    expect(() => parseArgs([])).toThrow(/informe --from e --to/);
    expect(() => parseArgs(['--from=29/07/2026', '--to=2026-07-29'])).toThrow(
      /informe --from e --to/,
    );
  });

  it('--from posterior a --to → lança', () => {
    expect(() => parseArgs(['--from=2026-07-30', '--to=2026-07-29'])).toThrow(
      /não pode ser posterior/,
    );
  });

  it('sem --out=, default é "-" (stdout) — nunca arquivo dentro do pod', () => {
    const options = parseArgs(['--from=2026-07-23', '--to=2026-07-29']);
    expect(options.out).toBe('-');
  });

  it('--out= explícito sobrescreve o default', () => {
    const options = parseArgs(['--from=2026-07-23', '--to=2026-07-29', '--out=./extrato.csv']);
    expect(options.out).toBe('./extrato.csv');
  });

  it('sem --brands=, usa o catálogo inteiro', () => {
    const options = parseArgs(['--from=2026-07-23', '--to=2026-07-29']);
    expect(options.brands).toEqual(['suprema', 'ultra', 'maxima']);
  });

  it('marca fora do catálogo → lança', () => {
    expect(() =>
      parseArgs(['--from=2026-07-23', '--to=2026-07-29', '--brands=inexistente']),
    ).toThrow(/marca desconhecida/);
  });
});
