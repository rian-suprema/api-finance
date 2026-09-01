import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches } from 'class-validator';

import { ISO_DATE_PATTERN as ISO_DATE } from '../../../common/utils/date.util';

export class CashBalanceQueryDto {
  @ApiPropertyOptional({
    description: 'Data de referência (YYYY-MM-DD). Padrão: dia anterior em BRT.',
    example: '2026-07-29',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}

/**
 * Intervalo do histórico. Ambos opcionais: sem eles a API devolve os últimos
 * 15 dias encerrando no dia anterior em BRT.
 */
export class CashBalanceHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Início do intervalo (YYYY-MM-DD). Padrão: 14 dias antes de `to`.',
    example: '2026-07-15',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Fim do intervalo (YYYY-MM-DD). Padrão: dia anterior em BRT.',
    example: '2026-07-29',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}

export class ConfirmBankDto {
  @ApiProperty({ description: 'Saldo do banco em reais', example: 1234567.89 })
  @IsNumber({ maxDecimalPlaces: 2 })
  balance: number;

  @ApiPropertyOptional({ description: 'Data de referência (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}

/**
 * O registro não recebe saldos: usa o que já foi confirmado banco por banco
 * (`POST /:brand/banks/:bank/confirm`). Sem isso, o corpo da requisição
 * contornaria a exigência de confirmação individual.
 */
export class RegisterBrandDto {
  @ApiPropertyOptional({ description: 'Data de referência (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}
