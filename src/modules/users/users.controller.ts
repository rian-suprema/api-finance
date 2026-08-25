import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseArrayPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtPayload } from '../../auth/jwt-payload.interface';
import { PETSHOP_USERS } from '../../auth/permissions.constants';
import { Permissions } from '../../auth/permissions.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedUsersDto } from './dto/paginated-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Endpoints de usuário da spec — exceto /user/login e /user/logout: quem
 * autentica é a plataforma SayPlus; este módulo CONSOME o JWT dela e declara
 * em cada rota o code de permissão exigido (@Permissions).
 */
@ApiBearerAuth()
@ApiTags('user')
@Controller('user')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Permissions(PETSHOP_USERS.CREATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create user', operationId: 'createUser' })
  @ApiResponse({ status: 200, type: User })
  createUser(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto): Promise<User> {
    // tenant vem SEMPRE do claim do JWT — nunca de body/header
    return this.usersService.create(user.tenantId, dto);
  }

  @Post('createWithList')
  @Permissions(PETSHOP_USERS.CREATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Creates list of users with given input array',
    operationId: 'createUsersWithListInput',
  })
  @ApiBody({ type: [CreateUserDto] })
  @ApiResponse({ status: 200, type: [User] })
  createUsersWithListInput(
    @CurrentUser() user: JwtPayload,
    // ParseArrayPipe: valida cada item do array com as regras do CreateUserDto
    @Body(new ParseArrayPipe({ items: CreateUserDto })) dtos: CreateUserDto[],
  ): Promise<User[]> {
    return this.usersService.createWithList(user.tenantId, dtos);
  }

  @Get()
  @Permissions(PETSHOP_USERS.READ)
  @ApiOperation({
    summary: 'List users (paginated)',
    description:
      'Lista paginada dos usuários do tenant do JWT. Paginação por OFFSET executada no ' +
      'banco (LIMIT/OFFSET) — nunca em memória. A resposta traz `total` para o cliente ' +
      'calcular o número de páginas. `pageSize` tem teto de 100.',
    operationId: 'listUsers',
  })
  @ApiResponse({
    status: 200,
    type: PaginatedUsersDto,
    description: 'Página de usuários do tenant',
  })
  @ApiResponse({
    status: 400,
    description: 'Parâmetros de paginação inválidos (ex.: pageSize > 100 ou não inteiro)',
  })
  listUsers(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedUsersDto> {
    // tenant SEMPRE do claim; a paginação (skip/take) roda no banco, não em memória
    return this.usersService.findAll(user.tenantId, query);
  }

  @Get(':username')
  @Permissions(PETSHOP_USERS.READ)
  @ApiOperation({ summary: 'Get user by user name', operationId: 'getUserByName' })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserByName(
    @CurrentUser() user: JwtPayload,
    @Param('username') username: string,
  ): Promise<User> {
    return this.usersService.findByUsername(user.tenantId, username);
  }

  @Put(':username')
  @Permissions(PETSHOP_USERS.EDIT)
  @ApiOperation({ summary: 'Update user resource', operationId: 'updateUser' })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  updateUser(
    @CurrentUser() user: JwtPayload,
    @Param('username') username: string,
    @Body() dto: UpdateUserDto,
  ): Promise<User> {
    return this.usersService.update(user.tenantId, username, dto);
  }

  @Delete(':username')
  @Permissions(PETSHOP_USERS.DELETE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user resource', operationId: 'deleteUser' })
  @ApiResponse({ status: 200, description: 'User deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteUser(
    @CurrentUser() user: JwtPayload,
    @Param('username') username: string,
  ): Promise<void> {
    await this.usersService.remove(user.tenantId, username);
  }
}
