import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Espelha o schema `User` da spec, com isolamento multi-tenant (SayPlus).
 * `password` tem @Exclude: NUNCA sai em resposta HTTP (o ClassSerializerInterceptor
 * global aplica). Autenticação/hash são da plataforma SayPlus — em
 * produção a senha jamais seria persistida em claro.
 *
 * Unicidade de `username` é POR TENANT (constraint composta): o mesmo username
 * pode existir em tenants diferentes — cada tenant vive numa fatia isolada.
 */
@Entity('users')
@Unique('uq_users_tenant_username', ['tenantId', 'username'])
export class User {
  @ApiProperty({ example: 10 })
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * Dono do registro — vem SEMPRE do claim `tenantId` do JWT (@CurrentUser),
   * nunca de body/header. @Exclude: coluna interna de isolamento, não faz
   * parte do contrato de resposta da API.
   */
  @Exclude()
  @Column({ name: 'tenant_id', length: 100 })
  tenantId: string;

  @ApiProperty({ example: 'theUser' })
  @Column({ length: 100 })
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
