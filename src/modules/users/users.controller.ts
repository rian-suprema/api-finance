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
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

/**
 * Endpoints de usuário da spec — exceto /user/login e /user/logout, que são
 * autenticação (fora do escopo deste archetype, por decisão registrada).
 */
@ApiTags('user')
@Controller('user')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create user', operationId: 'createUser' })
  @ApiResponse({ status: 200, type: User })
  createUser(@Body() dto: CreateUserDto): Promise<User> {
    return this.usersService.create(dto);
  }

  @Post('createWithList')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Creates list of users with given input array',
    operationId: 'createUsersWithListInput',
  })
  @ApiBody({ type: [CreateUserDto] })
  @ApiResponse({ status: 200, type: [User] })
  createUsersWithListInput(
    // ParseArrayPipe: valida cada item do array com as regras do CreateUserDto
    @Body(new ParseArrayPipe({ items: CreateUserDto })) dtos: CreateUserDto[],
  ): Promise<User[]> {
    return this.usersService.createWithList(dtos);
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get user by user name', operationId: 'getUserByName' })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  getUserByName(@Param('username') username: string): Promise<User> {
    return this.usersService.findByUsername(username);
  }

  @Put(':username')
  @ApiOperation({ summary: 'Update user resource', operationId: 'updateUser' })
  @ApiResponse({ status: 200, type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  updateUser(@Param('username') username: string, @Body() dto: UpdateUserDto): Promise<User> {
    return this.usersService.update(username, dto);
  }

  @Delete(':username')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user resource', operationId: 'deleteUser' })
  @ApiResponse({ status: 200, description: 'User deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteUser(@Param('username') username: string): Promise<void> {
    await this.usersService.remove(username);
  }
}
