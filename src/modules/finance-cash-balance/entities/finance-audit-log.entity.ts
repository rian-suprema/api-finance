import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Auditoria local — tabela sem FK, append-only. `entity`/`entityId` são texto
 * livre, extraídos da URL pelo interceptor de auditoria (Fase futura). `after`
 * guarda a resposta inteira, não o estado anterior — não há `before`. Ver
 * DADOS-FINANCE.md §5.
 */
@Entity('finance_audit_logs')
@Index(['userId', 'createdAt'])
@Index(['entity', 'entityId'])
export class FinanceAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'varchar', length: 100 })
  userId: string;

  @Column({ name: 'tenant_id', type: 'varchar', length: 100, nullable: true })
  tenantId?: string | null;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'varchar', length: 100 })
  entity: string;

  // Nunca preenchido pelo interceptor atual — mantido por paridade com a
  // origem (metade do índice (entity, entityId) é decorativa hoje).
  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  entityId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  after?: unknown;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ip?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
