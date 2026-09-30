import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { PlatformRole } from '../enums/platform-role.enum';

// Tabla independiente de sec.users (tenant) — un SuperAdmin/Support de la
// plataforma NUNCA es un usuario de ningún tenant, ni comparte JWT/secreto.
@Entity({ schema: 'platform', name: 'platform_users' })
export class PlatformUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: PlatformRole, default: PlatformRole.SUPPORT })
  role: PlatformRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
