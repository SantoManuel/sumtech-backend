import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { SerialNumberEntity } from '../../inventory/entities/serial-number.entity';

/**
 * Vínculo entre un contrato y su ONU/router real gestionado por GenieACS
 * (deviceId TR-069). Satélite 1–1 del contrato, igual que NetworkAccessEntity
 * lo es para el acceso PPPoE/Mikrotik — nunca se fusiona con ContractEntity:
 * la identidad TR-069 de un CPE es un atributo del contrato, no al revés.
 *
 * `genieacsDeviceId` se resuelve automáticamente por serial/MAC (ver
 * GenieAcsDeviceResolverService) contra el equipo ya asignado en
 * inv.serial_numbers — no hace falta que un técnico lo capture a mano.
 */
@Entity({ schema: 'net', name: 'genieacs_devices' })
export class GenieAcsDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_id', type: 'uuid', unique: true })
  contractId: string;

  @OneToOne(() => ContractEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: ContractEntity;

  /** El equipo ONU/router asignado a este contrato en el inventario (inv.serial_numbers). Nulo si aún no se resolvió. */
  @Column({ name: 'serial_number_id', type: 'uuid', nullable: true })
  serialNumberId?: string | null;

  @ManyToOne(() => SerialNumberEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'serial_number_id' })
  serialNumber?: SerialNumberEntity;

  /** El `_id` real del dispositivo en GenieACS (ej. "00259E-EchoLife HG8245H5-16"). Nulo hasta que se resuelva contra la NBI. */
  @Column({ name: 'genieacs_device_id', type: 'varchar', length: 255, nullable: true, unique: true })
  genieacsDeviceId?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  ssid?: string | null;

  @Column({ name: 'ssid_5g', type: 'varchar', length: 32, nullable: true })
  ssid5g?: string | null;

  @Column({ name: 'last_inform_at', type: 'timestamp with time zone', nullable: true })
  lastInformAt?: Date | null;

  @Column({ name: 'optical_rx_power_dbm', type: 'numeric', precision: 6, scale: 2, nullable: true })
  opticalRxPowerDbm?: number | null;

  @Column({ name: 'last_reboot_at', type: 'timestamp with time zone', nullable: true })
  lastRebootAt?: Date | null;

  /** Usado para limitar la frecuencia de autogestión de WiFi (ver GenieAcsWifiService) — nunca se toca desde la resolución/telemetría. */
  @Column({ name: 'last_wifi_change_at', type: 'timestamp with time zone', nullable: true })
  lastWifiChangeAt?: Date | null;

  @Column({ name: 'last_sync_at', type: 'timestamp with time zone', nullable: true })
  lastSyncAt?: Date | null;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
