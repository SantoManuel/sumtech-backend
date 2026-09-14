import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { NetworkNodeEntity } from './network-node.entity';

/**
 * Identidad de red de un contrato (Usuario/Servicio/Ip/Estado del sistema WISP
 * anterior). 1–1 con ContractEntity porque un acceso de red es un atributo del
 * contrato, no del cliente: dos contratos del mismo cliente tienen dos accesos.
 *
 * `connectionStatus` es intencionalmente independiente de `ContractEntity.status`:
 * uno es la verdad comercial (por qué se suspendió), el otro es la verdad de
 * la red (si el corte ya se aplicó). Se sincronizan por eventos de dominio
 * (Fase 02 del plan de integración), nunca se fusionan en un solo campo.
 */
@Entity({ schema: 'net', name: 'network_access' })
export class NetworkAccessEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id', type: 'uuid', unique: true })
  contractId: string;

  @ManyToOne(() => ContractEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: ContractEntity;

  @Column({ name: 'node_id', type: 'uuid', nullable: true })
  nodeId?: string;

  @ManyToOne(() => NetworkNodeEntity, (node) => node.accesses, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'node_id' })
  node?: NetworkNodeEntity;

  @Column({ type: 'varchar', length: 150, nullable: true })
  username?: string;

  @Column({ name: 'service_alias', type: 'varchar', length: 50, nullable: true })
  serviceAlias?: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress?: string;

  @Column({
    name: 'connection_status',
    type: 'enum',
    enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'CUT'],
    default: 'PENDING',
  })
  connectionStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CUT';

  @Column({
    name: 'provisioning_source',
    type: 'enum',
    enum: ['MANUAL', 'ROUTEROS'],
    default: 'MANUAL',
  })
  provisioningSource: 'MANUAL' | 'ROUTEROS';

  @Column({ name: 'last_sync_at', type: 'timestamp with time zone', nullable: true })
  lastSyncAt?: Date;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
