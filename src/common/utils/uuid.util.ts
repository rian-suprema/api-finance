/**
 * Instante embutido num identificador do tipo UUIDv7.
 *
 * Os 48 primeiros bits são o epoch em milissegundos. A Trio usa esse formato no
 * `ref_id` e no `reconciliation_id` do extrato, e é a única forma de saber a hora
 * de um lançamento: o corpo da resposta traz `transaction_date` **nulo** em toda
 * linha.
 *
 * Os bits de versão **não** vêm setados nos ids da Trio, então não dá para
 * validar por versão — a validação é a plausibilidade da data.
 *
 * O instante é o da **criação do registro**, não o da postagem — por isso a
 * tela chama esse valor de "hora do PIX", não de hora do lançamento.
 */

const UUID_TIMESTAMP_HEX_LENGTH = 12;

/** Janela de sanidade: fora dela o id não é UUIDv7 e o valor não é instante. */
const MIN_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);
const MAX_PLAUSIBLE_MS = Date.UTC(2100, 0, 1);

export function timestampFromUuidV7(uuid: string | undefined): Date | undefined {
  if (!uuid) return undefined;

  const hex = uuid.replace(/-/g, '').slice(0, UUID_TIMESTAMP_HEX_LENGTH);
  if (hex.length < UUID_TIMESTAMP_HEX_LENGTH || !/^[0-9a-f]+$/i.test(hex)) return undefined;

  const milliseconds = parseInt(hex, 16);
  if (!Number.isFinite(milliseconds)) return undefined;
  if (milliseconds < MIN_PLAUSIBLE_MS || milliseconds > MAX_PLAUSIBLE_MS) return undefined;

  return new Date(milliseconds);
}
