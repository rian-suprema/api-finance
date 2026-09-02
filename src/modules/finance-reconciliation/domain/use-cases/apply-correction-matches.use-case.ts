import { Injectable, Logger } from '@nestjs/common';

import { ReconciliationItemRepository } from '../../infrastructure/reconciliation-item.repository';
import { SearchCorrectionsUseCase } from './search-corrections.use-case';
import type { CorrectionApplyView, CorrectionEvidenceView } from '../reconciliation.types';

/**
 * Dá baixa nas pendências cuja correção de saldo **fecha no centavo**.
 *
 * Decisão de 14/08/2026, olhando o Histórico de Conciliação: enquanto a
 * busca só mostrava evidência, os itens já explicados continuavam somando no
 * total do dia, e a tela não distinguia o que estava resolvido do que era
 * divergência real. Agora o exato recebe baixa e sobra na lista **só o que
 * ainda tem diferença**.
 *
 * O que é "exato": candidato com `difference === 0` e confiança diferente de
 * `PARTIAL` — inclui a soma de correções entre marcas, que também fecha no
 * centavo. `PARTIAL` **nunca** entra: valor diferente não explica o
 * pagamento, e dar baixa nele seria esconder divergência.
 *
 * Só toca no candidato de maior confiança de cada pendência. Se o primeiro
 * não é exato, a pendência fica aberta mesmo que exista um exato mais abaixo
 * na lista — a ordem é justamente a da força da evidência.
 */
@Injectable()
export class ApplyCorrectionMatchesUseCase {
  private readonly logger = new Logger(ApplyCorrectionMatchesUseCase.name);

  constructor(
    private readonly itemRepository: ReconciliationItemRepository,
    private readonly search: SearchCorrectionsUseCase,
  ) {}

  async execute(params: {
    referenceDate: string;
    brand: string;
    userId: string;
  }): Promise<CorrectionApplyView> {
    // Reusa a busca inteira em vez de repetir a consulta ao warehouse com
    // outro critério: o que a tela mostrou e o que recebe baixa têm de ser a
    // mesma coisa.
    const found = await this.search.execute(params);

    const exact = found.items.filter((item) => isExact(item));
    const noteById = new Map(exact.map((item) => [item.itemId, item.candidates[0].note]));

    const resolvedCount = await this.itemRepository.resolveItems({
      ids: exact.map((item) => item.itemId),
      noteById,
      userId: params.userId,
    });

    const partialCount = found.items.filter(
      (item) => item.candidates.length > 0 && !isExact(item),
    ).length;

    this.logger.log(
      `${params.brand} ${params.referenceDate}: baixa automática em ${resolvedCount} de ` +
        `${found.searchedCount} pendências (correção exata); ${partialCount} seguem abertas por ` +
        'divergência de valor',
    );

    return {
      referenceDate: params.referenceDate,
      brand: params.brand,
      searchedCount: found.searchedCount,
      resolvedCount,
      partialCount,
      withoutCandidateCount: found.items.filter((item) => item.candidates.length === 0).length,
    };
  }
}

const isExact = (item: CorrectionEvidenceView): boolean => item.candidates[0]?.exact === true;
