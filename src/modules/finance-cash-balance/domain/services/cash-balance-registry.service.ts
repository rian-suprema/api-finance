import { Injectable } from '@nestjs/common';

import { ConfirmBankUseCase } from '../use-cases/confirm-bank.use-case';
import { RegisterBrandUseCase } from '../use-cases/register-brand.use-case';
import { ReopenBrandUseCase } from '../use-cases/reopen-brand.use-case';
import type { RegisterBrandResult } from '../cash-balance.types';
import { BrandAccessService } from './brand-access.service';

interface ConfirmBankInput {
  authorization: string;
  brandParam: string;
  bank: string;
  balance: number;
  date?: string;
  userId: string;
}

interface RegisterInput {
  authorization: string;
  brandParam: string;
  date?: string;
  userId: string;
}

interface ReopenInput {
  authorization: string;
  brandParam: string;
  date?: string;
}

/** Orquestra as escritas da tela. Sem regra de negócio. */
@Injectable()
export class CashBalanceRegistryService {
  constructor(
    private readonly access: BrandAccessService,
    private readonly confirmBank: ConfirmBankUseCase,
    private readonly registerBrand: RegisterBrandUseCase,
    private readonly reopenBrand: ReopenBrandUseCase,
  ) {}

  async confirm(input: ConfirmBankInput): Promise<void> {
    const referenceDate = this.access.resolveReferenceDate(input.date);
    const { brand, tenantId } = await this.access.requireBrand(
      input.authorization,
      input.brandParam,
    );

    await this.confirmBank.execute({
      referenceDate,
      brand,
      tenantId,
      bank: input.bank,
      balance: input.balance,
      userId: input.userId,
    });
  }

  async register(input: RegisterInput): Promise<RegisterBrandResult> {
    const referenceDate = this.access.resolveReferenceDate(input.date);
    const { brand, tenantId } = await this.access.requireBrand(
      input.authorization,
      input.brandParam,
    );

    return this.registerBrand.execute({
      referenceDate,
      brand,
      tenantId,
      userId: input.userId,
    });
  }

  async reopen(input: ReopenInput): Promise<void> {
    const referenceDate = this.access.resolveReferenceDate(input.date);
    const { brand } = await this.access.requireBrand(input.authorization, input.brandParam);

    await this.reopenBrand.execute({ referenceDate, brand });
  }
}
