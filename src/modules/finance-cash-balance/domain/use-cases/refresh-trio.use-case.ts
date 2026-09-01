import { Injectable } from '@nestjs/common';

import { roundCurrency } from '../../../../common/utils/number.util';
import type { BrandKey } from '../../cash-balance.constants';
import { TrioClosingBalanceRepository } from '../../infrastructure/trio-closing-balance.repository';
import type { TrioBalance } from '../cash-balance.types';

interface RefreshTrioParams {
  referenceDate: string;
  brands: BrandKey[];
}

/**
 * Releitura dos saldos Trio sem recarregar a tela inteira.
 *
 * Lê do Postgres, não da Trio: o fechamento do dia é capturado por job
 * agendado (Fase 15). Nenhum request de tela chama a Trio, tanto porque a API
 * não tem saldo histórico quanto para não pagar latência de integração numa
 * consulta.
 */
@Injectable()
export class RefreshTrioUseCase {
  constructor(private readonly repository: TrioClosingBalanceRepository) {}

  async execute({ referenceDate, brands }: RefreshTrioParams): Promise<TrioBalance[]> {
    const stored = await this.repository.findByDate(referenceDate, brands);

    return brands.map((brand) => {
      const closing = stored.get(brand);

      if (!closing) {
        return {
          brand,
          balance: null,
          available: false,
          capturedAt: null,
          exact: false,
          message: 'Saldo de fechamento da Trio não capturado para este dia',
        };
      }

      return {
        brand,
        balance: roundCurrency(closing.balance),
        available: true,
        capturedAt: closing.capturedAt.toISOString(),
        exact: closing.exact,
        message: closing.exact ? undefined : 'Fechamento sem convergência, conferir',
      };
    });
  }
}
