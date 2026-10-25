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
  // NULLABLE desde la migración 095: los endpoints genéricos de la pestaña
  // TR-069 (ver Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md §4) actúan
  // sobre genieacsDeviceId, y una ONU puede no tener contrato vinculado
  // todavía -- genieacsDeviceId ya alcanza para auditar "qué se le cambió a
  // este equipo y cuándo".
  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string | null;

  @Column({ name: 'genieacs_device_id', type: 'varchar', length: 255, nullable: true })
  genieacsDeviceId?: string | null;

  @Column({
    type: 'enum',
    enum: [
      'WIFI_CHANGE',
      'REBOOT',
      'FACTORY_RESET',
      'TR069_PARAMETER_CHANGE',
      'PORT_FORWARD_ADD',
      'PORT_FORWARD_DELETE',
      'LAN_PORT_TOGGLE',
      'DIAGNOSTIC_RUN',
      'FIRMWARE_PUSH',
    ],
  })
  action:
    | 'WIFI_CHANGE'
    | 'REBOOT'
    | 'FACTORY_RESET'
    | 'TR069_PARAMETER_CHANGE'
    | 'PORT_FORWARD_ADD'
    | 'PORT_FORWARD_DELETE'
    | 'LAN_PORT_TOGGLE'
    | 'DIAGNOSTIC_RUN'
    | 'FIRMWARE_PUSH';

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

  /** Ruta TR-069 afectada (ej. "Device.PPP.Interface.1.Username") -- genérico para cualquier sección editable de la pestaña TR-069. */
  @Column({ name: 'parameter_path', type: 'varchar', length: 500, nullable: true })
  parameterPath?: string | null;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue?: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;
}
