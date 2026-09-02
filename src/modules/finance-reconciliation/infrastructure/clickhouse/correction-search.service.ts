import { Injectable, Logger } from '@nestjs/common';

import { ClickHouseService } from '../../../../clickhouse/clickhouse.service';
import { toNumber } from '../../../../common/utils/number.util';
import type { CorrectionEntry } from '../../domain/correction-matcher';
import { CORRECTION_DIRECTION_DOWN } from '../../reconciliation.constants';

/**
 * Correções de saldo do backoffice, para explicar pagamento manual que não
 * passou pela plataforma.
 *
 * ── Duas consultas, e a primeira existe só por falta de coluna ──────────────
 * `fct_correction` identifica o jogador por `client_id`. A pendência do lado
 * do banco só tem o CPF da contraparte (o extrato da Trio não informa
 * `client_id`) — quando o pagamento não tem saque na plataforma, não existe
 * `client_id` nenhum para exibir. `CORRECTIONS_BY_TAX_NUMBER_QUERY` é o
 * caminho definitivo (a coluna `cpf` de `fct_correction`, quando preenchida);
 * `CLIENT_BRIDGE_QUERY` é a ponte via `fct_withdrawal.pix_key` de tipo CPF
 * (o CPF que o jogador usou como chave PIX em algum saque anterior) — só
 * alcança quem já sacou pela plataforma. Ver DADOS-FINANCE.md §10.
 *
 * ── Por que `FINAL` ────────────────────────────────────────────────────────
 * Mesma razão do casamento: `ReplacingMergeTree`, e linha não deduplicada
 * viraria correção contada duas vezes numa soma.
 *
 * Nunca logar o CPF — só contagens.
 */

/** Correções que já trazem o CPF na própria linha — o caminho definitivo. */
const CORRECTIONS_BY_TAX_NUMBER_QUERY = `
  SELECT
    replaceRegexpAll(ifNull(cpf, ''), '[^0-9]', '') AS tax_number,
    correction_id,
    brand,
    toString(client_id) AS client_id,
    toString(correction_date) AS correction_day,
    toString(correction_ts) AS occurred_at,
    toDecimal64(correction_amount, 2) AS amount
  FROM dw_bet.fct_correction FINAL
  WHERE correction_direction = {direcao:String}
    AND correction_date >= toDate({dia_inicio:String})
    AND correction_date <= toDate({dia_fim:String})
    AND replaceRegexpAll(ifNull(cpf, ''), '[^0-9]', '') IN ({documentos:Array(String)})
  ORDER BY correction_date, correction_id
`;

/**
 * CPF (chave PIX) → `client_id`, em todas as marcas do grupo.
 *
 * `DISTINCT`, não `any()`: se o mesmo CPF tiver duas contas na mesma marca,
 * as duas entram na busca. Preferir uma esconderia a correção da outra.
 */
const CLIENT_BRIDGE_QUERY = `
  SELECT DISTINCT
    replaceRegexpAll(pix_key, '[^0-9]', '') AS tax_number,
    brand,
    toString(client_id) AS client_id
  FROM dw_bet.fct_withdrawal FINAL
  WHERE pix_key_type = 'CPF'
    AND client_id IS NOT NULL
    AND replaceRegexpAll(pix_key, '[^0-9]', '') IN ({documentos:Array(String)})
`;

/**
 * `correction_amount` é sempre positivo; o sentido está em
 * `correction_direction` (`down` = tirou saldo do jogador, `up` = devolveu).
 */
const CORRECTIONS_QUERY = `
  SELECT
    correction_id,
    brand,
    toString(client_id) AS client_id,
    -- Alias diferente da coluna de propósito: chamar de \`correction_date\` faz
    -- o ClickHouse resolver o nome do WHERE para este \`toString\`, e o filtro
    -- de data quebra com "no supertype for types String, Date".
    toString(correction_date) AS correction_day,
    toString(correction_ts) AS occurred_at,
    toDecimal64(correction_amount, 2) AS amount
  FROM dw_bet.fct_correction FINAL
  WHERE correction_direction = {direcao:String}
    AND correction_date >= toDate({dia_inicio:String})
    AND correction_date <= toDate({dia_fim:String})
    AND toString(client_id) IN ({clientes:Array(String)})
  ORDER BY correction_date, correction_id
`;

