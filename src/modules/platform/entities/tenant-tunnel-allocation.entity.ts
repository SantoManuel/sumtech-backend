import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantEntity } from './tenant.entity';

@Entity({ schema: 'platform', name: 'tenant_tunnel_allocations' })
export class TenantTunnelAllocationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: TenantEntity;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @Column({ name: 'tunnel_type', type: 'varchar', length: 30, default: 'WIREGUARD' })
  tunnelType: string;

  @Column({ name: 'assigned_ip', type: 'varchar', length: 45, unique: true })
  assignedIp: string;

  @Column({ name: 'server_endpoint', type: 'varchar', length: 255 })
  serverEndpoint: string;

  @Column({ name: 'server_public_key', type: 'varchar', length: 64 })
  serverPublicKey: string;

  @Column({ name: 'client_public_key', type: 'varchar', length: 64 })
  clientPublicKey: string;

  @Column({ name: 'client_preshared_key', type: 'varchar', length: 64, nullable: true })
  clientPresharedKey?: string;

  @Column({ name: 'subnet_cidr', type: 'varchar', length: 30 })
  subnetCidr: string;

  @Column({ name: 'listen_port', type: 'int', default: 51820 })
  listenPort: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
