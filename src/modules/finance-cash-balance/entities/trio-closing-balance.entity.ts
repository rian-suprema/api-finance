import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../common/transformers/decimal.transformer';
import { TrioClosingBalanceMethod } from '../cash-balance.enums';

/**
 * O fechamento capturado do banco integrado — tabela solta (sem FK), uma
 * linha por `(reference_date, brand)`. A banking-api da Trio não tem
 * endpoint de saldo histórico: o fechamento é lido no instante do corte por
 * job agendado e fica gravado aqui. Nenhum request de tela chama a Trio para
 * saldo — todos leem esta tabela. Ver DADOS-FINANCE.md §3.5.
 */
@Entity('trio_closing_balances')
@Unique(['referenceDate', 'brand'])
export class TrioClosingBalance {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'reference_date', type: 'date' })
  referenceDate: string;

  @Column({ type: 'varchar', length: 50 })
  brand: string;

  // Nas linhas novas é a conta VIRTUAL; nas antigas era o bank_account.id.
  @Column({ name: 'bank_account_id', type: 'varchar', length: 100 })
  bankAccountId: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  balance: number;

  // Instante exato do corte = brtMidnightUtc(dia seguinte).
  @Column({ name: 'cutoff_at', type: 'timestamptz' })
  cutoffAt: Date;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ default: true })
  exact: boolean;

  @Column({ type: 'enum', enum: TrioClosingBalanceMethod })
  method: TrioClosingBalanceMethod;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
