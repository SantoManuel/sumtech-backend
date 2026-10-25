import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Catálogo de parámetros TR-069 de fabricante (Security §3.12 / Miscellaneous
 * §3.14 del plan) -- ningún OID entra acá sin haberse confirmado en vivo
 * contra un equipo real de ese vendor/modelo (mismo criterio que ya se usó
 * para ZTE/HiOSO en el resto del proyecto). Nace vacía: la existencia de una
 * fila ES la verificación, no hace falta un flag aparte.
 */
@Entity({ schema: 'net', name: 'cpe_vendor_parameters' })
export class CpeVendorParameterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Se compara contra `_deviceId._Manufacturer` (case-insensitive). */
  @Column({ type: 'varchar', length: 100 })
  vendor: string;

  /** Substring contra ProductClass/ModelName -- null = aplica a cualquier modelo de ese vendor. */
  @Column({ name: 'model_pattern', type: 'varchar', length: 100, nullable: true })
  modelPattern?: string | null;

  @Column({ type: 'enum', enum: ['SECURITY', 'MISCELLANEOUS'] })
  category: 'SECURITY' | 'MISCELLANEOUS';

  @Column({ name: 'parameter_key', type: 'varchar', length: 100 })
  parameterKey: string;

  @Column({ type: 'varchar', length: 150 })
  label: string;

  @Column({ name: 'oid_path', type: 'varchar', length: 500 })
  oidPath: string;

  @Column({ name: 'data_type', type: 'varchar', length: 20, default: 'xsd:boolean' })
  dataType: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true })
  createdBy?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
