import { roundCurrency } from '../../../common/utils/number.util';
import type { FlowMatch, Movement, ReconciliationFlow, SideTotals } from './reconciliation.types';

/**
 * Casamento entre as duas pontas da conciliação. Lógica pura: recebe listas de
 * lançamentos, devolve o que casou e o que sobrou. Não conhece TypeORM, HTTP,
 * ClickHouse nem Trio.
 *
 * ── Uma chave só, e ela é 1:1 ────────────────────────────────────────────────
 * O casamento é pelo identificador do gateway: `gateway_external_id` do lado da
 * plataforma (`dw_bet.fct_deposit` e `dw_bet.fct_withdrawal`) contra
 * `external_id` do lado do banco. É o mesmo número, gerado pelo gateway quando
 * cria a cobrança ou o pagamento na Trio.
 *
 * **Não existe casamento por valor.** Valor casa por multiconjunto, então sabia
 * que um lançamento sobrou mas não *qual* — incidente real: 37 saques legítimos
 * marcados como pendência porque pagamentos de outro canal com o mesmo valor
 * ocuparam o lugar deles (um jogador com dois saques de R$ 10.000,00 com
 * 2,181 s de diferença: nem valor nem instante separam esse par, a chave separa).
 *
 * Lançamento **sem chave** não casa com nada e vira pendência. É deliberado:
 * inventar um casamento aproximado para ele é o defeito que acabou de sair.
 * `withoutKey` conta esses casos para que a falta apareça em vez de se
 * disfarçar de divergência de caixa.
 *
 * ── Virada do dia ────────────────────────────────────────────────────────────
 * O banco é varrido só no dia de referência; a plataforma vem de `D−1` a `D+1`
 * (`PLATFORM_NEIGHBOUR_DAYS`). Quando o banco postou hoje e a plataforma
 * registrou no dia vizinho, a chave casa igual e o par entra em `crossEdge`, que
 * é o quanto isso desloca a diferença `banco − plataforma` do dia. Como a chave
 * é única, nenhum par desses é um chute.
 */

interface PairOutcome {
  /** Pares em que ao menos um lado está dentro do dia. */
  matched: number;
  /** Pares com um lado dentro do dia e o outro num dia vizinho. */
  crossEdgeCount: number;
  /**
   * Quanto os pares de virada deslocam a diferença `banco − plataforma`, em
   * centavos: positivo quando o banco lançou hoje e a plataforma no dia
   * vizinho, negativo no caso oposto.
   */
  crossEdgeCents: number;
  /** Chaves que apareceram mais de uma vez do mesmo lado — erro de origem. */
  duplicateKeys: number;
  platformLeft: Movement[];
  bankLeft: Movement[];
}

/** Dentro do dia primeiro. `sort` é estável, então a ordem original se mantém. */
function coreFirst(movements: Movement[]): Movement[] {
  return [...movements].sort((left, right) => Number(right.core) - Number(left.core));
}

function groupByKey(movements: Movement[], keyless: Movement[]): Map<string, Movement[]> {
  const buckets = new Map<string, Movement[]>();

  for (const movement of movements) {
    const key = movement.externalKey;
    if (!key) {
      keyless.push(movement);
      continue;
    }
    const list = buckets.get(key);
    if (list) list.push(movement);
    else buckets.set(key, [movement]);
  }

  return buckets;
}

interface BucketPairOutcome {
  matched: number;
  crossEdgeCount: number;
  crossEdgeCents: number;
  platformLeft: Movement[];
  bankLeft: Movement[];
}

/** Casa as linhas de uma única chave (já dentro-do-dia-primeiro por `coreFirst`). */
function pairBucket(platformRows: Movement[], bankRows: Movement[]): BucketPairOutcome {
  const platform = coreFirst(platformRows);
  const bank = coreFirst(bankRows);
  const pairs = Math.min(platform.length, bank.length);

  let matched = 0;
  let crossEdgeCount = 0;
  let crossEdgeCents = 0;

  for (let index = 0; index < pairs; index++) {
    const platformRow = platform[index];
    const bankRow = bank[index];

    // Par inteiro fora do dia pertence ao dia vizinho: não conta como
    // conciliado aqui, e será contado quando aquele dia for conciliado.
    if (!platformRow.core && !bankRow.core) continue;

    matched++;

    if (platformRow.core !== bankRow.core) {
      crossEdgeCount++;
      crossEdgeCents += bankRow.core ? bankRow.amountCents : -platformRow.amountCents;
    }
  }

  return {
    matched,
    crossEdgeCount,
    crossEdgeCents,
    platformLeft: platform.slice(pairs),
    bankLeft: bank.slice(pairs),
  };
}

function pairByExternalKey(platform: Movement[], bank: Movement[]): PairOutcome {
  const platformLeft: Movement[] = [];
  const bankLeft: Movement[] = [];
  const platformBuckets = groupByKey(platform, platformLeft);
  const bankBuckets = groupByKey(bank, bankLeft);

  let matched = 0;
  let crossEdgeCount = 0;
  let crossEdgeCents = 0;
  let duplicateKeys = 0;

  for (const [key, platformRows] of platformBuckets) {
    const bankRows = bankBuckets.get(key) ?? [];
    if (platformRows.length > 1 || bankRows.length > 1) duplicateKeys++;

    const outcome = pairBucket(platformRows, bankRows);
    matched += outcome.matched;
    crossEdgeCount += outcome.crossEdgeCount;
    crossEdgeCents += outcome.crossEdgeCents;
    platformLeft.push(...outcome.platformLeft);
    bankLeft.push(...outcome.bankLeft);
    bankBuckets.delete(key);
  }

  // Chaves que só existem do lado do banco: nenhum par possível.
  for (const bankRows of bankBuckets.values()) bankLeft.push(...bankRows);

  return { matched, crossEdgeCount, crossEdgeCents, duplicateKeys, platformLeft, bankLeft };
}

/** Casa um fluxo (depósito ou saque) e devolve o que sobrou de cada lado. */
export function matchFlow(
  flow: ReconciliationFlow,
  platform: Movement[],
  bank: Movement[],
): FlowMatch {
  const outcome = pairByExternalKey(platform, bank);
  const leftovers = [...outcome.platformLeft, ...outcome.bankLeft];
  const pending = leftovers.filter((movement) => movement.core);

  return {
    flow,
    matchedCount: outcome.matched,
    crossEdge: {
      count: outcome.crossEdgeCount,
      total: roundCurrency(outcome.crossEdgeCents / 100),
    },
    duplicateKeys: outcome.duplicateKeys,
    withoutKey: pending.filter((movement) => !movement.externalKey).length,
    pending,
    edgeLeftovers: leftovers.filter((movement) => !movement.core),
  };
}

/** Soma dos lançamentos de dentro do dia, em reais. O dia vizinho não entra. */
export function sumCore(movements: Movement[]): SideTotals {
  let cents = 0;
  let count = 0;

  for (const movement of movements) {
    if (!movement.core) continue;
    cents += movement.amountCents;
    count++;
  }

  return { total: roundCurrency(cents / 100), count };
}

export function filterFlow(movements: Movement[], flow: ReconciliationFlow): Movement[] {
  return movements.filter((movement) => movement.flow === flow);
}
