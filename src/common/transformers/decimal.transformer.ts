import type { ValueTransformer } from 'typeorm';

/**
 * Toda coluna monetária (`numeric`) volta do driver `pg` como `string` — sem
 * este transformer o domínio recebe `string` onde espera `number` e a soma
 * vira concatenação silenciosa. Dinheiro nunca é `float`: a coluna continua
 * `numeric(18,2)` no banco, só a leitura/escrita em JS passa por `number`.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null): number | null => value ?? null,
  from: (value?: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
