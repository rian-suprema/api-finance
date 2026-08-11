import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.users.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new ConflictException(`Username '${dto.username}' already exists`);
    }
    return this.users.save(this.users.create(dto));
  }

  async createWithList(dtos: CreateUserDto[]): Promise<User[]> {
    const created: User[] = [];
    for (const dto of dtos) {
      created.push(await this.create(dto));
    }
    return created;
  }

  async findByUsername(username: string): Promise<User> {
    const user = await this.users.findOne({ where: { username } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(username: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findByUsername(username);
    Object.assign(user, dto);
    return this.users.save(user);
  }

  async remove(username: string): Promise<void> {
    const user = await this.findByUsername(username);
    await this.users.remove(user);
  }
}
