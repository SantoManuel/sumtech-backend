import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type OltObservedState = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

@Entity({ schema: 'net', name: 'olt_partial_operations' })
export class OltPartialOperationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @Column({ name: 'onu_id', type: 'uuid', nullable: true })
  onuId: string | null;

  @Column({ type: 'varchar', length: 80 })
  operation: string;

  @Column({ name: 'resource_key', type: 'varchar', length: 200 })
  resourceKey: string;

  @Column({ name: 'expected_state', type: 'varchar', length: 20 })
  expectedState: 'PRESENT' | 'ABSENT';

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: 'PENDING' | 'RECONCILED';

  @Column({ name: 'last_observed_state', type: 'varchar', length: 20, nullable: true })
  lastObservedState: OltObservedState | null;

  @Column({ name: 'last_observed_at', type: 'timestamptz', nullable: true })
  lastObservedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'reconciled_at', type: 'timestamptz', nullable: true })
  reconciledAt: Date | null;
}
