import { MAX_NOTE_LENGTH } from '../reconciliation.constants';
import type { CorrectionCandidate } from './correction-matcher';

/**
 * Nota de tratamento a partir do candidato encontrado.
 *
 * A nota é o registro contábil do porquê da pendência, então tem de dizer o que
 * foi encontrado e onde: valor, marca, dia, jogador e o id da correção. Quem
 * auditar depois volta em `dw_bet.fct_correction` e confere linha por linha.
 *
 * Fica no domínio, e não no frontend, porque tem **dois consumidores**: a tela usa
 * o texto como rascunho editável no modal, e a baixa em lote (`apply`) grava
 * exatamente este texto. Duplicar geraria duas versões da mesma justificativa
 * contábil, uma delas errada com o tempo.
 */

const formatBrl = (value: number): string =>
  `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** `YYYY-MM-DD` → `DD/MM/AAAA`. A data da correção é etiqueta, não instante. */
const formatDay = (day: string): string => day.split('-').reverse().join('/');

const describe = (correction: {
  amount: number;
  brand: string;
  correctionDate: string;
  correctionId: string;
}): string =>
  `${formatBrl(correction.amount)} na marca ${correction.brand} em ` +
  `${formatDay(correction.correctionDate)} (${correction.correctionId})`;

export const buildCorrectionNote = (params: {
  candidate: CorrectionCandidate;
  itemAmount: number;
}): string => {
  const { candidate, itemAmount } = params;
  const corrections = candidate.corrections.map((correction) => ({
    amount: correction.amountCents / 100,
    brand: correction.brand,
    correctionDate: correction.correctionDate,
    correctionId: correction.correctionId,
  }));

  const clients = [...new Set(candidate.corrections.map((item) => item.clientId))];
  const player = `jogador ${clients.join(' / ')}`;
  const parts = corrections.map(describe).join('; ');

  // `PARTIAL` nunca dá baixa automática, mas a tela oferece o texto como rascunho:
  // ele precisa dizer que o valor **não** confere, senão a nota afirmaria mais do
  // que a evidência sustenta.
  if (candidate.confidence === 'PARTIAL') {
    return trim(
      `Conferir: o ${player} tem correção de saldo para baixo de ${parts}, ` +
        `valor diferente do pagamento de ${formatBrl(itemAmount)}. ` +
        'A correção não explica este débito por si — verificar se houve pagamento ' +
        'parcial ou outra correção fora da janela de 7 dias.',
    );
  }

  if (corrections.length > 1) {
    return trim(
      `Pagamento manual ao ${player}: soma de ${corrections.length} correções de saldo ` +
        `para baixo — ${parts} — totalizando ${formatBrl(candidate.amountCents / 100)}, ` +
        'igual ao débito. Pagamento feito pelo financeiro fora da plataforma, por isso ' +
        'não existe saque para casar.',
    );
  }

  return trim(
    `Pagamento manual ao ${player}: saldo corrigido para baixo em ${parts}, valor igual ` +
      'ao débito. Jogador autoexcluído ou bloqueado não saca pela plataforma, então o ' +
      'financeiro pagou direto pela conta do banco e não há saque para casar.',
  );
};

const trim = (note: string): string => note.slice(0, MAX_NOTE_LENGTH);
