/**
 * Montagem dos cards de KPI (total + quebra por marca). Compartilhado pelos
 * use-cases de leitura para os dois cards da tela do dia e do histórico
 * saírem com o mesmo formato e a mesma ordem de marcas.
 *
 * `label` ainda usa a própria chave da marca (não `BRANDS.find(...).label`,
 * já disponível desde a Fase 07) — nenhum use-case desta trilha até agora
 * consome o label real; trocar quando o primeiro consumidor precisar.
 */
import { roundCurrency } from '../../../common/utils/number.util';
import type { BrandKey } from '../cash-balance.constants';
import type { BrandAmount, KpiCard } from './cash-balance.types';

export function buildKpiCard(brands: BrandKey[], amounts: Map<BrandKey, number>): KpiCard {
  const byBrand: BrandAmount[] = brands.map((brand) => ({
    brand,
    label: brand,
    amount: roundCurrency(amounts.get(brand) ?? 0),
  }));

  return {
    total: roundCurrency(byBrand.reduce((total, item) => total + item.amount, 0)),
    byBrand,
  };
}

/** Subtração marca a marca — depósito menos saque resulta no net deposit. */
export function subtractByBrand(
  left: Map<BrandKey, number>,
  right: Map<BrandKey, number>,
): Map<BrandKey, number> {
  const result = new Map<BrandKey, number>();

  for (const brand of new Set([...left.keys(), ...right.keys()])) {
    result.set(brand, (left.get(brand) ?? 0) - (right.get(brand) ?? 0));
  }

  return result;
}

/** Média por dia, marca a marca. Divisor zero ou negativo devolve Map vazio, não NaN/Infinity. */
export function divideByBrand(
  amounts: Map<BrandKey, number>,
  divisor: number,
): Map<BrandKey, number> {
  if (divisor <= 0) return new Map();

  return new Map([...amounts].map(([brand, amount]) => [brand, amount / divisor]));
}
