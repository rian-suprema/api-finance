import { BANK_REF_TYPE_REFUND_SUFFIX, MAX_NOTE_LENGTH } from '../reconciliation.constants';
import { roundCurrency } from '../../../common/utils/number.util';
import type { Movement, SettledMovement, SideTotals } from './reconciliation.types';

/**
 * Liquidação de estorno bancário. Lógica pura, como o `matcher`: recebe as duas
 * listas de lançamentos e devolve as listas sem o que o estorno anulou.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 * Quando o banco devolve um pagamento, o extrato ganha um **crédito** com o
 * mesmo `external_id` do débito original e `ref_type = payment_refund`. Como a
 * classificação por sinal transforma todo crédito em depósito, esse crédito ia
 * procurar um depósito com a chave de um saque, não achava par e abria pendência
 * "não está na plataforma". Incidente real: saque de R$ 1.000,00 devolvido pelo
 * banco, chave 778446251.
 *
 * ── Por que liquidar os três lançamentos, e não só o estorno ────────────────
 * A operação foi desfeita: o dinheiro saiu e voltou. Sobram três linhas do mesmo
 * `external_id` — o saque da plataforma, o débito do banco e o crédito do
 * estorno — e a soma delas no caixa é zero. Tirar só o estorno deixaria o débito
 * casado com um saque que não aconteceu, e tirar só as duas linhas do banco
 * deixaria o saque da plataforma órfão, virando uma pendência nova no lugar da
 * antiga. Os três saem juntos ou nenhum sai.
 *
 * Consequência nos totais, deliberada: `bankWithdrawals` e `platformWithdrawals`
 * passam a significar *o que de fato saiu para jogadores*, não o bruto do
 * extrato. É o número sobre o qual o operador decide.
 *
 * ── O que a liquidação **não** resolve, e por isso sinaliza ─────────────────
 * O banco desfez a operação; a plataforma não sabe disso. O saque continua
 * `APPROVED` no mart, então o jogador teve saldo debitado por um pagamento que
 * não chegou a ele. O caixa está fechado, mas alguém precisa reprocessar o saque
 * ou devolver o saldo — e isso o módulo não faz, porque não escreve na
 * plataforma.
 *
 * Como o mart só devolve lançamento aprovado, achar a operação do outro lado
 * **já é** a prova de que nada foi revertido lá: `platformReprocessPending` sai
 * daí, sem consulta nova ao warehouse. A tela mostra como aviso, nunca como
 * pendência de caixa, para o operador cobrar o time de pagamentos.
 *
 * ── O que não é liquidado ───────────────────────────────────────────────────
 * Estorno **sem chave** não liquida nada: sem `external_id` não há como saber
 * qual operação foi desfeita, e adivinhar é o defeito que o casamento por valor
 * tinha. Ele segue para o casamento e vira pendência, como qualquer lançamento
 * sem chave.
 *
 * Quando o débito original caiu num dia anterior (o extrato é varrido só no dia
 * de referência), só o estorno é encontrado aqui. Ele é liquidado do mesmo jeito
 * e a nota registra que o original ficou fora da janela: o par dele já foi
 * conciliado no dia dele, e reabrir aquele dia por causa da devolução seria
 * mexer num fechamento pronto.
 */

export interface RefundSettlement {
  /** Lançamentos da plataforma que seguem para o casamento. */
  platform: Movement[];
  /** Lançamentos do banco que seguem para o casamento. */
  bank: Movement[];
  /** Estornos liquidados, com a nota — vão para a tela já tratados. */
  settled: SettledMovement[];
  /** Soma e contagem dos estornos liquidados, para o log. */
  totals: SideTotals;
}

const isRefund = (movement: Movement): boolean =>
  (movement.refType ?? '').endsWith(BANK_REF_TYPE_REFUND_SUFFIX);

