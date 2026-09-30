import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'net', name: 'olt_speed_profiles' })
export class OltSpeedProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'down_kbps', type: 'int' })
  downKbps: number;

  @Column({ name: 'up_kbps', type: 'int' })
  upKbps: number;

  @Column({ name: 'vendor_tcont_profile', type: 'varchar', length: 100, nullable: true })
  vendorTcontProfile?: string;

  @Column({ name: 'vendor_traffic_profile', type: 'varchar', length: 100, nullable: true })
  vendorTrafficProfile?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
