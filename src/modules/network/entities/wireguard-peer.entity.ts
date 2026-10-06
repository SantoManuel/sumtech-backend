import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NetworkNodeEntity } from './network-node.entity';

export type WireguardPeerStatus = 'PENDING_MANUAL' | 'REGISTERED' | 'CONNECTED' | 'DISCONNECTED';

/**
 * Estado del peer de un nodo WireGuard en el hub central (Fase B —
 * Plan_WireGuard_Produccion.md). Un nodo WireGuard tiene a lo sumo un peer.
 */
@Entity({ schema: 'net', name: 'wireguard_peers' })
export class WireguardPeerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'node_id', type: 'uuid', unique: true })
  nodeId: string;

  @ManyToOne(() => NetworkNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node?: NetworkNodeEntity;

  @Column({ name: 'public_key', type: 'varchar', length: 64 })
  publicKey: string;

  @Column({ name: 'tunnel_ip', type: 'varchar', length: 45 })
  tunnelIp: string;

  @Column({ name: 'allowed_ips', type: 'varchar', length: 45 })
  allowedIps: string;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'PENDING_MANUAL' })
  status: WireguardPeerStatus;

  @Column({ name: 'last_handshake_at', type: 'timestamp with time zone', nullable: true })
  lastHandshakeAt?: Date;

  @Column({ name: 'last_registration_error', type: 'text', nullable: true })
  lastRegistrationError?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
