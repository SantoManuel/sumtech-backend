import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OnuEntity } from './onu.entity';
import { VlanEntity } from './vlan.entity';
import { Tr069NetworkEntity } from './tr069-network.entity';
import { OltSpeedProfileEntity } from './olt-speed-profile.entity';

@Entity({ schema: 'net', name: 'onu_service_config' })
export class OnuServiceConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'onu_id', type: 'uuid', unique: true })
  onuId: string;

  @OneToOne(() => OnuEntity, (onu) => onu.serviceConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'onu_id' })
  onu: OnuEntity;

  @Column({ name: 'management_method', type: 'varchar', length: 20, default: 'TR069' })
  managementMethod: 'OMCI' | 'TR069';

  @Column({ name: 'operation_mode', type: 'varchar', length: 20, default: 'ROUTER' })
  operationMode: 'BRIDGE' | 'ROUTER';

  @Column({ name: 'service_vlan_id', type: 'uuid' })
  serviceVlanId: string;

  @ManyToOne(() => VlanEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_vlan_id' })
  serviceVlan: VlanEntity;

  @Column({ name: 'mgmt_vlan_id', type: 'uuid', nullable: true })
  mgmtVlanId?: string;

  @ManyToOne(() => VlanEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'mgmt_vlan_id' })
  mgmtVlan?: VlanEntity;

  @Column({ name: 'tr069_vlan_id', type: 'uuid', nullable: true })
  tr069VlanId?: string;

  @ManyToOne(() => VlanEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tr069_vlan_id' })
  tr069Vlan?: VlanEntity;

  @Column({ name: 'tr069_network_id', type: 'uuid', nullable: true })
  tr069NetworkId?: string;

  @ManyToOne(() => Tr069NetworkEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tr069_network_id' })
  tr069Network?: Tr069NetworkEntity;

  @Column({ name: 'tr069_ip', type: 'varchar', length: 45, nullable: true })
  tr069Ip?: string;

  @Column({ name: 'ip_protocol', type: 'varchar', length: 20, default: 'IPV4' })
  ipProtocol: 'IPV4' | 'IPV6' | 'DUAL';

  @Column({ name: 'wan_mode', type: 'varchar', length: 20, default: 'PPPOE' })
  wanMode: 'STATIC' | 'DHCP' | 'PPPOE';

  @Column({ name: 'wan_static_ip', type: 'varchar', length: 45, nullable: true })
  wanStaticIp?: string;

  @Column({ name: 'wan_static_mask', type: 'varchar', length: 45, nullable: true })
  wanStaticMask?: string;

  @Column({ name: 'wan_static_gw', type: 'varchar', length: 45, nullable: true })
  wanStaticGw?: string;

  @Column({ name: 'pppoe_from_access', type: 'boolean', default: true })
  pppoeFromAccess: boolean;

  @Column({ name: 'speed_profile_id', type: 'uuid', nullable: true })
  speedProfileId?: string;

  @ManyToOne(() => OltSpeedProfileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'speed_profile_id' })
  speedProfile?: OltSpeedProfileEntity;

  @Column({ name: 'desired_version', type: 'int', default: 1 })
  desiredVersion: number;

  @Column({ name: 'applied_version', type: 'int', default: 0 })
  appliedVersion: number;

  @Column({ name: 'apply_status', type: 'varchar', length: 30, default: 'PENDING' })
  applyStatus: 'APPLIED' | 'PENDING' | 'ERROR';

  @Column({ name: 'last_apply_error', type: 'text', nullable: true })
  lastApplyError?: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
