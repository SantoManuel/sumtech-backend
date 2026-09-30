import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VlanEntity } from './vlan.entity';

@Entity({ schema: 'net', name: 'tr069_networks' })
export class Tr069NetworkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  cidr: string; // ej. '10.15.160.0/22'

  @Column({ name: 'vlan_id', type: 'uuid', nullable: true })
  vlanId?: string;

  @ManyToOne(() => VlanEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vlan_id' })
  vlan?: VlanEntity;

  @Column({ type: 'varchar', length: 45 })
  gateway: string;

  @Column({ name: 'dhcp_mode', type: 'varchar', length: 20, default: 'DHCP_SERVER' })
  dhcpMode: 'DHCP_SERVER' | 'STATIC' | 'RELAY';

  @Column({ name: 'acs_url', type: 'varchar', length: 255 })
  acsUrl: string;

  @Column({ name: 'acs_username', type: 'varchar', length: 100, nullable: true })
  acsUsername?: string;

  @Column({ name: 'acs_password_enc', type: 'text', nullable: true })
  acsPasswordEnc?: string;

  @Column({ name: 'conn_req_username', type: 'varchar', length: 100, nullable: true })
  connReqUsername?: string;

  @Column({ name: 'conn_req_password_enc', type: 'text', nullable: true })
  connReqPasswordEnc?: string;

  @Column({ name: 'inform_interval_sec', type: 'int', default: 300 })
  informIntervalSec: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
