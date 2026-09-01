import { Injectable, Logger } from '@nestjs/common';

import { brtMidnightUtc, nextDay } from '../../../../common/utils/date.util';
import { roundCurrency } from '../../../../common/utils/number.util';
import type { BrandKey } from '../../cash-balance.constants';
import type {
  ClosingBalanceCapture,
  ClosingBalanceSource,
} from '../../domain/ports/closing-balance-source.port';
import { TrioBankingClient, type TrioVirtualAccount } from './trio-banking.client';

/**
 * Saldo de fechamento lido direto da Trio, no instante do corte.
 *
 * ```
 * GET /banking/virtual_accounts/{id}/balances?at_datetime=<meia-noite BRT do dia seguinte>
 * ```
 *
 * Uma requisição por marca, e o valor é o fechamento exato.
 *
 * ── O que este adapter substitui, e por que ─────────────────────────────────
 * A alternativa é **reconstruir** o fechamento (saldo do momento + soma de cada
 * movimento desde o corte), porque a rota de `bank_accounts` não aceita data.
 * Isso errou em 8 dos 18 fechamentos gravados na origem, por −1.044,00 a
 * +140,04 — sem relação com o tamanho da janela usada. A causa exata deixou de
 * importar: este adapter nunca reconstrói.
 *
 * ── Sem estimativa e sem silêncio ───────────────────────────────────────────
 * `exact` é sempre true: não há mais janela para deixar dúvida. Em troca, falha
 * de leitura **propaga**. Não existe caminho de fallback de propósito: o único
 * fallback possível era a reconstrução, que é comprovadamente errada, e gravar
 * um número errado é pior que não gravar.
 */
@Injectable()
export class TrioPointInTimeBalanceSource implements ClosingBalanceSource {
  private readonly logger = new Logger(TrioPointInTimeBalanceSource.name);

  /**
   * `bank_account.id` → conta virtual. A conta virtual de uma conta bancária não
   * muda, então resolver uma vez por processo evita uma requisição por captura.
   */
  private readonly virtualAccounts = new Map<string, TrioVirtualAccount>();

  constructor(private readonly trio: TrioBankingClient) {}

  async capture(brand: BrandKey, referenceDate: string): Promise<ClosingBalanceCapture> {
    const bankAccountId = this.requireAccountId(brand);
    const virtualAccount = await this.resolveVirtualAccount(bankAccountId);

    // O saldo de 23:59:59.999999 de um dia é o saldo em 00:00:00 do dia seguinte.
    const cutoffAt = brtMidnightUtc(nextDay(referenceDate));
    const capturedAt = new Date();

    const cents = await this.trio.readBalanceAtCents(virtualAccount.id, cutoffAt);

    return {
      brand,
      accountId: virtualAccount.id,
      balance: roundCurrency(this.trio.toCurrency(cents)),
      cutoffAt,
      capturedAt,
      exact: true,
      method: 'POINT_IN_TIME',
    };
  }

  private async resolveVirtualAccount(bankAccountId: string): Promise<TrioVirtualAccount> {
    const cached = this.virtualAccounts.get(bankAccountId);
    if (cached) return cached;

    const account = await this.trio.findTransactionalVirtualAccount(bankAccountId);
    this.virtualAccounts.set(bankAccountId, account);

    this.logger.log(
      `Conta virtual da conta ${bankAccountId}: ${account.description} (nº ${account.number})`,
    );

    return account;
  }

  private requireAccountId(brand: BrandKey): string {
    const accountId = this.trio.accountIdFor(brand);
    if (!accountId) throw new Error(`conta Trio não configurada para a marca ${brand}`);
    return accountId;
  }
}
