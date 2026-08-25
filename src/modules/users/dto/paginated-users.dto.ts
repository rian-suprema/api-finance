import { ApiProperty } from '@nestjs/swagger';

import { User } from '../entities/user.entity';

/** Envelope de resposta paginada de GET /user (documentado no Swagger). */
export class PaginatedUsersDto {
  @ApiProperty({ type: [User], description: 'Itens da página atual' })
  data: User[];

  @ApiProperty({ example: 42, description: 'Total de registros do tenant (todas as páginas)' })
  total: number;

  @ApiProperty({ example: 1, description: 'Página atual (1-based)' })
  page: number;

  @ApiProperty({ example: 20, description: 'Itens por página' })
  pageSize: number;
}
