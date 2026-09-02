import { Injectable, Logger } from '@nestjs/common';

import { ClickHouseService } from '../../../../clickhouse/clickhouse.service';
import { toNumber } from '../../../../common/utils/number.util';
import type { Movement } from '../../domain/reconciliation.types';

/**
 * Lançamentos da plataforma de apostas, linha por linha, para conciliação.
 *
 * `brand` fica `string`, não `BrandKey` — mesma decisão da Fase 10
 * (`reconciliation.repository.types.ts`): este módulo não importa arquivo de
 * outro módulo (decisão 10 do CLAUDE.md), e `BrandKey` só existe em
 * `cash-balance.constants.ts`.
 *
 * ── A chave do casamento vem daqui ──────────────────────────────────────────
 * `gateway_external_id` é o identificador que o gateway gera ao criar a
 * cobrança ou o pagamento, e é o mesmo número que aparece como `external_id`
 * no extrato da Trio — é o que permite abandonar o casamento por valor.
 *
 * ── Por que `FINAL` ─────────────────────────────────────────────────────────
 * `fct_deposit` e `fct_withdrawal` são `ReplacingMergeTree`: sem `FINAL` uma
 * linha ainda não deduplicada apareceria duas vezes e o casamento abriria uma
 * pendência que não existe. Ver DADOS-FINANCE.md §10.
 *
 * ── Por que não filtra `source_system` ──────────────────────────────────────
 * Depósito de outro canal (`enigma`) também cai na mesma conta do banco.
 * Filtrar por um `source_system` específico abriria pendência falsa para
 * qualquer depósito do outro canal — conferido na origem: `bc` + `enigma`
 * somam exatamente o crédito do extrato da Trio no dia.
 *
 * ── Qual instante define o dia (não é o mesmo nas duas tabelas) ─────────────
 * Depósito: `deposit_ts` (aprovação do pagamento). Saque:
 * `coalesce(transaction_date, withdrawal_ts)` — `transaction_date` é o
 * `allow_ts` da **liberação**, `withdrawal_ts` é o `request_ts` do **pedido**.
 * Usar o pedido no lugar da liberação abre diferença de caixa sem pendência
 * para explicar — caso real de R$ 5.755,00 na Ultra, dois saques pedidos às
 * 23:53 de um dia e liberados às 00:05 do dia seguinte.
 *
 * O instante não decide casamento nenhum (a chave decide); ele só define a
 * qual dia o lançamento pertence, que é o que separa a pendência do dia da
 * virada.
 *
 * ── Janela ──────────────────────────────────────────────────────────────────
 * De `D−1` a `D+1` (`[from, to)`), para a chave achar o par quando o banco
 * postou hoje e a plataforma registrou no dia vizinho. `core` é calculado
 * contra a janela núcleo (`coreFrom`/`coreTo`), recebida como parâmetro.
 */

const DEPOSITS_QUERY = `
  SELECT
    deposit_id AS document_id,
    gateway_external_id AS external_key,
    toString(deposit_ts) AS occurred_at,
    toDecimal64(deposit_amount, 2) AS amount
  FROM dw_bet.fct_deposit FINAL
  WHERE brand = {marca:String}
    AND deposit_date >= toDate({dia_inicio:String})
    AND deposit_date <= toDate({dia_fim:String})
    AND deposit_ts >= parseDateTime64BestEffort({inicio:String}, 3, 'UTC')
    AND deposit_ts <  parseDateTime64BestEffort({fim:String}, 3, 'UTC')
    AND state_normalized = 'APPROVED'
`;

const WITHDRAWALS_QUERY = `
  SELECT
    withdrawal_id AS document_id,
    gateway_external_id AS external_key,
    toString(coalesce(transaction_date, withdrawal_ts)) AS occurred_at,
    toDecimal64(withdrawal_amount, 2) AS amount
  FROM dw_bet.fct_withdrawal FINAL
  WHERE brand = {marca:String}
    AND withdrawal_date >= toDate({dia_inicio:String})
    AND withdrawal_date <= toDate({dia_fim:String})
    AND coalesce(transaction_date, withdrawal_ts) >= parseDateTime64BestEffort({inicio:String}, 3, 'UTC')
    AND coalesce(transaction_date, withdrawal_ts) <  parseDateTime64BestEffort({fim:String}, 3, 'UTC')
    AND state_normalized = 'APPROVED'
`;

interface MovementRow {
  document_id: string;
  external_key?: string;
  occurred_at: string;
  amount: unknown;
}

export interface PlatformWindow {
  brand: string;
  /** Início da janela alargada, inclusivo. */
  from: Date;
  /** Fim da janela alargada, exclusivo. */
  to: Date;
  /** Início do dia de referência — o que separa `core` do dia vizinho. */
  coreFrom: Date;
  /** Fim do dia de referência, exclusivo. */
  coreTo: Date;
}

@Injectable()
export class PlatformMovementsService {
  private readonly logger = new Logger(PlatformMovementsService.name);

  constructor(private readonly clickhouse: ClickHouseService) {}

  get isConfigured(): boolean {
    return this.clickhouse.isConfigured;
  }

  /** Depósitos e saques aprovados da janela, já normalizados. */
  async fetchMovements(window: PlatformWindow): Promise<Movement[]> {
    const params = {
      marca: window.brand,
      dia_inicio: window.from.toISOString().slice(0, 10),
      dia_fim: window.to.toISOString().slice(0, 10),
      inicio: window.from.toISOString(),
      fim: window.to.toISOString(),
    };

    const [deposits, withdrawals] = await Promise.all([
      this.clickhouse.query<MovementRow>(DEPOSITS_QUERY, params),
      this.clickhouse.query<MovementRow>(WITHDRAWALS_QUERY, params),
    ]);

    const movements = [
      ...deposits.map((row) => this.toMovement(row, 'DEPOSIT', window)),
      ...withdrawals.map((row) => this.toMovement(row, 'WITHDRAWAL', window)),
    ];

    this.logMovements(window.brand, deposits.length, withdrawals.length, movements);

    return movements;
  }

  private logMovements(
    brand: string,
    depositCount: number,
    withdrawalCount: number,
    movements: Movement[],
  ): void {
    const withoutKey = movements.filter((movement) => !movement.externalKey).length;

    this.logger.log(
      `${brand}: plataforma devolveu ${depositCount} depósitos e ${withdrawalCount} saques na janela` +
        (withoutKey > 0 ? ` — ${withoutKey} sem gateway_external_id` : ''),
    );

    if (withoutKey > 0) {
      this.logger.warn(
        `${brand}: ${withoutKey} lançamentos da plataforma sem gateway_external_id — vão virar pendência por falta de chave`,
      );
    }
  }

  private toMovement(
    row: MovementRow,
    flow: 'DEPOSIT' | 'WITHDRAWAL',
    window: PlatformWindow,
  ): Movement {
    // O ClickHouse devolve DateTime64 sem timezone na string; o mart é UTC.
    const occurredAt = new Date(`${row.occurred_at.replace(' ', 'T')}Z`);

    return {
      side: 'PLATFORM',
      flow,
      key: row.document_id,
      amountCents: Math.round(toNumber(row.amount) * 100),
      core: occurredAt >= window.coreFrom && occurredAt < window.coreTo,
      occurredAt,
      externalKey: row.external_key?.trim() || undefined,
    };
  }
}
