import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Registro inmutable de cada acción ejecutada sobre una ONU/CPE gestionada
 * por GenieACS (cambio de WiFi, reinicio remoto). Mismo espíritu que
 * ProvisioningAuditLogEntity del módulo de red Mikrotik: sin esto, un
 * reclamo de "me cambiaron mi WiFi sin avisarme" no se puede resolver con
 * datos reales.
 */
@Entity({ schema: 'net', name: 'genieacs_audit_log' })
export class GenieAcsAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Denormalizado a propósito, igual que en provisioning_audit_log: permite
  // auditar por contrato incluso si el vínculo con GenieACS se borra o cambia.
  @Column({ name: 'contract_id', type: 'uuid' })
  contractId: string;

  @Column({ name: 'genieacs_device_id', type: 'varchar', length: 255, nullable: true })
  genieacsDeviceId?: string | null;

  @Column({ type: 'enum', enum: ['WIFI_CHANGE', 'REBOOT'] })
  action: 'WIFI_CHANGE' | 'REBOOT';

  @Column({ type: 'varchar', length: 100, default: 'CLIENTE' })
  actor: string;

  @Column({ type: 'enum', enum: ['OK', 'ERROR'] })
  result: 'OK' | 'ERROR';

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'old_ssid', type: 'varchar', length: 32, nullable: true })
  oldSsid?: string;

  @Column({ name: 'new_ssid', type: 'varchar', length: 32, nullable: true })
  newSsid?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
