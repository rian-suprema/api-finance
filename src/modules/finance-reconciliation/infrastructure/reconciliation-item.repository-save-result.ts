import type { EntityManager } from 'typeorm';

import type { Movement, SettledMovement } from '../domain/reconciliation.types';
import { ReconciliationItem } from '../entities/reconciliation-item.entity';
import { SYSTEM_ACTOR } from '../reconciliation.constants';
import {
  ReconciliationFlow,
  ReconciliationItemStatus,
  ReconciliationSide,
} from '../reconciliation.enums';

/**
 * As 4 partes da transação de `saveResult`, extraídas para arquivo próprio
 * por tamanho de função (limite de 80 linhas do ESLint) — sem estado próprio,
 * recebem o `EntityManager` transacional de `ReconciliationItemRepository`.
 *
 * A identidade da pendência é `(referenceDate, brand, bank, side, itemKey)`,
 * não o `runId` — ver DADOS-FINANCE.md §4.2. É por isso que nenhuma função
 * aqui recria uma linha existente: sempre lê pela chave natural e faz merge.
 */

export interface ItemScope {
  referenceDate: string;
  brand: string;
  bank: string;
}

export interface StoredKey {
  id: number;
  side: string;
  itemKey: string;
  status: ReconciliationItemStatus;
  resolvedBy?: string | null;
}

export function movementKey(side: string, itemKey: string): string {
  return `${side}:${itemKey}`;
}

/**
 * `Movement.side`/`Movement.flow` (domínio, `reconciliation.types.ts`) são
 * union types de string; as colunas da entidade usam os enums nativos de
 * `reconciliation.enums.ts`. Os valores são idênticos — só o cast de tipo,
 * nunca de dado.
 */
function movementFields(movement: Movement) {
  return {
    flow: movement.flow as ReconciliationFlow,
    amount: movement.amountCents / 100,
    occurredAt: movement.occurredAt ?? null,
    externalKey: movement.externalKey ?? null,
    endToEndId: movement.endToEndId ?? null,
    counterpartyName: movement.counterpartyName ?? null,
    counterpartyTaxNumber: movement.counterpartyTaxNumber ?? null,
  };
}

export async function findStoredKeys(
  manager: EntityManager,
  scope: ItemScope,
): Promise<StoredKey[]> {
  return manager.getRepository(ReconciliationItem).find({
    where: scope,
    select: { id: true, side: true, itemKey: true, status: true, resolvedBy: true },
  });
}

/**
 * Sumiu da lista atual: uma execução posterior conciliou a linha. Sem nota, a
 * pendência era falsa e vai embora (`DELETE` físico — a única exclusão de
 * dado de negócio do módulo). Com nota, fica para auditoria, fora da
 * contagem de pendências.
 */
export async function retireMissingItems(
  manager: EntityManager,
  stored: StoredKey[],
  currentKeys: Set<string>,
  runId: number,
): Promise<void> {
  const repo = manager.getRepository(ReconciliationItem);

  for (const item of stored) {
    if (currentKeys.has(movementKey(item.side, item.itemKey))) continue;

    if (item.status === ReconciliationItemStatus.OPEN) {
      await repo.delete(item.id);
    } else {
      await repo.update(item.id, { stillPending: false, runId });
    }
  }
}

/** Upsert dos `pending` atuais — nunca toca `note`/`status`/`resolvedBy`. */
export async function upsertPendingItems(
  manager: EntityManager,
  scope: ItemScope,
  runId: number,
  pending: Movement[],
): Promise<void> {
  const repo = manager.getRepository(ReconciliationItem);

  for (const movement of pending) {
    const existing = await repo.findOne({
      where: { ...scope, side: movement.side as ReconciliationSide, itemKey: movement.key },
    });
    const fields = movementFields(movement);

    if (existing) {
      repo.merge(existing, { runId, stillPending: true, ...fields });
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          ...scope,
          runId,
          side: movement.side as ReconciliationSide,
          itemKey: movement.key,
          status: ReconciliationItemStatus.OPEN,
          stillPending: true,
          // Explícito, não o `default: false` da coluna: `useDefineForClassFields`
          // faz `repo.create()` gravar `undefined` como propriedade própria em
          // qualquer campo não informado, e isso vira `NULL` explícito no
          // INSERT (mesma causa do `ZERO_TOTALS` em `reconciliation-run.repository.ts`).
          platformReprocessPending: false,
          ...fields,
        }),
      );
    }
  }
}

/**
 * Upsert dos estornos liquidados — entram como `RESOLVED` do sistema, exceto
 * quando um operador humano (`resolvedBy` ≠ `SYSTEM_ACTOR`) já tratou a
 * mesma linha: aí a nota do operador nunca é sobrescrita por texto automático.
 */
export async function upsertSettledItems(
  manager: EntityManager,
  scope: ItemScope,
  runId: number,
  settled: SettledMovement[],
  storedByKey: Map<string, StoredKey>,
): Promise<void> {
  const repo = manager.getRepository(ReconciliationItem);
  const now = new Date();

  for (const { movement, note, platformReprocessPending } of settled) {
    const existingStored = storedByKey.get(movementKey(movement.side, movement.key));
    const keepHumanNote =
      existingStored?.status === ReconciliationItemStatus.RESOLVED &&
      existingStored.resolvedBy !== SYSTEM_ACTOR;

    const treatment = keepHumanNote
      ? {}
      : {
          status: ReconciliationItemStatus.RESOLVED,
          note,
          resolvedAt: now,
          resolvedBy: SYSTEM_ACTOR,
        };

    const existing = await repo.findOne({
      where: { ...scope, side: movement.side as ReconciliationSide, itemKey: movement.key },
    });
    const fields = movementFields(movement);

    if (existing) {
      repo.merge(existing, {
        runId,
        stillPending: true,
        platformReprocessPending,
        ...fields,
        ...treatment,
      });
      await repo.save(existing);
    } else {
      await repo.save(
        repo.create({
          ...scope,
          runId,
          side: movement.side as ReconciliationSide,
          itemKey: movement.key,
          stillPending: true,
          platformReprocessPending,
          status: ReconciliationItemStatus.RESOLVED,
          note,
          resolvedAt: now,
          resolvedBy: SYSTEM_ACTOR,
          ...fields,
        }),
      );
    }
  }
}

export async function countOpenPending(manager: EntityManager, scope: ItemScope): Promise<number> {
  return manager.getRepository(ReconciliationItem).count({
    where: { ...scope, status: ReconciliationItemStatus.OPEN, stillPending: true },
  });
}
