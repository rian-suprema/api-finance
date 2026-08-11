// [EXEMPLO] Módulo do domínio Users — demonstra a arquitetura; apague ao
// criar o seu módulo real (guia de adoção no README, seção "Adotando o archetype").
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
