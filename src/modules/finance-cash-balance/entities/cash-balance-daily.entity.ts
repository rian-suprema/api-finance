import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../common/transformers/decimal.transformer';
import { CashBalanceBankEntry } from './cash-balance-bank-entry.entity';
import { CashBalanceBrandSnapshot } from './cash-balance-brand-snapshot.entity';
import { CashBalanceDay } from './cash-balance-day.entity';
import { CashBalanceBrandStatus } from '../cash-balance.enums';

/**
 * O dia × marca — o centro do domínio. Uma linha por `(reference_date,
 * brand)`. `depositsTotal`/`withdrawalsTotal`/`netDeposit` são **snapshot
 * informativo** do KPI no momento do registro — nunca fonte primária, o
 * histórico real vem do warehouse (`fct_kpi_daily`). Ver DADOS-FINANCE.md §3.2.
 */
@Entity('cash_balance_daily')
@Unique(['referenceDate', 'brand'])
export class CashBalanceDaily {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CashBalanceDay, (day) => day.brands)
  @JoinColumn({ name: 'day_id' })
  day: CashBalanceDay;

  @Index()
  @Column({ name: 'day_id' })
  dayId: number;

  // Rastreabilidade — id do tenant SayPlus resolvido por GET /auth/me. NÃO é
  // chave de RLS: a marca é multi-valorada por request (até 3 simultâneas),
  // o que uma RLS de tenant único não modela. Ver CLAUDE.md, decisão 5.
  @Column({ name: 'tenant_id', type: 'varchar', length: 100 })
  tenantId: string;

  @Column({ type: 'varchar', length: 50 })
  brand: string;

  @Column({ name: 'reference_date', type: 'date' })
  referenceDate: string;

  @Column({
    name: 'deposits_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  depositsTotal: number;

  @Column({
    name: 'withdrawals_total',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  withdrawalsTotal: number;

  @Column({
    name: 'net_deposit',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  netDeposit: number;

  @Column({
    type: 'enum',
    enum: CashBalanceBrandStatus,
    default: CashBalanceBrandStatus.DRAFT,
  })
  status: CashBalanceBrandStatus;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt?: Date | null;

  @Column({ name: 'confirmed_by', type: 'varchar', length: 100, nullable: true })
  confirmedBy?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;

  @OneToMany(() => CashBalanceBankEntry, (entry) => entry.daily)
  bankEntries: CashBalanceBankEntry[];

  @OneToOne(() => CashBalanceBrandSnapshot, (snapshot) => snapshot.daily)
  snapshot: CashBalanceBrandSnapshot;
}
