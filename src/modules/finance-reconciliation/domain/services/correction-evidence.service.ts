import { Injectable } from '@nestjs/common';

import { BrandAccessService } from '../../../finance-cash-balance/domain/services/brand-access.service';
import { ApplyCorrectionMatchesUseCase } from '../use-cases/apply-correction-matches.use-case';
import { SearchCorrectionsUseCase } from '../use-cases/search-corrections.use-case';
import type { CorrectionApplyView, CorrectionSearchView } from '../reconciliation.types';

/**
 * Busca de evidência para a pendência: a correção de saldo que explica o
 * pagamento manual.
 *
 * Serviço próprio, e não mais dois métodos do `ReconciliationService`, porque
 * a responsabilidade é outra — aquele serve o estado da conciliação, este
 * consulta o warehouse para investigar uma pendência.
 *
 * Sem regra de negócio própria: resolve o acesso do usuário à marca e delega.
 */
@Injectable()
export class CorrectionEvidenceService {
  constructor(
    private readonly access: BrandAccessService,
    private readonly searchCorrections: SearchCorrectionsUseCase,
    private readonly applyMatches: ApplyCorrectionMatchesUseCase,
  ) {}

  /**
   * Uma marca por chamada, e não todas as acessíveis: a busca custa duas
   * consultas ao warehouse, uma delas varrendo o histórico de saques para
   * achar o CPF. É um botão que o operador aperta quando sobrou pendência,
   * não parte da leitura da tela.
   */
  async search(
    authorization: string,
    brandParam: string,
    date?: string,
  ): Promise<CorrectionSearchView> {
    const referenceDate = this.access.resolveReferenceDate(date);
    const access = await this.access.requireBrand(authorization, brandParam);

    return this.searchCorrections.execute({ referenceDate, brand: access.brand });
  }

  /**
   * Dá baixa nas pendências com correção exata e devolve o resumo.
   *
   * Escreve, então exige `reconciliation.resolve` no controller — a busca
   * exige só leitura. O `userId` fica gravado em `resolvedBy`: baixa
   * automática também tem autor, e é quem apertou o botão.
   */
  async apply(
    authorization: string,
    brandParam: string,
    userId: string,
    date?: string,
  ): Promise<CorrectionApplyView> {
    const referenceDate = this.access.resolveReferenceDate(date);
    const access = await this.access.requireBrand(authorization, brandParam);

    return this.applyMatches.execute({ referenceDate, brand: access.brand, userId });
  }
}
