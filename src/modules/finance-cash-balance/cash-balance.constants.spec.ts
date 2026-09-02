import { assertKnownBrand } from './cash-balance.constants';

describe('assertKnownBrand', () => {
  it('marca do catálogo → devolve a própria marca', () => {
    expect(assertKnownBrand('suprema')).toBe('suprema');
    expect(assertKnownBrand('ultra')).toBe('ultra');
    expect(assertKnownBrand('maxima')).toBe('maxima');
  });

  it('marca fora do catálogo → lança antes de qualquer escrita', () => {
    expect(() => assertKnownBrand('inexistente')).toThrow(/marca desconhecida/);
  });

  it('string vazia → lança', () => {
    expect(() => assertKnownBrand('')).toThrow(/marca desconhecida/);
  });
});
