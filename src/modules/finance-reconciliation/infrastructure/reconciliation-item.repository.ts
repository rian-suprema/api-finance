import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, type EntityManager } from 'typeorm';

import { ReconciliationItem } from '../entities/reconciliation-item.entity';
import {
  ReconciliationFlow,
  ReconciliationItemStatus,
  ReconciliationSide,
} from '../reconciliation.enums';
import { ReconciliationRunRepository } from './reconciliation-run.repository';
import {
  countOpenPending,
  findStoredKeys,
  movementKey,
  retireMissingItems,
  upsertPendingItems,
  upsertSettledItems,
  type ItemScope,
} from './reconciliation-item.repository-save-result';
import type {
  CorrectionSearchItem,
  ItemCounts,
  RangeItemCounts,
  ResolveItemsParams,
  SaveResultParams,
  StoredItem,
} from './reconciliation.repository.types';

function toStoredItem(row: ReconciliationItem): StoredItem {
  return {
    id: row.id,
    flow: row.flow,
    side: row.side,
    itemKey: row.itemKey,
    amount: row.amount,
    occurredAt: row.occurredAt ?? null,
    endToEndId: row.endToEndId ?? null,
    counterpartyName: row.counterpartyName ?? null,
    counterpartyTaxNumber: row.counterpartyTaxNumber ?? null,
    status: row.status,
    note: row.note ?? null,
    resolvedAt: row.resolvedAt ?? null,
    resolvedBy: row.resolvedBy ?? null,
    stillPending: row.stillPending,
    platformReprocessPending: row.platformReprocessPending,
  };
}

/**
 * Persistência da pendência — a tabela mais sensível do módulo (identidade
 * por chave natural, não por `runId`; único `DELETE` físico de dado de
 * negócio do Finance). `saveResult` orquestra as 4 partes da transação
 * (em `reconciliation-item.repository-save-result.ts`, extraídas só por
 * tamanho de função) e delega ao `ReconciliationRunRepository` a escrita dos
 * totais do run, na mesma transação.
 */
