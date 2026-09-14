import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ZoneEntity } from './zone.entity';
import { NetworkAccessEntity } from './network-access.entity';

/**
 * Nodo Mikrotik/NAS que da servicio a uno o varios accesos de red. Se llama
 * "NetworkNode", no "Router": la UI de Inventario ya usa "Router" para el
 * equipo CPE instalado en casa del cliente (ver pestaña Equipos & Seriales
 * del perfil 360° del cliente) y un técnico no puede confundir ambos.
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

  // 443, no 8728: la REST API de RouterOS (/rest/...) se sirve por el mismo
  // puerto que WebFig (www-ssl), no por el puerto de la API binaria clásica
  // (8728/8729) — ese puerto es para otro protocolo (librouteros) que este
  // módulo no usa.
  @Column({ name: 'api_port', type: 'int', default: 443 })
  apiPort: number;

  // Algunos nodos (ej. un CHR recién instalado) solo tienen "www" habilitado
  // y no "www-ssl" con certificado configurado — permite probar contra REST
  // por HTTP plano en vez de forzar HTTPS.
  @Column({ name: 'use_https', type: 'boolean', default: true })
  useHttps: boolean;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId?: string;

  @ManyToOne(() => ZoneEntity, (zone) => zone.nodes, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zone_id' })
  zone?: ZoneEntity;

  // MANUAL: el estado de red se administra a mano, sin llamar a ningún nodo real
  // (comportamiento por defecto y único disponible hasta la Fase 05 del plan de
  // integración). ROUTEROS: el nodo tiene un adaptador real de RouterOS activo.
  @Column({
    name: 'provisioning_mode',
    type: 'enum',
    enum: ['MANUAL', 'ROUTEROS'],
    default: 'MANUAL',
  })
  provisioningMode: 'MANUAL' | 'ROUTEROS';

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
