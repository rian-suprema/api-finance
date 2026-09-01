import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../common/transformers/decimal.transformer';
import { ReconciliationMatchKey, ReconciliationRunStatus } from '../reconciliation.enums';
// Import só de tipo: `ReconciliationItem` importa `ReconciliationRun` como
// valor (@ManyToOne) — importar a classe aqui como valor também criaria
// ciclo. O alvo do @OneToMany por string evita a importação de valor deste
// lado; ver o mesmo padrão em cash-balance-day.entity.ts.
import type { ReconciliationItem } from './reconciliation-item.entity';

/**
 * A execução — uma linha por `(reference_date, brand, bank)`, em upsert que
 * preserva o `id`: reexecutar o mesmo dia atualiza a linha, nunca duplica.
 * `matchKey` nasce `match_key` (snake_case) nesta migration — a origem tinha
 * `"matchKey"` sem `@map` (pegadinha registrada em DADOS-FINANCE.md §2.1);
 * aqui recriamos do zero, então padronizamos. Ver DADOS-FINANCE.md §4.1.
 */
@Entity('reconciliation_runs')
@Unique(['referenceDate', 'brand', 'bank'])
export class ReconciliationRun {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'reference_date', type: 'date' })
  referenceDate: string;

  @Column({ type: 'varchar', length: 50 })
  brand: string;

  // Sempre 'trio' hoje (RECONCILIATION_BANK_TRIO); outros bancos virão por CSV.
  @Column({ type: 'varchar', length: 50 })
  bank: string;

  @Column({ type: 'enum', enum: ReconciliationRunStatus })
  status: ReconciliationRunStatus;

  @Column({ name: 'match_key', type: 'enum', enum: ReconciliationMatchKey })
  matchKey: ReconciliationMatchKey;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  // Nunca contém credencial.
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  // 16 colunas de totais (8 pares total+count) — soma só do dia de referência
  // (core); dia vizinho não entra. Ver DADOS-FINANCE.md §4.1.
  @Column({
    name: 'platform_deposits_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  platformDepositsTotal: number;

  @Column({ name: 'platform_deposits_count', type: 'int', default: 0 })
  platformDepositsCount: number;

  @Column({
    name: 'bank_deposits_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  bankDepositsTotal: number;

  @Column({ name: 'bank_deposits_count', type: 'int', default: 0 })
  bankDepositsCount: number;

  @Column({
    name: 'platform_withdrawals_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  platformWithdrawalsTotal: number;

  @Column({ name: 'platform_withdrawals_count', type: 'int', default: 0 })
  platformWithdrawalsCount: number;

  @Column({
    name: 'bank_withdrawals_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  bankWithdrawalsTotal: number;

  @Column({ name: 'bank_withdrawals_count', type: 'int', default: 0 })
  bankWithdrawalsCount: number;

  // Débito/crédito com contraparte no CNPJ próprio (OWN_TAX_NUMBERS) — nunca é pendência.
  @Column({
    name: 'treasury_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  treasuryTotal: number;

  @Column({ name: 'treasury_count', type: 'int', default: 0 })
  treasuryCount: number;

  // transaction_type = fee da Trio, em linha própria; fora do casamento.
  @Column({
    name: 'fees_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  feesTotal: number;

  @Column({ name: 'fees_count', type: 'int', default: 0 })
  feesCount: number;

  // Par cuja chave casou com um lado no dia vizinho — o quanto isso desloca
  // a diferença banco - plataforma.
  @Column({
    name: 'deposits_crossover_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  depositsCrossoverTotal: number;

  @Column({ name: 'deposits_crossover_count', type: 'int', default: 0 })
  depositsCrossoverCount: number;

  @Column({
    name: 'withdrawals_crossover_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  withdrawalsCrossoverTotal: number;

  @Column({ name: 'withdrawals_crossover_count', type: 'int', default: 0 })
  withdrawalsCrossoverCount: number;

  @Column({ name: 'matched_count', type: 'int', default: 0 })
  matchedCount: number;

  // Derivado: status = OPEN AND still_pending = true para aquele dia+marca+banco.
  @Column({ name: 'pending_count', type: 'int', default: 0 })
  pendingCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany('ReconciliationItem', (item: ReconciliationItem) => item.run)
  items: ReconciliationItem[];
}
