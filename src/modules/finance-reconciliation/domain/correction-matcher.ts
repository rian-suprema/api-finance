import {
  MAX_CORRECTION_CANDIDATES,
  MAX_CORRECTION_COMBINATION_SIZE,
  MAX_CORRECTIONS_FOR_COMBINATION,
} from '../reconciliation.constants';
import type { CorrectionConfidence } from './reconciliation.types';

/**
 * Casamento entre pendência do banco e correção de saldo do backoffice.
 *
 * Lógica pura, sem I/O, como o `matcher.ts`: entra o valor da pendência e as
 * correções do CPF na janela, sai uma lista de candidatos ordenada por confiança.
 *
 * ── O que este casamento NÃO é ─────────────────────────────────────────────
 * Não é o casamento da conciliação. Aquele é 1:1 por `gateway_external_id` e
 * decide sozinho. Este é **evidência para um humano decidir**, e por um motivo
 * concreto: a correção de saldo não carrega nenhuma referência ao pagamento que
 * ela provocou. Ligar os dois é inferência — jogador, valor e proximidade no
 * tempo. Por isso nada aqui dá baixa automática.
 *
 * ── Por que a identidade do jogador é obrigatória ──────────────────────────
 * Sem `client_id`, sobra casar por valor, e valor sozinho erra: em um conjunto
 * real de 375 pendências, 127 achariam par no próprio dia do pagamento — e
 * nenhum dos 93 pares confirmados por jogador tem defasagem zero. Ou seja, esses
 * 127 casariam com as correções de centavos do dia, que não têm relação alguma
 * com o pagamento. Pendência sem jogador identificado sai sem candidato.
 */

export interface CorrectionEntry {
  correctionId: string;
  brand: string;
  clientId: string;
  correctionDate: string;
  occurredAt: Date | null;
  amountCents: number;
}

export interface CorrectionTarget {
  /** Marca de onde saiu o pagamento — a conta do banco que debitou. */
  brand: string;
  amountCents: number;
}

export interface CorrectionCandidate {
  confidence: CorrectionConfidence;
  amountCents: number;
  /** `amountCents − valor da pendência`. Zero fora de `PARTIAL`. */
  differenceCents: number;
  corrections: CorrectionEntry[];
}

/**
 * Candidatos a explicar a pendência, do mais forte ao mais fraco, cortados em
 * `MAX_CORRECTION_CANDIDATES`.
 *
 * A ordem é a da confiança, e ela importa: o primeiro candidato é o que a tela
 * mostra em destaque, e é sobre ele que o operador decide.
 */
export const findCorrectionCandidates = (
  target: CorrectionTarget,
  corrections: CorrectionEntry[],
): CorrectionCandidate[] => {
  if (corrections.length === 0) return [];

  const exactSameBrand: CorrectionCandidate[] = [];
  const exactOtherBrand: CorrectionCandidate[] = [];

  for (const correction of corrections) {
    if (correction.amountCents !== target.amountCents) continue;

    const candidate: CorrectionCandidate = {
      confidence: correction.brand === target.brand ? 'EXACT_SAME_BRAND' : 'EXACT_OTHER_BRAND',
      amountCents: correction.amountCents,
      differenceCents: 0,
      corrections: [correction],
    };

    if (candidate.confidence === 'EXACT_SAME_BRAND') exactSameBrand.push(candidate);
    else exactOtherBrand.push(candidate);
  }

  const sums = findSums(target, corrections);
  const partials = findPartials(target, corrections);

  return [...exactSameBrand, ...exactOtherBrand, ...sums, ...partials].slice(
    0,
    MAX_CORRECTION_CANDIDATES,
  );
};

/**
 * Combinações de 2 a `MAX_CORRECTION_COMBINATION_SIZE` correções cuja soma dá o
 * valor do pagamento.
 *
 * É o caso da licença de 3 marcas: saldo corrigido em mais de uma marca e um
 * pagamento só. Também cobre o mesmo jogador com duas correções na mesma marca
 * (visto uma vez: R$ 0,32 + R$ 0,27 = R$ 0,59).
 */
const findSums = (target: CorrectionTarget, corrections: CorrectionEntry[]): CorrectionCandidate[] => {
  if (corrections.length > MAX_CORRECTIONS_FOR_COMBINATION) return [];

  const found: CorrectionCandidate[] = [];

  const walk = (start: number, chosen: CorrectionEntry[], sum: number): void => {
    if (found.length >= MAX_CORRECTION_CANDIDATES) return;

    if (chosen.length >= 2 && sum === target.amountCents) {
      found.push({
        confidence: 'SUM',
        amountCents: sum,
        differenceCents: 0,
        corrections: [...chosen],
      });
      return;
    }

    if (chosen.length >= MAX_CORRECTION_COMBINATION_SIZE) return;
    // Só soma positiva: passar do valor nunca volta.
    if (sum > target.amountCents) return;

    for (let index = start; index < corrections.length; index += 1) {
      chosen.push(corrections[index]);
      walk(index + 1, chosen, sum + corrections[index].amountCents);
      chosen.pop();
    }
  };

  walk(0, [], 0);

  return found;
};

/**
 * Correção do mesmo jogador com valor **diferente** do pagamento, mais próxima
 * primeiro.
 *
 * Não explica a pendência e não pode ser tratada como se explicasse — visto na
 * prática quase sempre com a correção **menor** que o pagamento (pendência de
 * R$ 25,00 com correção de R$ 15,09). Vale como fio para investigar — o jogador
 * é o mesmo e a janela é a mesma.
 */
const findPartials = (
  target: CorrectionTarget,
  corrections: CorrectionEntry[],
): CorrectionCandidate[] =>
  corrections
    .filter((correction) => correction.amountCents !== target.amountCents)
    .map<CorrectionCandidate>((correction) => ({
      confidence: 'PARTIAL',
      amountCents: correction.amountCents,
      differenceCents: correction.amountCents - target.amountCents,
      corrections: [correction],
    }))
    .sort((first, second) => Math.abs(first.differenceCents) - Math.abs(second.differenceCents))
    .slice(0, MAX_CORRECTION_CANDIDATES);
