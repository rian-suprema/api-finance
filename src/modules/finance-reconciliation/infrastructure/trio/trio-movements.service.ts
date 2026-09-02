import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  TrioBankingClient,
  type TrioTransaction,
} from '../../../finance-cash-balance/infrastructure/trio/trio-banking.client';
import { roundCurrency } from '../../../../common/utils/number.util';
import { timestampFromUuidV7 } from '../../../../common/utils/uuid.util';
import type { Movement, SideTotals } from '../../domain/reconciliation.types';
import {
  BANK_KEY_FIELDS,
  BANK_REF_TYPE_PAYMENT,
  BANK_REF_TYPE_REFUND_SUFFIX,
  BANK_TYPE_FEE,
  BANK_TYPE_REGULAR,
  DEFAULT_BANK_KEY_FIELD,
  OWN_TAX_NUMBERS,
  type BankKeyField,
} from '../../reconciliation.constants';

/**
 * Extrato da Trio normalizado em lançamentos de conciliação — o lado `BANK`
 * do casamento.
 *
 * `TrioBankingClient` vive em `finance-cash-balance` (Fase 06); este arquivo
 * o injeta via `CashBalanceModule` exportado (`reconciliation.module.ts`
 * importa `CashBalanceModule`) — colaboração entre módulos só via provider
 * exportado, nunca duplicando o cliente/a lógica de bisseção.
 *
 * ── Uma janela, o dia de referência ─────────────────────────────────────────
 * A Trio devolve `transaction_date` **nulo** em cada lançamento, então a
 * precisão temporal disponível é a da janela consultada. Por isso qualquer
 * lançamento daqui é `core`. Quem cobre a virada da meia-noite é o lado da
 * plataforma (`PLATFORM_NEIGHBOUR_DAYS`, Fase 11) — a varredura por bisseção
 * de um dia movimentado já é cara o bastante sem folga de borda.
 *
 * ── Classificação, nesta ordem de prioridade ────────────────────────────────
 * A Trio assina `amount` invertido em relação ao saldo (negativo é dinheiro
 * entrando, positivo é saindo):
 * 1. contraparte no CNPJ próprio (`OWN_TAX_NUMBERS`) → `TREASURY`, **antes de
 *    qualquer outra regra** — tesouraria nunca é pendência, independente do
 *    sinal ou do `ref_type`.
 * 2. estorno (`ref_type` termina em `_refund`) → herda o fluxo da operação
 *    original pelo **prefixo** do `ref_type` (`payment_refund` → saque,
 *    `collection_refund` → depósito), nunca pelo sinal — um estorno de saque é
 *    um crédito, e classificá-lo como depósito abre pendência falsa contra a
 *    chave errada (incidente real de 15/08/2026 na Maxima, chave 778446251).
 * 3. sinal do valor — o caso comum.
 */

export interface BankMovements {
  movements: Movement[];
  fees: SideTotals;
}

@Injectable()
export class TrioMovementsService {
  private readonly logger = new Logger(TrioMovementsService.name);
  private readonly keyField: BankKeyField;

  constructor(
    private readonly trio: TrioBankingClient,
    private readonly config: ConfigService,
  ) {
    const configured = this.config.get<string>('RECONCILIATION_BANK_KEY_FIELD');

    this.keyField = BANK_KEY_FIELDS.includes(configured as BankKeyField)
      ? (configured as BankKeyField)
      : DEFAULT_BANK_KEY_FIELD;

    if (configured && configured !== this.keyField) {
      this.logger.error(
        `RECONCILIATION_BANK_KEY_FIELD inválido ("${configured}") — usando ${this.keyField}`,
      );
    }
  }

  get isConfigured(): boolean {
    return this.trio.isConfigured;
  }

  accountIdFor(brand: string): string | undefined {
    // `TrioBankingClient.accountIdFor` exige `BrandKey` (cash-balance.constants,
    // outro módulo) — cast estrutural em vez de importar o tipo, mesma decisão
    // das Fases 10/11 de manter `brand` como `string` nesta camada.
    return this.trio.accountIdFor(brand as Parameters<TrioBankingClient['accountIdFor']>[0]);
  }

  async fetchMovements(params: {
    brand: string;
    accountId: string;
    coreFrom: Date;
    coreTo: Date;
  }): Promise<BankMovements> {
    const transactions = await this.trio.listTransactions(
      params.accountId,
      params.coreFrom,
      params.coreTo,
    );

    const { movements, feeCents, feeCount } = this.classify(transactions);

    this.logMovements(params.brand, movements, feeCount);

    return {
      movements,
      fees: { total: roundCurrency(this.trio.toCurrency(feeCents)), count: feeCount },
    };
  }

