/**
 * Configuração da conciliação bancária.
 *
 * O que a conciliação faz: para cada dia + marca, compara o que a plataforma
 * de apostas registrou (depósito aprovado e saque aprovado) com o que o extrato
 * do banco mostra (crédito e débito). O que sobra de um lado só é pendência e
 * tem que ser tratado por um operador com uma nota.
 */

/** Único banco conciliado por integração hoje. Os outros virão por CSV. */
export const RECONCILIATION_BANK_TRIO = 'trio';

/**
 * Dias vizinhos incluídos na consulta da plataforma.
 *
 * O banco é varrido só no dia de referência, porque a varredura é caríssima. A
 * plataforma é uma consulta barata, então vai de `D−1` a `D+1`: assim o
 * lançamento que o banco postou hoje e a plataforma registrou no dia vizinho
 * encontra o par pela chave, em vez de virar pendência falsa nos dois dias.
 */
export const PLATFORM_NEIGHBOUR_DAYS = 1;

/**
 * CNPJ dos titulares das contas do grupo.
 *
 * Débito cuja contraparte é o próprio titular é transferência de tesouraria
 * (a retirada do excedente da conta transacional), não saque de jogador. Não
 * tem contrapartida na plataforma e por isso nunca pode virar pendência.
 */
export const OWN_TAX_NUMBERS: readonly string[] = ['56183358000151'];

/** `regular` é o lançamento; `fee` é a tarifa dele, em linha própria. */
export const BANK_TYPE_REGULAR = 'regular';
export const BANK_TYPE_FEE = 'fee';

/**
 * ── Estorno bancário (`ref_type` da Trio) ───────────────────────────────────
 *
 * `ref_type` diz **que operação** a linha é, coisa que o sinal do valor não diz:
 * - `collection` é cobrança (crédito): depósito de jogador
 * - `payment` é pagamento (débito): saque de jogador
 * - `payment_refund` é a **devolução de um pagamento**: crédito na conta com o
 *   mesmo `external_id` do débito original
 *
 * O estorno liquida: ele, o lançamento original do banco e o lançamento
 * correspondente da plataforma saem da conciliação juntos, porque o efeito
 * líquido dos três é zero. Ver `domain/refund-settlement.ts`.
 */
export const BANK_REF_TYPE_COLLECTION = 'collection';
export const BANK_REF_TYPE_PAYMENT = 'payment';
export const BANK_REF_TYPE_PAYMENT_REFUND = 'payment_refund';
export const BANK_REF_TYPE_COLLECTION_REFUND = 'collection_refund';

/**
 * Sufixo que identifica estorno em qualquer `ref_type`.
 *
 * Cobre `collection_refund` (devolução de depósito ao jogador) sem precisar de
 * código novo se ele aparecer: o tratamento é o mesmo em qualquer fluxo, porque
 * a operação inteira é desfeita.
 */
export const BANK_REF_TYPE_REFUND_SUFFIX = '_refund';

/**
 * Autor gravado no tratamento automático de estorno.
 *
 * Não é um `userId`: é o rastro de que nenhum operador olhou a linha. A
 * pendência entra como `RESOLVED` para não bloquear o fechamento do dia, e fica
 * na lista de tratadas para auditoria — estorno silencioso seria pior que
 * pendência falsa.
 */
export const SYSTEM_ACTOR = 'sistema';

/**
 * Teto de pendências devolvidas numa resposta. A tela não pagina, e um dia
 * saudável tem unidades de pendência: se passar disso o problema é sistêmico
 * e a lista deixa de ser a ferramenta certa. A resposta avisa quando truncou.
 */
export const MAX_ITEMS_IN_RESPONSE = 500;

/** A nota de tratamento é o registro do que aconteceu — não aceita rabisco. */
export const MIN_NOTE_LENGTH = 10;
export const MAX_NOTE_LENGTH = 1_000;

/**
 * Campo do extrato do banco que corresponde ao `gateway_external_id` do mart.
 *
 * `external_id` é o certo para a Trio: é o identificador que o gateway gera
 * quando cria a cobrança ou o pagamento, e é o mesmo número que o warehouse
 * expõe em `fct_deposit.gateway_external_id` e `fct_withdrawal.gateway_external_id`.
 *
 * `end_to_end_id` fica como alternativa para os bancos que virão por CSV.
 * `ref_id` é interno da Trio e só serve de último recurso.
 */
export const BANK_KEY_FIELDS = ['external_id', 'end_to_end_id', 'ref_id'] as const;

export type BankKeyField = (typeof BANK_KEY_FIELDS)[number];

export const DEFAULT_BANK_KEY_FIELD: BankKeyField = 'external_id';

/**
 * ── Busca de correção de saldo (`dw_bet.fct_correction`) ────────────────────
 *
 * O setor financeiro paga manualmente, pela conta da Trio, o jogador que se
 * autoexcluiu ou foi bloqueado — ele não consegue sacar pela plataforma. Antes
 * de pagar, o backoffice zera o saldo dele com uma correção para baixo. O
 * pagamento aparece no extrato do banco e **não tem saque na plataforma**, logo
 * vira pendência do lado `BANK`. A correção é a explicação, e é o que a busca
 * procura.
 *
 * Nada aqui dá baixa automática: a busca devolve **evidência** e o operador
 * decide na tela.
 */

/** Só correção para baixo interessa: é a que precede o pagamento manual. */
export const CORRECTION_DIRECTION_DOWN = 'down';

/**
 * Janela de busca: `D−7` até `D`, onde `D` é o dia do pagamento no banco.
 */
export const CORRECTION_LOOKBACK_DAYS = 7;

/**
 * Quantas correções podem ser somadas para explicar um pagamento.
 *
 * A licença brasileira dá 3 marcas ao mesmo grupo, então o mesmo CPF pode ter
 * saldo corrigido em até três e receber um pagamento só pela soma.
 */
export const MAX_CORRECTION_COMBINATION_SIZE = 3;

/**
 * Acima disso, não tenta somar. Combinação é exponencial no tamanho da lista, e
 * CPF com mais de uma dúzia de correções na janela é caso para investigar à mão,
 * não para o palpite da máquina acertar.
 */
export const MAX_CORRECTIONS_FOR_COMBINATION = 12;

/** Candidatos devolvidos por pendência. Mais que isso não é evidência, é lista. */
export const MAX_CORRECTION_CANDIDATES = 5;
