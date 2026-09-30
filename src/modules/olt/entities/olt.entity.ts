import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ZoneEntity } from '../../network/entities/zone.entity';
import { OltRolePermissionEntity } from './olt-role-permission.entity';
import { OltInterfaceEntity } from './olt-interface.entity';

@Entity({ schema: 'net', name: 'olts' })
export class OltEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 50, default: 'ZTE' })
  vendor: string;

  @Column({ type: 'varchar', length: 50, default: 'C320' })
  model: string;

  @Column({ type: 'varchar', length: 255 })
  host: string;

  @Column({ type: 'int', default: 23 })
  port: number;

  @Column({ name: 'api_protocol', type: 'varchar', length: 50, default: 'TELNET' })
  apiProtocol: 'TELNET' | 'SSH';

  @Column({ type: 'varchar', length: 100 })
  username: string;

  @Column({ name: 'password_enc', type: 'text' })
  passwordEnc: string;

  @Column({ name: 'enable_password_enc', type: 'text', nullable: true })
  enablePasswordEnc?: string;

  @Column({
    name: 'connection_method',
    type: 'varchar',
    length: 50,
    default: 'VIA_MIKROTIK',
  })
  connectionMethod: 'VIA_MIKROTIK' | 'WIREGUARD' | 'PUBLIC_IP' | 'DIRECT';

  @Column({ name: 'via_node_id', type: 'uuid', nullable: true })
  viaNodeId?: string;

  @ManyToOne(() => NetworkNodeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'via_node_id' })
  viaNode?: NetworkNodeEntity;

  @Column({ name: 'nat_port', type: 'int', nullable: true })
  natPort?: number;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId?: string;

  @ManyToOne(() => ZoneEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  @Column({ type: 'varchar', length: 50, default: 'America/Santo_Domingo' })
  timezone: string;

  @Column({ type: 'varchar', length: 10, default: 'es' })
  language: string;

  @Column({ name: 'mgmt_vlan_id', type: 'int', nullable: true })
  mgmtVlanId?: number;

  @Column({ type: 'varchar', length: 50, default: 'ACTIVO' })
  status: 'ACTIVO' | 'INACTIVO' | 'MANTENIMIENTO';

  @Column({
    name: 'connection_status',
    type: 'varchar',
    length: 50,
    default: 'DESCONECTADO',
  })
  connectionStatus: 'CONECTADO' | 'DESCONECTADO' | 'ERROR_AUTH' | 'INALCANZABLE';

  @Column({ name: 'last_checked_at', type: 'timestamp with time zone', nullable: true })
  lastCheckedAt?: Date;

  @Column({ name: 'last_successful_connection_at', type: 'timestamp with time zone', nullable: true })
  lastSuccessfulConnectionAt?: Date;

  @Column({ name: 'firmware_version', type: 'varchar', length: 50, nullable: true })
  firmwareVersion?: string;

  @Column({ name: 'suspension_enabled', type: 'boolean', default: false })
  suspensionEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => OltRolePermissionEntity, (perm) => perm.olt, { cascade: true })
  rolePermissions?: OltRolePermissionEntity[];

  @OneToMany(() => OltInterfaceEntity, (iface) => iface.olt, { cascade: true })
  interfaces?: OltInterfaceEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
