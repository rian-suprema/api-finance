import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Espelha o schema `User` da spec.
 * `password` tem @Exclude: NUNCA sai em resposta HTTP (o ClassSerializerInterceptor
 * global aplica). Autenticação/hash estão fora do escopo deste archetype — em
 * produção a senha jamais seria persistida em claro.
 */
@Entity('users')
export class User {
  @ApiProperty({ example: 10 })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 'theUser' })
  @Column({ length: 100, unique: true })
  username: string;

  // Coluna anulável exige `type` EXPLÍCITO: a união `string | null` reflete
  // como Object no emitDecoratorMetadata e o TypeORM aborta o boot com
  // DataTypeNotSupportedError. Regra do archetype: tipo de coluna nunca
  // depende de inferência — declare-o sempre que o TS não for um primitivo puro.
  @ApiPropertyOptional({ example: 'John' })
  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName?: string | null;

  @ApiPropertyOptional({ example: 'James' })
  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName?: string | null;

  @ApiPropertyOptional({ example: 'john@email.com' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string | null;

  @Exclude()
  @Column({ type: 'varchar', length: 255, nullable: true })
  password?: string | null;

  @ApiPropertyOptional({ example: '12345' })
  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @ApiProperty({ example: 1 })
  @Column({ name: 'user_status', default: 0 })
  userStatus: number;

  @Exclude()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Exclude()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
