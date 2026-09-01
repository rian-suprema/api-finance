import type { BrandKey } from '../cash-balance.constants';
import { buildKpiCard, divideByBrand, subtractByBrand } from './kpi-card.util';

describe('kpi-card.util', () => {
  it('buildKpiCard: byBrand segue a ordem do array de marcas, não do Map; marca sem valor entra com amount 0', () => {
    const amounts = new Map<BrandKey, number>([['suprema', 1000]]);
    const card = buildKpiCard(['suprema', 'ultra'], amounts);

    expect(card.byBrand.map((item) => item.brand)).toEqual(['suprema', 'ultra']);
    expect(card.byBrand[1].amount).toBe(0);
    expect(card.total).toBe(1000);
  });

  it('subtractByBrand: união das chaves dos dois mapas; marca só no segundo mapa entra com left = 0', () => {
    const left = new Map<BrandKey, number>([['suprema', 500]]);
    const right = new Map<BrandKey, number>([
      ['suprema', 200],
      ['ultra', 50],
    ]);

    const result = subtractByBrand(left, right);

    expect(result.get('suprema')).toBe(300);
    expect(result.get('ultra')).toBe(-50);
  });

  it('divideByBrand: divisor 0 ou negativo devolve Map vazio, nunca NaN/Infinity', () => {
    const amounts = new Map<BrandKey, number>([['suprema', 900]]);

    expect(divideByBrand(amounts, 0)).toEqual(new Map());
    expect(divideByBrand(amounts, -3)).toEqual(new Map());
    expect(divideByBrand(amounts, 3).get('suprema')).toBe(300);
  });

  it('sinal do Total do Balanço — transacional menos jogadores é sempre positivo quando o transacional é maior', () => {
    const saldoTransacional = new Map<BrandKey, number>([['maxima', 1000]]);
    const saldoJogadores = new Map<BrandKey, number>([['maxima', 700]]);

    const totalBalanco = subtractByBrand(saldoTransacional, saldoJogadores);

    expect(totalBalanco.get('maxima')).toBe(300);
    expect(totalBalanco.get('maxima')).not.toBe(-300);
  });

  it('arredondamento: dízima de ponto flutuante (0.1 + 0.2) não vaza para o resultado de buildKpiCard', () => {
    const amounts = new Map<BrandKey, number>([
      ['suprema', 0.1],
      ['ultra', 0.2],
    ]);
    const card = buildKpiCard(['suprema', 'ultra'], amounts);
    expect(card.total).toBe(0.3);

    // subtractByBrand não arredonda por si (preserva a precisão bruta da
    // subtração) — é buildKpiCard, na composição real dos use-cases, quem
    // arredonda o valor que a tela mostra.
    const netDeposit = subtractByBrand(
      new Map<BrandKey, number>([['suprema', 0.3]]),
      new Map<BrandKey, number>([['suprema', 0.1]]),
    );
    const netDepositCard = buildKpiCard(['suprema'], netDeposit);
    expect(netDepositCard.byBrand[0].amount).toBe(0.2);
  });
});
