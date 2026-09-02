import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { shiftDays } from '../../../../common/utils/date.util';
import { roundCurrency } from '../../../../common/utils/number.util';
import { CorrectionSearchService } from '../../infrastructure/clickhouse/correction-search.service';
import { ReconciliationItemRepository } from '../../infrastructure/reconciliation-item.repository';
import type { CorrectionSearchItem } from '../../infrastructure/reconciliation.repository.types';
import { CORRECTION_LOOKBACK_DAYS } from '../../reconciliation.constants';
import { findCorrectionCandidates } from '../correction-matcher';
import type { CorrectionCandidate, CorrectionEntry } from '../correction-matcher';
import { buildCorrectionNote } from '../correction-note';
import type {
  CorrectionCandidateView,
  CorrectionEvidenceView,
  CorrectionSearchView,
} from '../reconciliation.types';

/**
 * Procura, para cada pendência de saque do lado do banco, a correção de saldo
 * que a explica.
 *
 * O cenário: jogador autoexcluído ou bloqueado não consegue sacar pela
 * plataforma, então o setor financeiro paga na mão pela conta da Trio. Antes
 * de pagar, o backoffice tira o saldo dele com uma correção para baixo. O
 * pagamento aparece no extrato e não tem saque para casar — vira pendência. A
 * correção é a prova de que o dinheiro era do jogador.
 *
 * Roda sob demanda, num botão, e não no `run`: são duas consultas ao
 * warehouse que só interessam quando sobrou pendência para tratar.
 *
 * Não escreve nada. Devolve evidência para o operador decidir, porque a
 * correção não tem referência ao pagamento e a ligação entre os dois é
 * inferência.
 */
@Injectable()
export class SearchCorrectionsUseCase {
  private readonly logger = new Logger(SearchCorrectionsUseCase.name);

  constructor(
    private readonly itemRepository: ReconciliationItemRepository,
    private readonly corrections: CorrectionSearchService,
  ) {}

  async execute(params: { referenceDate: string; brand: string }): Promise<CorrectionSearchView> {
    if (!this.corrections.isConfigured) {
      throw new ServiceUnavailableException('Integração com o data warehouse não configurada');
    }

    const from = shiftDays(params.referenceDate, -CORRECTION_LOOKBACK_DAYS);
    const to = params.referenceDate;

    const items = await this.itemRepository.findItemsForCorrectionSearch(params);

    if (items.length === 0) {
      return {
        ...params,
        from,
        to,
        searchedCount: 0,
        withEvidenceCount: 0,
        withoutClientCount: 0,
        items: [],
      };
    }

    const byTaxNumber = await this.correctionsByTaxNumber({ items, from, to });

    const evidence = items.map<CorrectionEvidenceView>((item) => {
      const forClient = byTaxNumber.get(item.taxNumber);

      // `undefined` é CPF sem conta conhecida; lista vazia é conta conhecida
      // sem correção na janela. Os dois casos são diferentes para quem lê a tela.
      if (!forClient) return { itemId: item.id, clientResolved: false, candidates: [] };

      const candidates = findCorrectionCandidates(
        { brand: params.brand, amountCents: toCents(item.amount) },
        forClient,
      );

      return {
        itemId: item.id,
        clientResolved: true,
        candidates: candidates.map((candidate) => this.toCandidateView(candidate, item.amount)),
      };
    });

    const withEvidenceCount = evidence.filter((item) => item.candidates.length > 0).length;
    const withoutClientCount = evidence.filter((item) => !item.clientResolved).length;

    this.logger.log(
      `${params.brand} ${params.referenceDate}: ${items.length} pendências consultadas, ` +
        `${withEvidenceCount} com correção candidata, ${withoutClientCount} sem jogador identificável`,
    );

    return {
      referenceDate: params.referenceDate,
      brand: params.brand,
      from,
      to,
      searchedCount: items.length,
      withEvidenceCount,
      withoutClientCount,
      items: evidence,
    };
  }

  /**
   * Correções da janela agrupadas pelo CPF da pendência, de duas fontes.
   *
   * 1. **CPF na própria linha da correção** (`fct_correction.cpf`, coluna
   *    ainda quase vazia). Direto, sem junção, e é para onde tudo caminha.
   * 2. **Ponte por `pix_key`** (CPF → `client_id` → correções do jogador),
   *    para as linhas em que a coluna ainda não foi preenchida. Duas
   *    consultas em série, porque a segunda depende da primeira.
   *
   * A união é por `correctionId`, então a mesma correção alcançada pelos dois
   * caminhos entra uma vez só e nunca vira soma inflada.
   */
  private async correctionsByTaxNumber(params: {
    items: CorrectionSearchItem[];
    from: string;
    to: string;
  }): Promise<Map<string, CorrectionEntry[]>> {
    const taxNumbers = [...new Set(params.items.map((item) => item.taxNumber))];

    const [direct, clients] = await Promise.all([
      this.corrections.fetchDownCorrectionsByTaxNumber({
        taxNumbers,
        from: params.from,
        to: params.to,
      }),
      this.corrections.resolveClients(taxNumbers),
    ]);

    const byTaxNumber = new Map<string, CorrectionEntry[]>();
    const seenIds = new Set<string>();

    const add = (taxNumber: string, entry: CorrectionEntry): void => {
      const key = `${taxNumber}:${entry.correctionId}`;
      if (seenIds.has(key)) return;
      seenIds.add(key);

      const list = byTaxNumber.get(taxNumber) ?? [];
      list.push(entry);
      byTaxNumber.set(taxNumber, list);
    };

    for (const entry of direct) add(entry.taxNumber, entry);

    // Cada CPF com conta conhecida entra no mapa, mesmo sem correção: é o que
    // distingue "jogador não identificado" de "jogador sem correção na janela".
    for (const client of clients) {
      if (!byTaxNumber.has(client.taxNumber)) byTaxNumber.set(client.taxNumber, []);
    }

    if (clients.length === 0) return byTaxNumber;

    const taxNumberByClientId = new Map(
      clients.map((client) => [client.clientId, client.taxNumber]),
    );

    const entries = await this.corrections.fetchDownCorrections({
      clientIds: [...taxNumberByClientId.keys()],
      from: params.from,
      to: params.to,
    });

    for (const entry of entries) {
      const taxNumber = taxNumberByClientId.get(entry.clientId);
      if (!taxNumber) continue;

      add(taxNumber, entry);
    }

    return byTaxNumber;
  }

  private toCandidateView(
    candidate: CorrectionCandidate,
    itemAmount: number,
  ): CorrectionCandidateView {
    return {
      confidence: candidate.confidence,
      amount: roundCurrency(candidate.amountCents / 100),
      difference: roundCurrency(candidate.differenceCents / 100),
      exact: candidate.confidence !== 'PARTIAL' && candidate.differenceCents === 0,
      note: buildCorrectionNote({ candidate, itemAmount }),
      corrections: candidate.corrections.map((correction) => ({
        correctionId: correction.correctionId,
        brand: correction.brand,
        clientId: correction.clientId,
        correctionDate: correction.correctionDate,
        occurredAt: correction.occurredAt?.toISOString() ?? null,
        amount: roundCurrency(correction.amountCents / 100),
      })),
    };
  }
}

/** Valor em reais → centavos, para comparar sem erro de ponto flutuante. */
const toCents = (amount: number): number => Math.round(amount * 100);