  private classify(transactions: TrioTransaction[]): {
    movements: Movement[];
    feeCents: number;
    feeCount: number;
  } {
    const movements: Movement[] = [];
    let feeCents = 0;
    let feeCount = 0;

    for (const transaction of transactions) {
      const cents = Number(transaction.amount?.amount ?? 0);
      if (cents === 0) continue;

      if (transaction.transaction_type === BANK_TYPE_FEE) {
        feeCents += Math.abs(cents);
        feeCount++;
        continue;
      }

      if (transaction.transaction_type !== BANK_TYPE_REGULAR) continue;

      movements.push(this.toMovement(transaction, cents));
    }

    return { movements, feeCents, feeCount };
  }

  private logMovements(brand: string, movements: Movement[], feeCount: number): void {
    // Tesouraria fica fora da contagem: ela nunca entra no casamento, então
    // não precisa de chave. Transferência feita pelo painel da Trio vem com
    // `external_id` vazio ou com texto (`"Pix Console <uuid>"`), e avisar
    // sobre ela seria alarme falso em toda execução.
    const withoutKey = movements.filter(
      (movement) => movement.flow !== 'TREASURY' && !movement.externalKey,
    ).length;

    this.logger.log(
      `${brand}: banco devolveu ${movements.length} lançamentos e ${feeCount} tarifas no dia` +
        (withoutKey > 0 ? ` — ${withoutKey} sem ${this.keyField}` : ''),
    );

    if (withoutKey > 0) {
      this.logger.warn(
        `${brand}: ${withoutKey} lançamentos do extrato sem ${this.keyField} — vão virar pendência por falta de chave`,
      );
    }
  }

  private toMovement(transaction: TrioTransaction, cents: number): Movement {
    const taxNumber = transaction.counterparty_tax_number ?? '';

    return {
      side: 'BANK',
      flow: this.flowOf(cents, taxNumber, transaction.ref_type),
      key: transaction.ref_id ?? transaction.reconciliation_id ?? transaction.end_to_end_id ?? '',
      // `toCurrency` normaliza a escala da env; daqui para centavo é sempre ×100.
      amountCents: Math.abs(Math.round(this.trio.toCurrency(cents) * 100)),
      // A Trio não datura a linha: quem define o dia é a janela consultada, e
      // aqui a janela é sempre o dia de referência.
      core: true,
      // `transaction_date` vem nulo, mas o `ref_id` é UUIDv7 e carrega o
      // instante em milissegundos — a hora do PIX.
      occurredAt: timestampFromUuidV7(transaction.ref_id),
      externalKey: this.externalKeyOf(transaction),
      endToEndId: transaction.end_to_end_id,
      counterpartyName: transaction.counterparty_name,
      counterpartyTaxNumber: taxNumber || undefined,
      refType: transaction.ref_type?.trim() || undefined,
    };
  }

  /**
   * Fluxo do lançamento — ver a ordem de prioridade no comentário do arquivo.
   * O estorno nem chega ao casamento (é liquidado antes, em `settleRefunds`,
   * domínio da Fase 01), mas o fluxo certo é o que mantém os totais coerentes
   * e a pendência no lugar certo quando o estorno aparece sem chave.
   */
  private flowOf(cents: number, taxNumber: string, refType?: string): Movement['flow'] {
    if (OWN_TAX_NUMBERS.includes(taxNumber)) return 'TREASURY';

    if (refType?.endsWith(BANK_REF_TYPE_REFUND_SUFFIX)) {
      return refType.startsWith(BANK_REF_TYPE_PAYMENT) ? 'WITHDRAWAL' : 'DEPOSIT';
    }

    // Convenção da Trio: `amount` negativo é dinheiro entrando.
    return cents < 0 ? 'DEPOSIT' : 'WITHDRAWAL';
  }

  /**
   * Chave do casamento. `external_id` é o número do gateway, o mesmo que o
   * mart expõe em `gateway_external_id`. Os outros dois campos ficam
   * configuráveis para os bancos que virão por CSV.
   */
  private externalKeyOf(transaction: TrioTransaction): string | undefined {
    const byField: Record<BankKeyField, string | undefined> = {
      external_id: transaction.external_id,
      end_to_end_id: transaction.end_to_end_id,
      ref_id: transaction.ref_id,
    };

    return byField[this.keyField]?.trim() || undefined;
  }
}
