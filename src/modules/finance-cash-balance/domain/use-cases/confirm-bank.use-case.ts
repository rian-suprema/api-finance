import { BadRequestException, Injectable } from '@nestjs/common';

import { roundCurrency } from '../../../../common/utils/number.util';
import { findBank, TRIO_BANK_KEY, type BrandKey } from '../../cash-balance.constants';
import { CashBalanceRepository } from '../../infrastructure/cash-balance.repository';

interface ConfirmBankParams {
  referenceDate: string;
  brand: BrandKey;
  tenantId: string;
  bank: string;
  balance: number;
  userId: string;
}

/**
 * Confirma o saldo de um banco manual da marca. O botão OK da marca só libera
 * quando todos os bancos estão confirmados.
 */
@Injectable()
export class ConfirmBankUseCase {
  constructor(private readonly repository: CashBalanceRepository) {}

  async execute(params: ConfirmBankParams): Promise<void> {
    const bank = findBank(params.bank);

    if (!bank) throw new BadRequestException('Banco não reconhecido');

    if (bank.key === TRIO_BANK_KEY) {
      throw new BadRequestException('Saldo da Trio é somente leitura');
    }

    await this.repository.confirmBank({
      ...params,
      bank: bank.key,
      balance: roundCurrency(params.balance),
    });
  }
}
