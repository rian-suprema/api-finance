import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import {
  daysInRange,
  isIsoDate,
  shiftDays,
  yesterdayInBrt,
} from '../../../../common/utils/date.util';
import {
  findBrand,
  HISTORY_DEFAULT_RANGE_DAYS,
  HISTORY_MAX_RANGE_DAYS,
} from '../../cash-balance.constants';
import { PlatformIdentityService } from '../../infrastructure/platform/platform-identity.service';
import type { BrandAccess } from '../cash-balance.types';

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Isolamento por tenant: a marca vem da associação do usuário na plataforma,
 * nunca do body ou da query. Passar `brand` na URL não concede acesso.
 */
@Injectable()
export class BrandAccessService {
  constructor(private readonly identity: PlatformIdentityService) {}

  async resolveBrands(authorization: string): Promise<BrandAccess[]> {
    return this.identity.resolveAccessibleBrands(authorization);
  }

  async requireBrand(authorization: string, brandParam: string): Promise<BrandAccess> {
    const brand = findBrand(brandParam);
    if (!brand) throw new BadRequestException('Marca não reconhecida');

    const accessible = await this.resolveBrands(authorization);
    const access = accessible.find((item) => item.brand === brand.key);

    if (!access) throw new ForbiddenException('Usuário sem acesso a esta marca');

    return access;
  }

  /** Data de referência padrão: dia anterior em BRT. */
  resolveReferenceDate(date?: string): string {
    if (!date) return yesterdayInBrt();
    if (!isIsoDate(date)) throw new BadRequestException('Data inválida');
    return date;
  }

  /**
   * Intervalo do histórico. Padrão: os últimos `HISTORY_DEFAULT_RANGE_DAYS`
   * dias encerrando no dia anterior em BRT — a mesma referência da tela do dia.
   */
  resolveRange(from?: string, to?: string): DateRange {
    const end = to ?? yesterdayInBrt();
    const start = from ?? shiftDays(end, -(HISTORY_DEFAULT_RANGE_DAYS - 1));

    if (!isIsoDate(start) || !isIsoDate(end)) throw new BadRequestException('Data inválida');

    if (start > end) {
      throw new BadRequestException('A data inicial não pode ser posterior à final');
    }

    if (daysInRange(start, end) > HISTORY_MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `O intervalo não pode passar de ${HISTORY_MAX_RANGE_DAYS} dias`,
      );
    }

    return { from: start, to: end };
  }
}
