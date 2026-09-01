import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TrioClosingBalanceMethod } from '../cash-balance.enums';
import type { BrandKey } from '../cash-balance.constants';
import type {
  ClosingBalanceCapture,
  ClosingBalanceMethod,
} from '../domain/ports/closing-balance-source.port';
import { TrioClosingBalance } from '../entities/trio-closing-balance.entity';

/** Único ponto que toca o TypeORM para `trio_closing_balances`. */

export interface StoredClosingBalance {
  brand: BrandKey;
  balance: number;
  capturedAt: Date;
  exact: boolean;
  method: ClosingBalanceMethod;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class TrioClosingBalanceRepository {
  constructor(
    @InjectRepository(TrioClosingBalance)
    private readonly repository: Repository<TrioClosingBalance>,
  ) {}

  /** Fechamentos gravados para a data, indexados por marca. */
  async findByDate(
    referenceDate: string,
    brands: BrandKey[],
  ): Promise<Map<BrandKey, StoredClosingBalance>> {
    if (brands.length === 0) return new Map();

    const rows = await this.repository
      .createQueryBuilder('closing')
      .where('closing.referenceDate = :referenceDate', { referenceDate })
      .andWhere('closing.brand IN (:...brands)', { brands })
      .getMany();

    return new Map(
      rows.map((row) => [
        row.brand as BrandKey,
        {
          brand: row.brand as BrandKey,
          balance: row.balance,
          capturedAt: row.capturedAt,
          exact: row.exact,
          method: row.method,
        },
      ]),
    );
  }

  /**
   * Grava o fechamento. `overwrite = false` faz a gravação falhar em silêncio se
   * a linha já existir: é o que garante que uma segunda instância do job não
   * sobrescreva a captura da primeira.
   */
  async save(
    referenceDate: string,
    capture: ClosingBalanceCapture,
    overwrite: boolean,
  ): Promise<boolean> {
    const data = {
      referenceDate,
      brand: capture.brand,
      bankAccountId: capture.accountId,
      balance: capture.balance,
      cutoffAt: capture.cutoffAt,
      capturedAt: capture.capturedAt,
      exact: capture.exact,
      method: capture.method as TrioClosingBalanceMethod,
    };

    // `insert` em vez de ler-e-decidir: a unique (reference_date, brand) é o que
    // serializa duas instâncias do job. Ler antes deixaria janela de corrida.
    if (!overwrite) {
      try {
        await this.repository.insert(data);
        return true;
      } catch (error) {
        if (this.isUniqueViolation(error)) return false;
        throw error;
      }
    }

    const existing = await this.repository.findOne({
      where: { referenceDate, brand: capture.brand },
    });

    if (existing) {
      await this.repository.update(existing.id, data);
    } else {
      await this.repository.insert(data);
    }

    return true;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === UNIQUE_VIOLATION
    );
  }
}
