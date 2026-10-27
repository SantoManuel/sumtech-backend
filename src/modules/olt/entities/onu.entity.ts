import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OltEntity } from './olt.entity';
import { OltInterfaceEntity } from './olt-interface.entity';
import { OnuTypeEntity } from './onu-type.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { OnuServiceConfigEntity } from './onu-service-config.entity';
import { NapPortEntity } from '../../network/entities/nap-port.entity';
import { numericTransformer } from '../../../common/utils/numeric.transformer';

export type OnuStatus =
  | 'UNCONFIGURED'
  | 'AUTHORIZING'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'OFFLINE'
  | 'LOS'
  | 'ERROR';

@Entity({ schema: 'net', name: 'onus' })
export class OnuEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @ManyToOne(() => OltEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltEntity;

  @Column({ name: 'pon_interface_id', type: 'uuid', nullable: true })
  ponInterfaceId?: string;

  @ManyToOne(() => OltInterfaceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'pon_interface_id' })
  ponInterface?: OltInterfaceEntity;

  @Column({ name: 'onu_index', type: 'varchar', length: 20 })
  onuIndex: string; // ej. '1/1/1:1' o '1'

  @Column({ name: 'serial_number', type: 'varchar', length: 50 })
  serialNumber: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mac?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  vendor?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  model?: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  name?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'onu_type_id', type: 'uuid', nullable: true })
  onuTypeId?: string;

  @ManyToOne(() => OnuTypeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'onu_type_id' })
  onuType?: OnuTypeEntity;

  @Column({
    type: 'varchar',
    length: 30,
    default: 'UNCONFIGURED',
  })
  status: OnuStatus;

  @Column({ name: 'detected_at', type: 'timestamp with time zone', default: () => 'NOW()' })
  detectedAt: Date;

  @Column({ name: 'detected_by', type: 'varchar', length: 30, default: 'OLT_POLL' })
  detectedBy: 'OLT_POLL' | 'ACS_INFORM' | 'OLT_IMPORT';

  @Column({ name: 'authorized_at', type: 'timestamp with time zone', nullable: true })
  authorizedAt?: Date;

  @Column({ name: 'authorized_by_user_id', type: 'uuid', nullable: true })
  authorizedByUserId?: string;

  @Column({ name: 'rx_power_dbm', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer })
  rxPowerDbm?: number;

  @Column({ name: 'tx_power_dbm', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer })
  txPowerDbm?: number;

  @Column({ name: 'last_seen_at', type: 'timestamp with time zone', nullable: true })
  lastSeenAt?: Date;

  @Column({ name: 'serial_number_id', type: 'uuid', nullable: true })
  serialNumberId?: string;

  @Column({ name: 'genieacs_device_id', type: 'varchar', length: 100, nullable: true })
  genieacsDeviceId?: string;

  @Column({ name: 'contract_id', type: 'uuid', nullable: true })
  contractId?: string;

  @ManyToOne(() => ContractEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contract_id' })
  contract?: ContractEntity;

  @Column({ name: 'nap_port_id', type: 'uuid', nullable: true })
  napPortId?: string | null;

  @ManyToOne(() => NapPortEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'nap_port_id' })
  napPort?: NapPortEntity | null;

  // Sin cascade: OnuManagementService.authorizeOnu() ya gestiona
  // explícitamente el insert/update de onu_service_config vía su propio
  // repositorio. Quitar cascade NO fue suficiente por sí solo — TypeORM
  // igual compara esta relación inversa contra el estado real en BD al
  // hacer onuRepository.save(onu), y si onu.serviceConfig (cargado por el
  // findById() de ANTES de crear/actualizar la fila real) no coincide con lo
  // que ve ahora, la trata como huérfana y emite "UPDATE onu_service_config
  // SET onu_id = NULL" (orphanedRowAction por defecto) — eso es lo que
  // violaba el NOT NULL, no el cascade. El arreglo real: en
  // authorizeOnu()/blockOnu()/unblockOnu()/getOpticalTelemetry() se cambió
  // onuRepository.save(onu) por onuRepository.update(onu.id, {...}), que
  // nunca toca relaciones.
  @OneToOne(() => OnuServiceConfigEntity, (cfg) => cfg.onu)
  serviceConfig?: OnuServiceConfigEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
