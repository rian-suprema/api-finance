import { Injectable, NotFoundException } from '@nestjs/common';

import type { BrandKey } from '../../cash-balance.constants';
import { CashBalanceRepository } from '../../infrastructure/cash-balance.repository';

interface ReopenBrandParams {
  referenceDate: string;
  brand: BrandKey;
}

/**
 * Reabre a marca para nova edição. O dia volta a ficar aberto: o balanço só é
 * final com as 3 marcas confirmadas.
 */
@Injectable()
export class ReopenBrandUseCase {
  constructor(private readonly repository: CashBalanceRepository) {}

  async execute({ referenceDate, brand }: ReopenBrandParams): Promise<void> {
    const reopened = await this.repository.reopenBrand(referenceDate, brand);

    if (!reopened) {
      throw new NotFoundException('Não há balanço registrado para esta marca na data');
    }
  }
}
