import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../common/transformers/decimal.transformer';
import { CashBalanceDaily } from './cash-balance-daily.entity';
import { CashBalanceBankSource, CashBalanceBankType } from '../cash-balance.enums';

/**
 * O saldo por banco — uma linha por `(daily_id, bank)`. É a granularidade da
 * confirmação individual: o botão "OK" da marca só libera quando todos os
 * bancos manuais têm linha aqui com `confirmed = true`. A linha do banco
 * `trio` nasce dentro do `registerBrand` (Fase 09), nunca pela rota de
 * confirmação. Ver DADOS-FINANCE.md §3.3.
 */
@Entity('cash_balance_bank_entries')
@Unique(['dailyId', 'bank'])
export class CashBalanceBankEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => CashBalanceDaily, (daily) => daily.bankEntries)
  @JoinColumn({ name: 'daily_id' })
  daily: CashBalanceDaily;

  @Column({ name: 'daily_id' })
  dailyId: number;

  // Chave do catálogo em código (cash-balance.constants.ts, Fase 07):
  // caixa, trio, onekey, zro, celcoin, okto, topazio, genial.
  @Column({ type: 'varchar', length: 50 })
  bank: string;

  @Column({ type: 'enum', enum: CashBalanceBankType })
  type: CashBalanceBankType;

  @Column({ type: 'enum', enum: CashBalanceBankSource })
  source: CashBalanceBankSource;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  balance: number;

  @Column({ default: false })
  confirmed: boolean;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt?: Date | null;

  // Fica nulo na linha da Trio — não há operador. Ver DADOS-FINANCE.md §3.3.
  @Column({ name: 'confirmed_by', type: 'varchar', length: 100, nullable: true })
  confirmedBy?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
