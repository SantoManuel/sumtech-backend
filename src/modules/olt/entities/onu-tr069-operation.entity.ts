import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';
import { Tr069Result } from '../ports/tr069-provisioning.types';

@Entity({ schema: 'net', name: 'onu_tr069_operations' })
@Index(['onuId', 'requestKey'], { unique: true })
export class OnuTr069OperationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'onu_id', type: 'uuid' }) onuId: string;
  @Column({ type: 'varchar', length: 12 }) kind: 'profile' | 'acs';
  @Column({ type: 'integer' }) version: number;
  @Column({ name: 'request_key', type: 'varchar', length: 100 }) requestKey: string;
  @Column({ type: 'varchar', length: 64, select: false }) fingerprint: string;
  @Column({ name: 'payload_enc', type: 'text', select: false, nullable: true }) payloadEnc: string | null;
  @Column({ type: 'varchar', length: 30 }) status: 'queued' | 'running' | 'failed' | 'partial' | 'applied_unverified' | 'verified';
  @Column({ type: 'varchar', length: 40, default: 'queued' }) stage: string;
  @Column({ type: 'jsonb', nullable: true }) result: Tr069Result | null;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId: string | null;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true }) finishedAt: Date | null;
  @Column({ name: 'next_check_at', type: 'timestamptz', nullable: true }) nextCheckAt: Date | null;
  @Column({ name: 'verification_checks', type: 'integer', default: 0 }) verificationChecks: number;
  @Column({ name: 'target_acs_url', type: 'varchar', length: 255 }) targetAcsUrl: string;
  @Column({ name: 'serial_number', type: 'varchar', length: 100 }) serialNumber: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
