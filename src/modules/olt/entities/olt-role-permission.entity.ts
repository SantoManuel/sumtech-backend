import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { OltEntity } from './olt.entity';

@Entity({ schema: 'net', name: 'olt_role_permissions' })
export class OltRolePermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @ManyToOne(() => OltEntity, (olt) => olt.rolePermissions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltEntity;

  @Column({ type: 'varchar', length: 50 })
  role: string;

  @Column({ name: 'can_view', type: 'boolean', default: true })
  canView: boolean;

  @Column({ name: 'can_operate', type: 'boolean', default: false })
  canOperate: boolean;

  @Column({ name: 'can_configure', type: 'boolean', default: false })
  canConfigure: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
