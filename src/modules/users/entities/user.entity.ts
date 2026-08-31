import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  ManyToMany, 
  JoinTable, 
  OneToOne, 
  OneToMany 
} from 'typeorm';
import { RoleEntity } from './role.entity';
import { EmployeeEntity } from '../../employees/entities/employee.entity';
import { ClientEntity } from '../../clients/entities/client.entity';
import { AuditLogEntity } from './audit-log.entity';

@Entity({ schema: 'sec', name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @ManyToMany(() => RoleEntity, { eager: true })
  @JoinTable({
    schema: 'sec',
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: RoleEntity[];

  @OneToOne(() => EmployeeEntity, (employee) => employee.user, { nullable: true })
  employee?: EmployeeEntity;

  @OneToOne(() => ClientEntity, (client) => client.user, { nullable: true })
  client?: ClientEntity;

  @OneToMany(() => AuditLogEntity, (log) => log.user)
  auditLogs?: AuditLogEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
