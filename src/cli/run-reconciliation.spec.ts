import { yesterdayInBrt } from '../common/utils/date.util';
import { parseArgs } from './run-reconciliation';

describe('run-reconciliation CLI — parseArgs', () => {
  it('sem data explícita, usa yesterdayInBrt() como default — o CronJob roda às cegas, sem argumento', () => {
    const options = parseArgs([]);

    expect(options.referenceDate).toBe(yesterdayInBrt());
    expect(options.brands).toEqual(['suprema', 'ultra', 'maxima']);
  });

  it('com data explícita (posicional), ignora o default', () => {
    const options = parseArgs(['2026-07-29']);

    expect(options.referenceDate).toBe('2026-07-29');
  });

  it('com --date=, ignora o default', () => {
    const options = parseArgs(['--date=2026-07-29']);

    expect(options.referenceDate).toBe('2026-07-29');
  });

  it('--brands= restringe as marcas', () => {
    const options = parseArgs(['2026-07-29', '--brands=suprema,ultra']);

    expect(options.brands).toEqual(['suprema', 'ultra']);
  });

  it('marca fora do catálogo em --brands= lança antes de qualquer execução', () => {
    expect(() => parseArgs(['2026-07-29', '--brands=inexistente'])).toThrow(/marca desconhecida/);
  });
});
