import { parseArgs } from './export-trio-transactions';

describe('export-trio-transactions CLI — parseArgs', () => {
  it('exige --from e --to no formato YYYY-MM-DD', () => {
    expect(() => parseArgs([])).toThrow(/informe --from e --to/);
  });

  it('sem --types=, default é só "regular" (tarifa fica de fora)', () => {
    const options = parseArgs(['--from=2026-07-23', '--to=2026-07-29']);
    expect(options.types).toEqual(['regular']);
  });

  it('--types=regular,fee inclui a tarifa', () => {
    const options = parseArgs(['--from=2026-07-23', '--to=2026-07-29', '--types=regular,fee']);
    expect(options.types).toEqual(['regular', 'fee']);
  });

  it('sem --out=, default é "-" (stdout) — nunca arquivo dentro do pod (CSV tem PII)', () => {
    const options = parseArgs(['--from=2026-07-23', '--to=2026-07-29']);
    expect(options.out).toBe('-');
  });

  it('marca fora do catálogo → lança', () => {
    expect(() =>
      parseArgs(['--from=2026-07-23', '--to=2026-07-29', '--brands=inexistente']),
    ).toThrow(/marca desconhecida/);
  });
});
