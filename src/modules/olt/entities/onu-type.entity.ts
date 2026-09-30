import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'net', name: 'onu_types' })
export class OnuTypeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  vendor: string;

  @Column({ type: 'varchar', length: 50 })
  model: string;

  @Column({ name: 'vendor_type_name', type: 'varchar', length: 100 })
  vendorTypeName: string; // ej. 'ZTE-F660'

  @Column({ name: 'pon_type', type: 'varchar', length: 20, default: 'GPON' })
  ponType: string;

  @Column({ name: 'eth_ports', type: 'int', default: 4 })
  ethPorts: number;

  @Column({ name: 'pots_ports', type: 'int', default: 1 })
  potsPorts: number;

  @Column({ name: 'wifi_bands', type: 'varchar', length: 50, default: '2.4GHz' })
  wifiBands: string;

  @Column({ name: 'catv_port', type: 'boolean', default: false })
  catvPort: boolean;

  @Column({ name: 'supports_tr069', type: 'boolean', default: true })
  supportsTr069: boolean;

  @Column({ name: 'supports_omci', type: 'boolean', default: true })
  supportsOmci: boolean;

  @Column({ name: 'supports_bridge', type: 'boolean', default: true })
  supportsBridge: boolean;

  @Column({ name: 'supports_router', type: 'boolean', default: true })
  supportsRouter: boolean;

  @Column({ name: 'default_mode', type: 'varchar', length: 20, default: 'ROUTER' })
  defaultMode: 'ROUTER' | 'BRIDGE';

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