const formatBrl = (cents: number): string =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Nota do tratamento automático.
 *
 * Diz o que aconteceu, com que chave e o que saiu junto, porque é o que um
 * auditor precisa para reencontrar a operação no extrato. E diz o que sobra do
 * outro lado: quando a operação **continua aprovada na plataforma**, o jogador
 * teve saldo movimentado por um pagamento que o banco desfez. Isso não é
 * problema de conciliação, mas é o problema real, e a nota é onde o operador o
 * encontra.
 */
export const buildRefundNote = (params: {
  refund: Movement;
  originalFoundInWindow: boolean;
  platformStillApproved: boolean;
}): string => {
  const { refund, originalFoundInWindow, platformStillApproved } = params;
  const key = refund.externalKey ?? refund.key;

  const alsoRemoved = [
    originalFoundInWindow ? 'o lançamento original do extrato' : null,
    platformStillApproved ? 'o lançamento da plataforma' : null,
  ].filter((part): part is string => part !== null);

  const scope = alsoRemoved.length
    ? `Saíram da conciliação junto com esta linha: ${alsoRemoved.join(' e ')}.`
    : 'O lançamento original está fora da janela deste dia (foi conciliado no dia dele), ' +
      'então só a devolução saiu daqui.';

  // O mart só devolve lançamento aprovado, então achar a operação do outro lado
  // já é a prova de que a plataforma não reverteu nada.
  const platform = platformStillApproved
    ? 'ATENÇÃO: a operação segue APROVADA na plataforma, que não sabe da devolução. ' +
      'O saldo do jogador foi movimentado por um pagamento que o banco desfez — ' +
      'pagamentos precisa reprocessar a operação ou devolver o saldo. O caixa do dia ' +
      'não depende disso.'
    : 'A plataforma não tem a operação aprovada nesta janela, então não há ' +
      'reprocessamento a cobrar por aqui.';

  const note =
    `Estorno bancário (${refund.refType}) de ${formatBrl(refund.amountCents)} na chave ` +
    `${key}: o banco devolveu uma operação que já havia liquidado, então o efeito no ` +
    `caixa é zero e não há divergência a apurar. ${scope} ${platform}`;

  return note.slice(0, MAX_NOTE_LENGTH);
};

/**
 * Remove das duas pontas tudo que um estorno anulou.
 *
 * A chave do estorno é a mesma do lançamento original, então basta juntar as
 * chaves estornadas e filtrar os dois lados por elas.
 */
export const settleRefunds = (platform: Movement[], bank: Movement[]): RefundSettlement => {
  const refunds = bank.filter((movement) => isRefund(movement) && movement.externalKey);

  if (refunds.length === 0) {
    return { platform, bank, settled: [], totals: { total: 0, count: 0 } };
  }

  const settledKeys = new Set(refunds.map((movement) => movement.externalKey as string));
  const hasSettledKey = (movement: Movement): boolean =>
    Boolean(movement.externalKey) && settledKeys.has(movement.externalKey as string);

  const settled = refunds.map((refund) => {
    // Por chave **deste** estorno, não pelo conjunto de todas as chaves
    // estornadas: com dois estornos no mesmo dia, o conjunto diria que qualquer
    // um deles tem par na plataforma.
    const sameKey = (movement: Movement): boolean => movement.externalKey === refund.externalKey;

    // A presença do lançamento do outro lado é a prova de que a plataforma
    // segue com a operação aprovada — sem consulta nova ao warehouse.
    const platformStillApproved = platform.some(sameKey);

    return {
      movement: refund,
      platformReprocessPending: platformStillApproved,
      note: buildRefundNote({
        refund,
        originalFoundInWindow: bank.some(
          (movement) => movement !== refund && !isRefund(movement) && sameKey(movement),
        ),
        platformStillApproved,
      }),
    };
  });

  const cents = refunds.reduce((total, movement) => total + movement.amountCents, 0);

  return {
    platform: platform.filter((movement) => !hasSettledKey(movement)),
    bank: bank.filter((movement) => !hasSettledKey(movement)),
    settled,
    totals: { total: roundCurrency(cents / 100), count: refunds.length },
  };
};
