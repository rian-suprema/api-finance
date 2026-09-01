import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { decimalTransformer } from '../../../common/transformers/decimal.transformer';
import { CashBalanceDaily } from './cash-balance-daily.entity';

/**
 * Os agregados registrados — relação 1:1 com `cash_balance_daily`. É a única
 * fonte do histórico de balanços: a tela do histórico só lista dia+marca que
 * tem snapshot. `totalBalanco = saldoTransacional - saldoJogadores` — o sinal
 * foi corrigido em 30/07/2026 (a especificação original tinha o inverso);
 * inverter de novo durante a migração é regressão. Ver DADOS-FINANCE.md §3.4.
 */
@Entity('cash_balance_brand_snapshots')
export class CashBalanceBrandSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne(() => CashBalanceDaily, (daily) => daily.snapshot)
  @JoinColumn({ name: 'daily_id' })
  daily: CashBalanceDaily;

  @Column({ name: 'daily_id', unique: true })
  dailyId: number;

  @Column({
    name: 'saldo_transacional',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  saldoTransacional: number;

  @Column({
    name: 'saldo_jogadores',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  saldoJogadores: number;

  @Column({
    name: 'total_balanco',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  totalBalanco: number;

  @Column({
    name: 'acumulado_mensal',
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  acumuladoMensal: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
