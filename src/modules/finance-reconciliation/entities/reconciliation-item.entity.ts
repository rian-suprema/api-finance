import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../common/transformers/decimal.transformer';
import { ReconciliationRun } from './reconciliation-run.entity';
import {
  ReconciliationFlow,
  ReconciliationItemStatus,
  ReconciliationSide,
} from '../reconciliation.enums';

/**
 * A pendência — a única tabela do módulo que guarda trabalho humano. A
 * identidade é a CHAVE NATURAL `(reference_date, brand, bank, side,
 * item_key)`, não o `run_id`: reexecutar a conciliação faz upsert por essa
 * chave e atualiza os campos de fato sem tocar em `status`/`note`/
 * `resolvedAt`/`resolvedBy` — é isso que faz a nota de um operador sobreviver
 * a uma reexecução. Ver DADOS-FINANCE.md §4.2.
 */
@Entity('reconciliation_items')
@Unique(['referenceDate', 'brand', 'bank', 'side', 'itemKey'])
@Index(['referenceDate', 'brand', 'status'])
export class ReconciliationItem {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ReconciliationRun, (run) => run.items)
  @JoinColumn({ name: 'run_id' })
  run: ReconciliationRun;

  // Atualizado a cada reexecução para apontar a execução corrente.
  @Column({ name: 'run_id' })
  runId: number;

  @Column({ name: 'reference_date', type: 'date' })
  referenceDate: string;

  @Column({ type: 'varchar', length: 50 })
  brand: string;

  @Column({ type: 'varchar', length: 50 })
  bank: string;

  @Column({ type: 'enum', enum: ReconciliationFlow })
  flow: ReconciliationFlow;

  @Column({ type: 'enum', enum: ReconciliationSide })
  side: ReconciliationSide;

  // Identificador estável na origem: deposit_id/withdrawal_id na plataforma,
  // ref_id na Trio.
  @Column({ name: 'item_key', type: 'varchar', length: 255 })
  itemKey: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  amount: number;

  // Do lado banco vem do UUIDv7 do ref_id (a Trio devolve transaction_date nulo).
  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt?: Date | null;

  // A chave do gateway (gateway_external_id/external_id) — a chave do casamento.
  @Column({ name: 'external_key', type: 'varchar', length: 255, nullable: true })
  externalKey?: string | null;

  // EndToEnd do PIX — é por ele que o operador acha o lançamento no banco.
  @Column({ name: 'end_to_end_id', type: 'varchar', length: 255, nullable: true })
  endToEndId?: string | null;

  // PII — sai completo e pontuado na API (formatTaxNumber), nunca vai para log.
  @Column({ name: 'counterparty_name', type: 'varchar', length: 255, nullable: true })
  counterpartyName?: string | null;

  // PII — só dígitos no banco, ver DADOS-FINANCE.md §4.3.
  @Column({ name: 'counterparty_tax_number', type: 'varchar', length: 20, nullable: true })
  counterpartyTaxNumber?: string | null;

  @Column({ type: 'enum', enum: ReconciliationItemStatus })
  status: ReconciliationItemStatus;

  // 10-1000 caracteres — nota do operador ou nota automática do sistema.
  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  // userId de quem resolveu, ou a string 'sistema' (SYSTEM_ACTOR).
  @Column({ name: 'resolved_by', type: 'varchar', length: 100, nullable: true })
  resolvedBy?: string | null;

  // false quando uma execução posterior conciliou a linha.
  @Column({ name: 'still_pending', default: true })
  stillPending: boolean;

  // Exclusivo do fluxo de estorno — cache de uma consulta, recalculado a cada
  // execução (não é estado persistido "de verdade"). Ver DADOS-FINANCE.md §4.4.
  @Column({ name: 'platform_reprocess_pending', default: false })
  platformReprocessPending: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