interface BridgeRow {
  tax_number: string;
  brand: string;
  client_id: string;
}

interface CorrectionRow {
  correction_id: string;
  brand: string;
  client_id: string;
  correction_day: string;
  occurred_at: string | null;
  amount: unknown;
}

/** Um jogador de uma marca, alcançado pelo CPF da chave PIX. */
export interface CorrectionClient {
  taxNumber: string;
  brand: string;
  clientId: string;
}

/** Correção que já veio com o CPF na linha — dispensa a ponte. */
export interface CorrectionEntryByTaxNumber extends CorrectionEntry {
  taxNumber: string;
}

@Injectable()
export class CorrectionSearchService {
  private readonly logger = new Logger(CorrectionSearchService.name);

  constructor(private readonly clickhouse: ClickHouseService) {}

  get isConfigured(): boolean {
    return this.clickhouse.isConfigured;
  }

  /**
   * Correções para baixo que já trazem um destes CPFs na própria linha.
   * Caminho preferencial: não passa por `client_id` nem por junção nenhuma.
   */
  async fetchDownCorrectionsByTaxNumber(params: {
    taxNumbers: string[];
    from: string;
    to: string;
  }): Promise<CorrectionEntryByTaxNumber[]> {
    if (params.taxNumbers.length === 0) return [];

    const rows = await this.clickhouse.query<CorrectionRow & { tax_number: string }>(
      CORRECTIONS_BY_TAX_NUMBER_QUERY,
      {
        direcao: CORRECTION_DIRECTION_DOWN,
        dia_inicio: params.from,
        dia_fim: params.to,
        documentos: params.taxNumbers,
      },
    );

    this.logger.log(
      `Correções com CPF na linha de ${params.from} a ${params.to}: ${rows.length} para ${params.taxNumbers.length} documentos`,
    );

    return rows.map((row) => ({ ...this.toEntry(row), taxNumber: row.tax_number }));
  }

  /** CPFs → contas de jogador, em qualquer marca do grupo. */
  async resolveClients(taxNumbers: string[]): Promise<CorrectionClient[]> {
    if (taxNumbers.length === 0) return [];

    const rows = await this.clickhouse.query<BridgeRow>(CLIENT_BRIDGE_QUERY, {
      documentos: taxNumbers,
    });

    // Nunca logar o CPF: só a contagem, que é o que importa para operar.
    this.logger.log(
      `Ponte CPF → client_id: ${rows.length} contas para ${taxNumbers.length} documentos`,
    );

    return rows.map((row) => ({
      taxNumber: row.tax_number,
      brand: row.brand,
      clientId: row.client_id,
    }));
  }

  /** Correções para baixo dos jogadores informados, na janela. */
  async fetchDownCorrections(params: {
    clientIds: string[];
    from: string;
    to: string;
  }): Promise<CorrectionEntry[]> {
    if (params.clientIds.length === 0) return [];

    const rows = await this.clickhouse.query<CorrectionRow>(CORRECTIONS_QUERY, {
      direcao: CORRECTION_DIRECTION_DOWN,
      dia_inicio: params.from,
      dia_fim: params.to,
      clientes: params.clientIds,
    });

    this.logger.log(
      `Correções para baixo de ${params.from} a ${params.to}: ${rows.length} linhas para ${params.clientIds.length} jogadores`,
    );

    return rows.map((row) => this.toEntry(row));
  }

  private toEntry(row: CorrectionRow): CorrectionEntry {
    return {
      correctionId: row.correction_id,
      brand: row.brand,
      clientId: row.client_id,
      correctionDate: row.correction_day,
      // O mart grava em UTC e devolve sem timezone na string, como na outra consulta do módulo.
      occurredAt: row.occurred_at ? new Date(`${row.occurred_at.replace(' ', 'T')}Z`) : null,
      amountCents: Math.round(toNumber(row.amount) * 100),
    };
  }
}
