import { Inject, Injectable, Logger } from '@nestjs/common';

import { BRAND_KEYS, type BrandKey } from '../../cash-balance.constants';
import { TrioClosingBalanceRepository } from '../../infrastructure/trio-closing-balance.repository';
import {
  CLOSING_BALANCE_SOURCE,
  type ClosingBalanceSource,
} from '../ports/closing-balance-source.port';

interface CaptureParams {
  /** Dia que está fechando, em `YYYY-MM-DD` (BRT). */
  referenceDate: string;
  brands?: BrandKey[];
  /** true sobrescreve fechamento já gravado. O job agendado nunca sobrescreve. */
  overwrite?: boolean;
}

export interface CaptureOutcome {
  brand: BrandKey;
  balance: number | null;
  exact: boolean;
  saved: boolean;
  error?: string;
}

/**
 * Captura e persiste o saldo de fechamento da Trio.
 *
 * Uma marca que falha não impede as outras: o fechamento de cada conta é
 * independente e o dia pode ser completado depois pelo backfill.
 */
@Injectable()
export class CaptureTrioClosingUseCase {
  private readonly logger = new Logger(CaptureTrioClosingUseCase.name);

  constructor(
    @Inject(CLOSING_BALANCE_SOURCE) private readonly source: ClosingBalanceSource,
    private readonly repository: TrioClosingBalanceRepository,
  ) {}

  async execute(params: CaptureParams): Promise<CaptureOutcome[]> {
    const { referenceDate, overwrite = false } = params;
    const brands = params.brands ?? [...BRAND_KEYS];

    return Promise.all(brands.map((brand) => this.captureBrand(brand, referenceDate, overwrite)));
  }

  private async captureBrand(
    brand: BrandKey,
    referenceDate: string,
    overwrite: boolean,
  ): Promise<CaptureOutcome> {
    try {
      const capture = await this.source.capture(brand, referenceDate);
      const saved = await this.repository.save(referenceDate, capture, overwrite);

      if (!saved) {
        this.logger.log(`Fechamento de ${brand} em ${referenceDate} já estava gravado — mantido`);
      }

      return { brand, balance: capture.balance, exact: capture.exact, saved };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Falha ao capturar fechamento de ${brand} em ${referenceDate}: ${message}`);
      return { brand, balance: null, exact: false, saved: false, error: message };
    }
  }
}