@Injectable()
export class ReconciliationItemRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly runRepository: ReconciliationRunRepository,
  ) {}

  /**
   * Grava o resultado: totais no run e a lista de pendências, tudo numa
   * transação — um resultado meio gravado descreveria um dia que não
   * existiu, e é sobre esse número que o operador decide.
   */
  async saveResult(params: SaveResultParams): Promise<void> {
    const scope: ItemScope = {
      referenceDate: params.referenceDate,
      brand: params.brand,
      bank: params.bank,
    };
    const settled = params.settled ?? [];

    await this.dataSource.transaction(async (manager) => {
      const stored = await findStoredKeys(manager, scope);
      const storedByKey = new Map(
        stored.map((item) => [movementKey(item.side, item.itemKey), item]),
      );
      const currentKeys = new Set([
        ...params.pending.map((item) => movementKey(item.side, item.key)),
        ...settled.map((item) => movementKey(item.movement.side, item.movement.key)),
      ]);

      await retireMissingItems(manager, stored, currentKeys, params.runId);
      await upsertPendingItems(manager, scope, params.runId, params.pending);
      await upsertSettledItems(manager, scope, params.runId, settled, storedByKey);

      const openCount = await countOpenPending(manager, scope);
      await this.runRepository.updateRunTotals(manager, params.runId, {
        matchedCount: params.matchedCount,
        pendingCount: openCount,
        totals: params.totals,
      });
    });
  }

  /** Itens de um dia, por marca. Ordena o que precisa de ação primeiro. */
  async findItems(
    referenceDate: string,
    brands: string[],
    limitPerBrand: number,
  ): Promise<Map<string, StoredItem[]>> {
    if (!brands.length) return new Map();

    const rows = await this.dataSource.getRepository(ReconciliationItem).find({
      where: { referenceDate, brand: In(brands) },
      order: { status: 'ASC', stillPending: 'DESC', amount: 'DESC', createdAt: 'ASC' },
    });

    const byBrand = new Map<string, StoredItem[]>();
    for (const row of rows) {
      const list = byBrand.get(row.brand) ?? [];
      if (list.length >= limitPerBrand) continue;
      list.push(toStoredItem(row));
      byBrand.set(row.brand, list);
    }

    return byBrand;
  }

  /**
   * Contagem por marca, agregada no banco — a lista de `findItems` tem teto
   * (`MAX_ITEMS_IN_RESPONSE`) e contar em memória mentiria num dia ruim.
   */
  async countItems(referenceDate: string, brands: string[]): Promise<Map<string, ItemCounts>> {
    if (!brands.length) return new Map();

    const rows: {
      brand: string;
      status: ReconciliationItemStatus;
      still_pending: boolean;
      platform_reprocess_pending: boolean;
      count: string;
    }[] = await this.dataSource.query(
      `SELECT brand, status, still_pending, platform_reprocess_pending, COUNT(*) AS count
       FROM reconciliation_items
       WHERE reference_date = $1 AND brand = ANY($2)
       GROUP BY brand, status, still_pending, platform_reprocess_pending`,
      [referenceDate, brands],
    );

    const counts = new Map<string, ItemCounts>();
    for (const row of rows) {
      const current = counts.get(row.brand) ?? {
        total: 0,
        open: 0,
        resolved: 0,
        reprocessPending: 0,
      };
      const quantity = Number(row.count);

      current.total += quantity;
      if (row.status === ReconciliationItemStatus.RESOLVED) current.resolved += quantity;
      else if (row.still_pending) current.open += quantity;

      // Independente do status: o aviso de reprocessamento vive no item de
      // estorno, que já nasce tratado.
      if (row.platform_reprocess_pending && row.still_pending) current.reprocessPending += quantity;

      counts.set(row.brand, current);
    }

    return counts;
  }

  async findItemById(id: number): Promise<ReconciliationItem | null> {
    return this.dataSource.getRepository(ReconciliationItem).findOne({ where: { id } });
  }

  /**
   * Contagem e soma das pendências de um intervalo, indexadas por `dia|marca`
   * — agrupa no banco, nunca traz linha de item.
   */
  async countItemsInRange(
    brands: string[],
    from: string,
    to: string,
  ): Promise<Map<string, RangeItemCounts>> {
    if (!brands.length) return new Map();

    const rows: {
      reference_date: string;
      brand: string;
      status: ReconciliationItemStatus;
      still_pending: boolean;
      count: string;
      amount_sum: string | null;
    }[] = await this.dataSource.query(
      // `::text` no SELECT: raw query não passa pelo transform de coluna do
      // TypeORM (só `repo.find()` devolve `date` como string YYYY-MM-DD, ver
      // Fase 07) — sem o cast, o driver `pg` devolve `Date`, quebrando a
      // chave `dia|marca`.
      `SELECT reference_date::text AS reference_date, brand, status, still_pending,
              COUNT(*) AS count, SUM(amount) AS amount_sum
       FROM reconciliation_items
       WHERE reference_date BETWEEN $1 AND $2 AND brand = ANY($3)
       GROUP BY reference_date, brand, status, still_pending`,
      [from, to, brands],
    );

    const counts = new Map<string, RangeItemCounts>();
    for (const row of rows) {
      const key = `${row.reference_date}|${row.brand}`;
      const current = counts.get(key) ?? { open: 0, openAmount: 0, resolved: 0 };
      const quantity = Number(row.count);

      if (row.status === ReconciliationItemStatus.RESOLVED) {
        current.resolved += quantity;
      } else if (row.still_pending) {
        current.open += quantity;
        current.openAmount += Number(row.amount_sum ?? 0);
      }

      counts.set(key, current);
    }

    return counts;
  }

  /**
   * Pendências candidatas à busca de correção de saldo: débito do banco, de
   * saque, ainda aberto e com CPF da contraparte — o recorte do problema que
   * a correção manual resolve (ver `reconciliation.constants.ts`).
   */
  async findItemsForCorrectionSearch(params: {
    referenceDate: string;
    brand: string;
  }): Promise<CorrectionSearchItem[]> {
    const rows = await this.dataSource.getRepository(ReconciliationItem).find({
      where: {
        referenceDate: params.referenceDate,
        brand: params.brand,
        side: ReconciliationSide.BANK,
        flow: ReconciliationFlow.WITHDRAWAL,
        status: ReconciliationItemStatus.OPEN,
        stillPending: true,
        counterpartyTaxNumber: Not(IsNull()),
      },
      select: { id: true, amount: true, counterpartyTaxNumber: true },
      order: { amount: 'DESC', createdAt: 'ASC' },
    });

    return rows.map((row) => ({
      id: row.id,
      amount: row.amount,
      taxNumber: (row.counterpartyTaxNumber ?? '').replace(/\D/g, ''),
    }));
  }

  /**
   * Baixa em lote, uma nota por pendência. `status: OPEN` no filtro é o que
   * torna a operação idempotente: pendência já tratada à mão não tem a nota
   * sobrescrita por texto automático numa segunda chamada.
   */
  async resolveItems(params: ResolveItemsParams): Promise<number> {
    if (!params.ids.length) return 0;

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ReconciliationItem);
      const open = await repo.find({
        where: { id: In(params.ids), status: ReconciliationItemStatus.OPEN, stillPending: true },
      });

      const resolvedAt = new Date();
      for (const item of open) {
        repo.merge(item, {
          status: ReconciliationItemStatus.RESOLVED,
          note: params.noteById.get(item.id) ?? null,
          resolvedAt,
          resolvedBy: params.userId,
        });
        await repo.save(item);
      }

      await this.refreshRunPendingCounts(manager, open);
      return open.length;
    });
  }

  /** Registra a nota e dá baixa na pendência. */
  async resolveItem(params: { id: number; note: string; userId: string }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ReconciliationItem);
      const item = await repo.findOneOrFail({ where: { id: params.id } });

      repo.merge(item, {
        status: ReconciliationItemStatus.RESOLVED,
        note: params.note,
        resolvedAt: new Date(),
        resolvedBy: params.userId,
      });
      const saved = await repo.save(item);

      await this.refreshRunPendingCounts(manager, [saved]);
    });
  }

  /** Devolve a pendência para a fila, apagando o tratamento anterior. */
  async reopenItem(id: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ReconciliationItem);
      const item = await repo.findOneOrFail({ where: { id } });

      repo.merge(item, {
        status: ReconciliationItemStatus.OPEN,
        note: null,
        resolvedAt: null,
        resolvedBy: null,
      });
      const saved = await repo.save(item);

      await this.refreshRunPendingCounts(manager, [saved]);
    });
  }

  /**
   * Recalcula `pending_count` de cada run afetado — uma vez por
   * `dia + marca + banco`, não uma vez por item.
   */
  private async refreshRunPendingCounts(
    manager: EntityManager,
    items: Pick<ReconciliationItem, 'referenceDate' | 'brand' | 'bank' | 'runId'>[],
  ): Promise<void> {
    const scopeByRunId = new Map<number, ItemScope>();
    for (const item of items) {
      if (scopeByRunId.has(item.runId)) continue;
      scopeByRunId.set(item.runId, {
        referenceDate: item.referenceDate,
        brand: item.brand,
        bank: item.bank,
      });
    }

    for (const [runId, scope] of scopeByRunId) {
      const openCount = await countOpenPending(manager, scope);
      await this.runRepository.refreshPendingCount(manager, runId, openCount);
    }
  }
}
