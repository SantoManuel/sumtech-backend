import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TenantEntity } from './tenant.entity';

/**
 * Índice CENTRAL (schema platform, cruza todos los tenants) de "IP pública
 * de un router -> a qué tenant pertenece". Necesario porque un cliente
 * suspendido en modo Portal de Aviso llega a nuestro servidor por un dst-nat
 * del MikroTik que NO identifica el tenant (el Host de la petición sigue
 * siendo el del sitio externo que el cliente quería visitar) -- la única
 * señal disponible es la IP de origen del router (masquerade de salida).
 *
 * Se mantiene sincronizada desde NetworkNodesService (tenant-schema) cada vez
 * que se crea/edita/borra un nodo con `publicIp` -- así, dar de alta un
 * tenant nuevo con el portal cautivo activado es solo una fila nueva acá,
 * nunca un cambio de código ni un redeploy de Traefik.
 */
@Entity({ schema: 'platform', name: 'node_portal_registry' })
export class NodePortalRegistryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: TenantEntity;

  /** Id del nodo dentro de la base de datos propia del tenant -- no es FK (bases distintas). */
  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @Column({ name: 'public_ip', type: 'varchar', length: 45, unique: true })
  publicIp: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
