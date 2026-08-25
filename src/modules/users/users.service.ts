import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { tenantManager } from '../../database/tenant-context';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedUsersDto } from './dto/paginated-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

/**
 * Isolamento multi-tenant (SayPlus) em DUAS camadas ativas:
 * 1) Aplicação — TODA operação recebe o `tenantId` do claim (via @CurrentUser)
 *    e o aplica em TODA query; nenhum método aceita tenant de dados do cliente.
 * 2) Banco (RLS) — as queries correm no EntityManager transacional do contexto
 *    (tenantManager), sob o GUC `app.tenant_id`; mesmo um filtro esquecido aqui
 *    não vaza, porque a policy do Postgres corta por baixo.
 *
 * Por isso o repositório vem de `tenantManager(dataSource)` — não de um
 * `Repository` injetado fixo, que ignoraria a transação com o GUC.
 */
@Injectable()
export class UsersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private get users(): Repository<User> {
    return tenantManager(this.dataSource).getRepository(User);
  }

  async create(tenantId: string, dto: CreateUserDto): Promise<User> {
    const existing = await this.users.findOne({ where: { tenantId, username: dto.username } });
    if (existing) {
      throw new ConflictException(`Username '${dto.username}' already exists`);
    }
    return this.users.save(this.users.create({ ...dto, tenantId }));
  }

  async createWithList(tenantId: string, dtos: CreateUserDto[]): Promise<User[]> {
    const created: User[] = [];
    for (const dto of dtos) {
      created.push(await this.create(tenantId, dto));
    }
    return created;
  }

  /**
   * Lista paginada do tenant. `findAndCount` faz a paginação NO BANCO — vira
   * `SELECT ... LIMIT take OFFSET skip` + um `COUNT(*)`; nunca carrega tudo em
   * memória. `order` estável (id) torna a paginação determinística.
   */
  async findAll(
    tenantId: string,
    { page, pageSize }: ListUsersQueryDto,
  ): Promise<PaginatedUsersDto> {
    const [data, total] = await this.users.findAndCount({
      where: { tenantId },
      order: { id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, total, page, pageSize };
  }

  async findByUsername(tenantId: string, username: string): Promise<User> {
    const user = await this.users.findOne({ where: { tenantId, username } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(tenantId: string, username: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findByUsername(tenantId, username);
    Object.assign(user, dto);
    return this.users.save(user);
  }

  async remove(tenantId: string, username: string): Promise<void> {
    const user = await this.findByUsername(tenantId, username);
    await this.users.remove(user);
  }
}
