import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';

import { trioConfig } from '../../../../config/configuration';
import type { BrandKey } from '../../domain/cash-balance.types';

/**
 * Cliente da banking-api da Trio (https://docs.trio.com.br).
 *
 * Auth = HTTP Basic: username = client_id, password = client_secret.
 * Não é OAuth. O secret nunca é logado.
 *
 * ── Saldo em um instante: use a rota de conta virtual ───────────────────────
 * `GET /banking/bank_accounts/{id}/balances` devolve só o saldo do agora e
 * rejeita parâmetro de data (`422 Unexpected field`). Já
 * `GET /banking/virtual_accounts/{id}/balances?at_datetime=...` **aceita o
 * instante** e devolve o saldo daquele momento.
 *
 * O id é o da **conta virtual**, não o do `bank_account`. Ele se descobre por
 * `GET /banking/virtual_accounts?bank_account_id=...`, e é o mesmo id que o
 * painel da Trio usa no filtro do extrato.
 *
 * Tudo em centavos: a Trio trafega inteiros e arredondar no meio do caminho
 * introduz erro que se acumula ao somar milhares de transações.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_ATTEMPTS = 4;

/**
 * Teto de requisições por janela somada. Uma noite gasta 1; o backfill de um dia
 * inteiro da conta mais movimentada gasta perto de mil. O teto existe para o
 * caso de a divisão não convergir, não para limitar uso legítimo.
 */
const REQUEST_BUDGET = 20_000;

/** Instantes em microssegundos inteiros (1.8e15 cabe exato em double). */
const toMicros = (at: Date): number => at.getTime() * 1_000;

/** Microssegundos para ISO com 6 casas decimais, formato que a Trio aceita. */
const toIsoMicros = (micros: number): string => {
  const milliseconds = Math.floor(micros / 1_000);
  const remainder = micros - milliseconds * 1_000;
  const base = new Date(milliseconds).toISOString();
  return `${base.slice(0, -1)}${String(remainder).padStart(3, '0')}Z`;
};

interface BalancePayload {
  data?: {
    available_balance?: { amount?: number | string };
  };
}

interface VirtualAccountPayload {
  data?: {
    id?: string;
    status?: string;
    type?: string;
    description?: string;
    number?: string;
  }[];
}

/** Conta virtual de uma conta bancária da Trio. */
export interface TrioVirtualAccount {
  id: string;
  /** Número da conta, o mesmo que aparece no extrato do painel. */
  number: string;
  description: string;
}

/**
 * Lançamento como a Trio devolve.
 *
 * `transaction_date` vem **nulo** no corpo, apesar de o cursor de paginação
 * codificar esse mesmo campo internamente: a API não expõe o instante do
 * lançamento. A precisão temporal disponível é a da janela consultada.
 */
export interface TrioTransaction {
  amount?: { amount?: number | string; currency?: string };
  /** `regular` é o lançamento; `fee` é a tarifa dele, em linha própria. */
  transaction_type?: string;
  /** `credit` entra no saldo, `debit` sai. Concorda com o sinal de `amount`. */
  posting_type?: string;
  reconciliation_id?: string;
  ref_id?: string;
  ref_type?: string;
  end_to_end_id?: string;
  external_id?: string;
  bank_account_id?: string;
  virtual_account_id?: string;
  ledger_account_id?: string;
  counterparty_id?: string;
  counterparty_name?: string;
  counterparty_tax_number?: string;
  document_type?: string;
}

interface TransactionsPayload {
  data?: TrioTransaction[];
  metadata?: { after?: string | null; has_more?: boolean };
}

/**
 * Entrada e saída separadas numa janela.
 *
 * A Trio assina o `amount` pelo efeito no saldo invertido (`delta = -amount`),
 * então `amount` negativo é dinheiro entrando e positivo é saindo.
 */
