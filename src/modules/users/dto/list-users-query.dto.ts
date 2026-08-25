import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query de GET /user — paginação por OFFSET. A paginação acontece no BANCO
 * (`skip`/`take` viram `LIMIT`/`OFFSET` no SQL), nunca em memória: o banco
 * devolve só a página pedida. `pageSize` tem TETO para impedir uma página
 * gigante (proteção contra scan/allocação abusiva).
 *
 * Evolução p/ volumes muito grandes: OFFSET fica caro em páginas altas (o
 * banco varre e descarta as puladas) — aí o padrão é keyset/cursor pagination
 * (WHERE id > :ultimoId). Offset é o suficiente e mais simples para o comum.
 */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Página (1-based)', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ description: 'Itens por página', default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  pageSize: number = 20;
}
