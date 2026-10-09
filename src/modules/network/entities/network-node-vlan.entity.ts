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
import { VlanEntity } from '../../olt/entities/vlan.entity';

export type NetworkNodeVlanApplyStatus = 'PENDING' | 'APPLIED' | 'ERROR';

/**
 * VLAN que debe existir en un nodo MikroTik, sobre una interfaz física dada
 * (típicamente el puerto que conecta a la OLT). Equivalente de
 * OltInterfaceVlanEntity pero para el router — ver migración 078. Varias
 * filas apuntando a la misma `uplinkInterface` son, por definición, lo que
 * en un switch Cisco se llamaría un puerto "trunk": RouterOS no tiene un
 * modo trunk separado, cada VLAN es su propia sub-interfaz.
 */
@Entity({ schema: 'net', name: 'network_node_vlans' })
export class NetworkNodeVlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @ManyToOne(() => NetworkNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'node_id' })
  node: NetworkNodeEntity;

  @Column({ name: 'vlan_id', type: 'uuid' })
  vlanId: string;

  @ManyToOne(() => VlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vlan_id' })
  vlan: VlanEntity;

  @Column({ name: 'uplink_interface', type: 'varchar', length: 50 })
  uplinkInterface: string;

  @Column({ name: 'gateway_cidr', type: 'varchar', length: 45, nullable: true })
  gatewayCidr?: string;

  @Column({ name: 'apply_status', type: 'varchar', length: 30, default: 'PENDING' })
  applyStatus: NetworkNodeVlanApplyStatus;

  @Column({ name: 'last_sync_at', type: 'timestamp with time zone', nullable: true })
  lastSyncAt?: Date;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
