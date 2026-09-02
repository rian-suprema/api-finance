import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ReconciliationItemRepository } from '../../infrastructure/reconciliation-item.repository';
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from '../../reconciliation.constants';
import { ReconciliationItemStatus } from '../../reconciliation.enums';
import { ReconciliationItem } from '../../entities/reconciliation-item.entity';

interface ResolveItemParams {
  id: number;
  note: string;
  userId: string;
  allowedBrands: string[];
}

interface ReopenItemParams {
  id: number;
  allowedBrands: string[];
}

/**
 * As duas transições de estado da pendência (§3.6, §3.7) — uma classe só,
 * não dois use-cases: reduz o construtor de `ReconciliationService` a 5
 * dependências (limite do `max-params`), e as duas transições compartilham a
 * mesma checagem de posse (`findItemById` + autorização pelo dado).
 */
@Injectable()
export class ResolveItemUseCase {
  constructor(private readonly itemRepository: ReconciliationItemRepository) {}

  /**
   * A nota é o registro contábil do porquê daquele lançamento não ter par —
   * é ela que permite fechar o dia sem apagar a divergência (§3.6).
   */
  async resolve(params: ResolveItemParams): Promise<void> {
    // Validação dupla de propósito: o DTO valida o que chegou (`@Length`), o
    // use-case valida o que será gravado, depois do trim — `"          "`
    // passa no DTO e é recusado aqui.
    const note = params.note.trim();
    if (note.length < MIN_NOTE_LENGTH || note.length > MAX_NOTE_LENGTH) {
      throw new BadRequestException(
        `A nota deve ter entre ${MIN_NOTE_LENGTH} e ${MAX_NOTE_LENGTH} caracteres`,
      );
    }

    const item = await this.findOwnedItem(params.id, params.allowedBrands);

    if (item.status === ReconciliationItemStatus.RESOLVED) {
      throw new ConflictException('Pendência já tratada — reabra antes de registrar outra nota');
    }

    await this.itemRepository.resolveItem({ id: params.id, note, userId: params.userId });
  }

  /**
   * Nota errada acontece, e a alternativa seria empilhar tratamento sobre
   * tratamento (§3.7). A nota anterior é apagada, não versionada.
   */
  async reopen(params: ReopenItemParams): Promise<void> {
    await this.findOwnedItem(params.id, params.allowedBrands);
    // Sem `409`: reabrir item já OPEN funciona e é praticamente no-op.
    await this.itemRepository.reopenItem(params.id);
  }

  /** `404` se não existe; `403` se existe mas a marca não está entre as acessíveis (§1.2, §3.6). */
  private async findOwnedItem(id: number, allowedBrands: string[]): Promise<ReconciliationItem> {
    const item = await this.itemRepository.findItemById(id);
    if (!item) throw new NotFoundException('Pendência não encontrada');

    if (!allowedBrands.includes(item.brand)) {
      throw new ForbiddenException('Usuário sem acesso a esta marca');
    }

    return item;
  }
}
