import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

import { ISO_DATE_PATTERN as ISO_DATE } from '../../../common/utils/date.util';
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from '../reconciliation.constants';

export class ReconciliationQueryDto {
  @ApiPropertyOptional({
    description: 'Data de referência (YYYY-MM-DD). Padrão: dia anterior em BRT.',
    example: '2026-08-15',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}

export class ReconciliationHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Início do intervalo (YYYY-MM-DD). Padrão: 14 dias antes de `to`.',
    example: '2026-08-01',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'from deve estar no formato YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Fim do intervalo (YYYY-MM-DD). Padrão: dia anterior em BRT.',
    example: '2026-08-15',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'to deve estar no formato YYYY-MM-DD' })
  to?: string;
}

export class RunReconciliationDto {
  @ApiPropertyOptional({ description: 'Data de referência (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}

export class ApplyCorrectionsDto {
  @ApiPropertyOptional({ description: 'Data de referência (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date deve estar no formato YYYY-MM-DD' })
  date?: string;
}

export class ResolveItemDto {
  @ApiProperty({
    description: 'Justificativa do porquê o lançamento não tem par — registro contábil.',
    example: 'PIX devolvido ao jogador pelo banco; depósito nunca foi creditado na plataforma.',
    minLength: MIN_NOTE_LENGTH,
    maxLength: MAX_NOTE_LENGTH,
  })
  @IsString()
  @Length(MIN_NOTE_LENGTH, MAX_NOTE_LENGTH)
  note: string;
}
