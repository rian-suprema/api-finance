import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CashBalanceDayStatus } from '../cash-balance.enums';
// Import só de tipo: `CashBalanceDaily` importa `CashBalanceDay` como valor
// (@ManyToOne) — importar a classe aqui como valor também criaria ciclo
// (rejeitado por `architecture.spec.ts` › "não há ciclos de dependência").
// O alvo do @OneToMany por string ('CashBalanceDaily') evita a importação de
// valor deste lado; o tipo continua checado em tempo de compilação.
import type { CashBalanceDaily } from './cash-balance-daily.entity';

/**
 * O dia: uma linha por `reference_date`. É o portão do fechamento — o dia só
 * fica `CLOSED` quando as três marcas estiverem `CONFIRMED` (regra aplicada
 * na Fase 09, `registerBrand`). Ver DADOS-FINANCE.md §3.1.
 */
@Entity('cash_balance_days')
export class CashBalanceDay {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'reference_date', type: 'date', unique: true })
  referenceDate: string;

  @Column({
    type: 'enum',
    enum: CashBalanceDayStatus,
    default: CashBalanceDayStatus.OPEN,
  })
  status: CashBalanceDayStatus;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @Column({ name: 'closed_by', type: 'varchar', length: 100, nullable: true })
  closedBy?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Soft delete: nunca usado pelo código atual, mas mantido por paridade com
  // a origem — DADOS-FINANCE.md §2 (convenções gerais).
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;

  @OneToMany('CashBalanceDaily', (daily: CashBalanceDaily) => daily.day)
  brands: CashBalanceDaily[];
}