export interface TransactionFlowSummary {
  inflowCents: number;
  inflowCount: number;
  outflowCents: number;
  outflowCount: number;
  /** Variação do saldo na janela: entrada − saída. */
  netCents: number;
  count: number;
}

@Injectable()
export class TrioBankingClient {
  private readonly logger = new Logger(TrioBankingClient.name);
  private readonly http: AxiosInstance | null;
  private readonly amountDivisor: number;
  private readonly accountIds: ConfigType<typeof trioConfig>['accountIds'];

  constructor(
    @Inject(trioConfig.KEY)
    config: ConfigType<typeof trioConfig>,
  ) {
    this.amountDivisor = config.amountDivisor;
    this.accountIds = config.accountIds;

    if (!config.baseUrl || !config.clientId || !config.clientSecret) {
      this.http = null;
      this.logger.warn('Credenciais da Trio ausentes — captura de fechamento indisponível');
      return;
    }

    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      auth: { username: config.clientId, password: config.clientSecret },
      headers: { Accept: 'application/json' },
    });
  }

  get isConfigured(): boolean {
    return this.http !== null;
  }

  /** Converte centavos da Trio para o valor em reais usado no domínio. */
  toCurrency(cents: number): number {
    return cents / this.amountDivisor;
  }

  accountIdFor(brand: BrandKey): string | undefined {
    return this.accountIds[brand as keyof typeof this.accountIds];
  }

  /**
   * Conta virtual "Transacional" de uma conta bancária.
   *
   * Hoje cada conta bancária do grupo tem exatamente uma conta virtual; se
   * aparecer mais de uma aprovada, este método **falha** em vez de escolher,
   * porque escolher errado significa gravar o saldo da conta errada como
   * fechamento do dia.
   */
  async findTransactionalVirtualAccount(bankAccountId: string): Promise<TrioVirtualAccount> {
    const payload = await this.get<VirtualAccountPayload>('/banking/virtual_accounts', {
      bank_account_id: bankAccountId,
    });

    const approved = (payload.data ?? []).filter((item) => item.status === 'approved' && item.id);

    if (approved.length === 0) {
      throw new Error(`nenhuma conta virtual aprovada para a conta ${bankAccountId}`);
    }

    if (approved.length > 1) {
      throw new Error(
        `${approved.length} contas virtuais aprovadas para a conta ${bankAccountId} — desempate não definido`,
      );
    }

    const account = approved[0];

    return {
      id: account.id as string,
      number: account.number ?? '',
      description: account.description ?? '',
    };
  }

  /**
   * Saldo da conta virtual no instante `at`, em centavos.
   *
   * É a leitura autoritativa do fechamento: com `at` na meia-noite BRT do dia
   * seguinte, devolve o saldo de 23:59:59.999999 do dia de referência.
   */
  async readBalanceAtCents(virtualAccountId: string, at: Date): Promise<number> {
    const payload = await this.get<BalancePayload>(
      `/banking/virtual_accounts/${virtualAccountId}/balances`,
      { at_datetime: at.toISOString() },
    );

    const amount = payload.data?.available_balance?.amount;

    if (typeof amount !== 'number' && typeof amount !== 'string') {
      throw new Error('resposta de saldo da Trio sem available_balance.amount');
    }

    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) throw new Error('saldo da Trio ilegível');

    return parsed;
  }

  /**
   * Lançamentos da janela `[fromInclusive, toExclusive)`, linha por linha.
   *
   * ── Por que evitar o cursor ──────────────────────────────────────────────
   * O cursor `after` codifica apenas `transaction_date`. Cada operação gera duas
   * linhas com o MESMO timestamp (o lançamento e sua tarifa), então quando a
   * borda de página cai no meio de um empate a próxima página começa depois
   * daquele instante e o resto do grupo é perdido. A perda é determinística e
   * silenciosa: medido na Ultra, uma janela de 10h devolveu 5.234 linhas via
   * cursor contra 5.236 reais, faltando um par que valia R$ 7,45.
   *
   * ── Solução ──────────────────────────────────────────────────────────────
   * Nunca paginar: se a janela tem mais de uma página, dividir no meio e varrer
   * as metades. Recursivamente, toda requisição termina com `has_more = false`,
   * que é o único caso em que a resposta é comprovadamente completa.
   *
   * Os dois extremos são inclusivos, por isso a metade de cima começa 1µs
   * depois: sem overlap e sem buraco.
   */
  async listTransactions(
    accountId: string,
    fromInclusive: Date,
    toExclusive: Date,
  ): Promise<TrioTransaction[]> {
    const rows: TrioTransaction[] = [];

    await this.walkWindow(accountId, toMicros(fromInclusive), toMicros(toExclusive) - 1, (row) =>
      rows.push(row),
    );

    return rows;
  }

  /**
   * Entrada e saída da janela `[fromInclusive, toExclusive)`, pela mesma
   * varredura por bisseção.
   */
  async summarizeFlows(
    accountId: string,
    fromInclusive: Date,
    toExclusive: Date,
  ): Promise<TransactionFlowSummary> {
    let inflowCents = 0;
    let inflowCount = 0;
    let outflowCents = 0;
    let outflowCount = 0;
    let count = 0;

    await this.walkWindow(
      accountId,
      toMicros(fromInclusive),
      toMicros(toExclusive) - 1,
      (_row, amount) => {
        if (amount < 0) {
          inflowCents += -amount;
          inflowCount++;
        } else if (amount > 0) {
          outflowCents += amount;
          outflowCount++;
        }
        count++;
      },
    );

    return {
      inflowCents,
      inflowCount,
      outflowCents,
      outflowCount,
      netCents: inflowCents - outflowCents,
      count,
    };
  }

  /** Varredura por bisseção da janela, um callback por lançamento. */
  private async walkWindow(
    accountId: string,
    fromMicros: number,
    toMicros: number,
    onRow: (row: TrioTransaction, amountCents: number) => void,
  ): Promise<void> {
    const pending: Array<[number, number]> = [[fromMicros, toMicros]];
    let requests = 0;

    while (pending.length > 0) {
      const [start, end] = pending.pop() as [number, number];
      if (start > end) continue;

      if (++requests > REQUEST_BUDGET) {
        throw new Error(`janela de transações excedeu ${REQUEST_BUDGET} requisições`);
      }

      const payload = await this.get<TransactionsPayload>(
        `/banking/bank_accounts/${accountId}/transactions`,
        { from_datetime: toIsoMicros(start), to_datetime: toIsoMicros(end) },
      );

      if (payload.metadata?.has_more === true) {
        if (start === end) {
          // Mais de uma página no mesmo microssegundo: não há como dividir.
          throw new Error(
            `mais de 50 lançamentos no instante ${toIsoMicros(start)} — janela indivisível`,
          );
        }

        const middle = start + Math.floor((end - start) / 2);
        pending.push([middle + 1, end], [start, middle]);
        continue;
      }

      for (const row of payload.data ?? []) {
        const amount = Number(row.amount?.amount ?? 0);
        if (!Number.isFinite(amount)) throw new Error('transação da Trio com amount ilegível');
        onRow(row, amount);
      }
    }
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.http) throw new Error('integração Trio não configurada');

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await this.http.get<T>(path, { params });
        return response.data;
      } catch (error) {
        lastError = error;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;

        // 4xx que não seja 429 é erro de contrato: repetir não resolve.
        if (status !== undefined && status !== 429 && status < 500) break;
        if (attempt < RETRY_ATTEMPTS) await this.delay(attempt * 1_000);
      }
    }

    // Nunca logar credenciais nem o corpo da resposta.
    const status = axios.isAxiosError(lastError) ? lastError.response?.status : undefined;
    throw new Error(`Trio respondeu ${status ?? 'erro de rede'} em ${path}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
