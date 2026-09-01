import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { roundCurrency } from '../../../../common/utils/number.util';
import { BRANDS, MANUAL_BANKS, TRIO_BANK_KEY, type BrandKey } from '../../cash-balance.constants';
import { CashBalanceRepository } from '../../infrastructure/cash-balance.repository';
import type { BankEntryRecord } from '../../infrastructure/cash-balance.repository.types';
import { ClickHouseReadService } from '../../infrastructure/clickhouse/clickhouse-read.service';
import type { RegisterBrandResult } from '../cash-balance.types';
import { RefreshTrioUseCase } from './refresh-trio.use-case';

/**
 * Cada banco manual precisa estar confirmado: sem isso o registro é
 * recusado. Função pura, sem I/O — usada tanto no pré-check (fail-fast, fora
 * da transação, com o `findDay` de antes) quanto na validação AUTORITATIVA
 * dentro da transação de `registerBrand`, contra as linhas já travadas
 * (`SELECT ... FOR UPDATE`). O pré-check pode estar desatualizado (é só
 * otimização, evita pagar Trio/ClickHouse à toa); a validação sob lock é a
 * única que decide o que de fato é persistido.
 */
function extractManualBalances(entries: BankEntryRecord[]): Map<string, number> {
  const balances = new Map<string, number>();

  for (const entry of entries) {
    if (entry.confirmed && entry.bank !== TRIO_BANK_KEY) {
      balances.set(entry.bank, entry.balance);
    }
  }

  const missing = MANUAL_BANKS.filter((bank) => !balances.has(bank.key)).map((bank) => bank.key);

  if (missing.length) {
    throw new BadRequestException({
      message: 'Todos os bancos da marca precisam ser confirmados antes de registrar',
      pendingBanks: missing,
    });
  }

  return balances;
}

interface RegisterBrandParams {
  referenceDate: string;
  brand: BrandKey;
  tenantId: string;
  userId: string;
}

/**
 * Botão OK da marca. Grava 1 linha por dia+marca (upsert) com os saldos por
 * banco e os agregados calculados.
 *
 * Fonte dos saldos é sempre o que foi confirmado banco por banco: nada de
 * saldo vindo no corpo da requisição, para que a exigência de confirmação
 * individual não possa ser contornada. O dia só fecha com as 3 marcas prontas.
 */
@Injectable()
export class RegisterBrandUseCase {
  private readonly logger = new Logger(RegisterBrandUseCase.name);

  constructor(
    private readonly repository: CashBalanceRepository,
    private readonly clickhouse: ClickHouseReadService,
    private readonly trioClosing: RefreshTrioUseCase,
  ) {}

  async execute(params: RegisterBrandParams): Promise<RegisterBrandResult> {
    const { referenceDate, brand, tenantId, userId } = params;

    // Pré-check fail-fast (fora da transação, otimização): bancos pendentes é
    // o caminho mais comum de recusa, e é bem mais barato que Trio/ClickHouse
    // — não vale pagar as outras 3 chamadas antes de saber se o registro vai
    // ser aceito. Não é a fonte da verdade: pode estar desatualizado; a
    // validação que decide o que é persistido é a de dentro da transação
    // (repository.registerBrand), contra as linhas travadas.
    await this.preCheckManualBalances(params);

    const [trioBalance, saldoJogadores, kpis] = await Promise.all([
      this.resolveTrioBalance(brand, referenceDate),
      this.resolvePlayersBalance(brand, referenceDate),
      this.resolveDailyKpis(brand, referenceDate),
    ]);

    const outcome = await this.repository.registerBrand(
      {
        referenceDate,
        brand,
        tenantId,
        userId,
        trioBalance,
        saldoJogadores,
        depositsTotal: kpis.depositsTotal,
        withdrawalsTotal: kpis.withdrawalsTotal,
        requiredBrands: BRANDS.length,
      },
      extractManualBalances,
    );

    return {
      brand,
      referenceDate,
      saldoTransacional: outcome.saldoTransacional,
      saldoJogadores,
      totalBalanco: outcome.totalBalanco,
      acumuladoMensal: roundCurrency(outcome.acumuladoMensal),
      dayStatus: outcome.dayClosed ? 'CLOSED' : 'OPEN',
      allBrandsConfirmed: outcome.dayClosed,
    };
  }

  private async preCheckManualBalances(params: RegisterBrandParams): Promise<void> {
    const day = await this.repository.findDay(params.referenceDate);
    const daily = day?.brands.find((item) => item.brand === params.brand);
    extractManualBalances(daily?.entries ?? []);
  }

  /**
   * Fechamento da Trio do dia, lido do que o job agendado capturou. Se não há
   * captura, o balanço não pode ser registrado: gravar o saldo do instante
   * como se fosse o fechamento é justamente o erro que a captura veio corrigir.
   */
  private async resolveTrioBalance(brand: BrandKey, referenceDate: string): Promise<number> {
    const [result] = await this.trioClosing.execute({ referenceDate, brands: [brand] });

    if (!result?.available || result.balance === null) {
      throw new ServiceUnavailableException(
        'Saldo de fechamento da Trio não capturado para este dia — não é possível registrar o balanço',
      );
    }

    return roundCurrency(result.balance);
  }

  private async resolvePlayersBalance(brand: BrandKey, referenceDate: string): Promise<number> {
    if (!this.clickhouse.isConfigured) {
      throw new ServiceUnavailableException(
        'Saldo de jogadores indisponível — não é possível registrar o balanço',
      );
    }

    const balances = await this.clickhouse.fetchPlayersBalances(referenceDate);
    const balance = balances.get(brand);

    if (balance === undefined) {
      throw new ServiceUnavailableException(
        'Saldo de jogadores não encontrado para a data informada',
      );
    }

    return roundCurrency(balance);
  }

  /** Depósito/saque do dia são snapshot informativo, não fonte primária. */
  private async resolveDailyKpis(brand: BrandKey, referenceDate: string) {
    try {
      const kpis = await this.clickhouse.fetchDailyKpis(referenceDate);
      const row = kpis.find((item) => item.brand === brand);
      return {
        depositsTotal: roundCurrency(row?.depositsTotal ?? 0),
        withdrawalsTotal: roundCurrency(row?.withdrawalsTotal ?? 0),
      };
    } catch (error) {
      this.logger.warn(`KPIs do dia indisponíveis no registro: ${(error as Error).message}`);
      return { depositsTotal: 0, withdrawalsTotal: 0 };
    }
  }
}
