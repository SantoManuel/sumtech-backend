import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';

/**
 * Un refresh token JWT emitido, identificado por el hash SHA-256 de su valor
 * en claro (nunca se persiste el token real). `familyId` agrupa toda una
 * cadena de rotación: en cada /auth/refresh se revoca la fila actual y se
 * crea una nueva con el mismo familyId — si un token ya revocado se vuelve a
 * presentar, es señal de robo y se revoca la familia entera.
 */
@Entity({ schema: 'sec', name: 'refresh_tokens' })
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Index()
  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  @Column({ name: 'replaced_by_token_hash', type: 'varchar', length: 64, nullable: true })
  replacedByTokenHash?: string;

  @Column({ name: 'revoked_at', type: 'timestamp with time zone', nullable: true })
  revokedAt?: Date;

  @Column({ name: 'user_agent', type: 'varchar', length: 300, nullable: true })
  userAgent?: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({ name: 'expires_at', type: 'timestamp with time zone' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
