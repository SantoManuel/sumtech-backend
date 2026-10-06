import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ZoneEntity } from './zone.entity';
import { NetworkAccessEntity } from './network-access.entity';

export type NetworkNodeConnectionMethod = 'wireguard' | 'ddns' | 'public_ip' | 'api' | 'ssh';
export type NetworkNodeStatus = 'ACTIVE' | 'UNREACHABLE' | 'ERROR_AUTH' | 'MAINTENANCE' | 'PROVISIONING';
export type NetworkNodeTransportType = 'REST' | 'ROUTEROS_API' | 'SSH';

/**
 * Nodo Mikrotik/NAS que da servicio a uno o varios accesos de red.
 * Persistido en el esquema "net" de cada tenant con soporte multimetodo
 * de conexion (WireGuard, DDNS, IP Publica, API directa, SSH).
 */
@Entity({ schema: 'net', name: 'network_nodes' })
export class NetworkNodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model?: string;

  @Column({ name: 'management_ip', type: 'varchar', length: 45, nullable: true })
  managementIp?: string;

  @Column({ name: 'api_port', type: 'int', default: 443 })
  apiPort: number;

  @Column({ name: 'use_https', type: 'boolean', default: true })
  useHttps: boolean;

  @Column({
    name: 'connection_method',
    type: 'varchar',
    length: 30,
    default: 'wireguard',
  })
  connectionMethod: NetworkNodeConnectionMethod;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 30,
    default: 'PROVISIONING',
  })
  status: NetworkNodeStatus;

  @Column({
    name: 'transport_type',
    type: 'varchar',
    length: 30,
    default: 'REST',
  })
  transportType: NetworkNodeTransportType;

  @Column({ name: 'ddns_hostname', type: 'varchar', length: 255, nullable: true })
  ddnsHostname?: string;

  @Column({ name: 'wireguard_public_key', type: 'varchar', length: 64, nullable: true })
  wireguardPublicKey?: string;

  @Column({ name: 'wireguard_private_key_enc', type: 'text', nullable: true })
  wireguardPrivateKeyEnc?: string;

  @Column({ name: 'wireguard_listen_port', type: 'int', default: 51820 })
  wireguardListenPort: number;

  @Column({ name: 'wireguard_ip', type: 'varchar', length: 45, nullable: true })
  wireguardIp?: string;

  @Column({ name: 'api_user', type: 'varchar', length: 100, nullable: true })
  apiUser?: string;

  @Column({ name: 'api_password_enc', type: 'text', nullable: true })
  apiPasswordEnc?: string;

  @Column({ name: 'ssh_port', type: 'int', default: 22 })
  sshPort: number;

  @Column({ name: 'routeros_version', type: 'varchar', length: 50, nullable: true })
  routerosVersion?: string;

  @Column({ name: 'last_heartbeat_at', type: 'timestamp with time zone', nullable: true })
  lastHeartbeatAt?: Date;

  @Column({ name: 'cpu_usage', type: 'numeric', precision: 5, scale: 2, nullable: true })
  cpuUsage?: number;

  @Column({ name: 'memory_free_bytes', type: 'bigint', nullable: true })
  memoryFreeBytes?: number;

  @Column({ name: 'memory_total_bytes', type: 'bigint', nullable: true })
  memoryTotalBytes?: number;

  @Column({ name: 'disk_free_bytes', type: 'bigint', nullable: true })
  diskFreeBytes?: number;

  @Column({ name: 'disk_total_bytes', type: 'bigint', nullable: true })
  diskTotalBytes?: number;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds?: number;

  @Column({ name: 'temperature_celsius', type: 'numeric', precision: 4, scale: 1, nullable: true })
  temperatureCelsius?: number;

  @Column({ name: 'voltage', type: 'numeric', precision: 4, scale: 1, nullable: true })
  voltage?: number;

  @Column({ name: 'default_parent_queue', type: 'varchar', length: 100, nullable: true })
  defaultParentQueue?: string;

  @Column({ name: 'default_ppp_pool', type: 'varchar', length: 100, nullable: true })
  defaultPppPool?: string;

  @Column({ name: 'last_error_code', type: 'varchar', length: 50, nullable: true })
  lastErrorCode?: string;

  @Column({ name: 'last_error_message', type: 'text', nullable: true })
  lastErrorMessage?: string;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId?: string;

  @ManyToOne(() => ZoneEntity, (zone) => zone.nodes, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  @Column({
    name: 'provisioning_mode',
    type: 'enum',
    enum: ['MANUAL', 'ROUTEROS'],
    default: 'MANUAL',
  })
  provisioningMode: 'MANUAL' | 'ROUTEROS';

  @Column({
    name: 'suspension_medium',
    type: 'varchar',
    length: 30,
    default: 'PPPOE',
  })
  suspensionMedium: 'PPPOE' | 'OLT_NATIVE';

  @Column({
    name: 'suspension_mode',
    type: 'varchar',
    length: 30,
    default: 'DISABLED',
  })
  suspensionMode: 'DISABLED' | 'DISABLE_SECRET' | 'NOTICE_PORTAL';

  @Column({ name: 'portal_installed', type: 'boolean', default: false })
  portalInstalled: boolean;

  @Column({ name: 'portal_installed_at', type: 'timestamp with time zone', nullable: true })
  portalInstalledAt?: Date;

  @Column({
    name: 'portal_rules_status',
    type: 'varchar',
    length: 30,
    default: 'NOT_INSTALLED',
  })
  portalRulesStatus: 'NOT_INSTALLED' | 'INSTALLED' | 'ERROR';

  @Column({ name: 'portal_ip', type: 'varchar', length: 45, nullable: true })
  portalIp?: string;

  @Column({ name: 'portal_port', type: 'int', default: 80 })
  portalPort: number;

  @Column({ name: 'last_sync_at', type: 'timestamp with time zone', nullable: true })
  lastSyncAt?: Date;

  @Column({
    name: 'last_sync_status',
    type: 'enum',
    enum: ['NEVER', 'OK', 'ERROR'],
    default: 'NEVER',
  })
  lastSyncStatus: 'NEVER' | 'OK' | 'ERROR';

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => NetworkAccessEntity, (access) => access.node)
  accesses?: NetworkAccessEntity[];

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp with time zone', nullable: true })
  deletedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
